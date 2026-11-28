/**
 * Writing decision records. A refinement is an edit in place that moves
 * Last updated; a pivot is a new record that supersedes the old one, which
 * keeps its body under the Superseded status. Every write keeps a revision
 * and an audit entry. Numbers come from numbering.ts under a per-registry
 * lock.
 */
import { kindByPrefix } from '../tracking/kinds.ts';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/db.ts';
import type { Principal } from '../auth/principal.ts';
import { requireWorkspace } from '../authz.ts';
import { audit } from '../audit.ts';
import { badRequest, HttpError } from '../http.ts';
import { randomId } from '../crypto.ts';
import { documentBySlug, headVersion } from '../documents/repo.ts';
import { loadStored } from '../documents/model.ts';
import { categoryName, categoryOf, nextNumber, schemeText } from './numbering.ts';
import { addRevision, insertDecision, linksOf, insertRegistry, lockRegistry, patchRegistry, placedById, placedByRef, refOf, registryByPrefix, reindex, setLinks, takenNumbers, updateDecisionRow, type DecisionFields, type LinkRow, type NewDecisionRow, type PlacedRow, type RegistryRow } from './repo.ts';
import { present, requireDecision, requireRegistry, toRegistry } from './read.ts';
import { ulid } from './ulid.ts';
import { indexRecord, resolvePending } from './citations.ts';
import { rebuildNow, rebuildStandards } from '../standards/publish.ts';
import { standardSetting } from '../standards/setting.ts';
import { dayOf } from '../day.ts';
import {
  DecisionCreateSchema,
  DecisionPatchSchema,
  DEFAULT_CATEGORIES,
  RegistryInputSchema,
  RegistryPatchSchema,
  type Decision,
  type DecisionCreate,
  type DecisionPatch,
  type GovernsInput,
  type Position,
  type Registry,
  type RegistryInput,
  type RegistryPatch,
} from './types.ts';

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw badRequest('invalid decision', { issues: r.error.issues.map((i) => `${i.path.join('.') || 'record'}: ${i.message}`) });
  return r.data;
}

export const whoOf = (p: Principal): string => (p.token ? `${p.userId} via token ${p.token.id}` : p.userId);

export async function createRegistry(ctx: AppContext, p: Principal, workspace: string, input: RegistryInput): Promise<Registry> {
  const ws = await requireWorkspace(ctx.db, p, workspace, 'author');
  const v = parse(RegistryInputSchema, input);
  if (await registryByPrefix(ctx.db, p.orgId, v.prefix)) throw new HttpError(409, `the prefix ${v.prefix} is taken in this organization; a prefix never changes, so pick another`);
  if (await kindByPrefix(ctx.db, p.orgId, v.prefix)) throw new HttpError(409, `the prefix ${v.prefix} is a kind of tracked item in this organization; registries and kinds share one namespace, so pick another`);
  const row = await insertRegistry(ctx.db, { id: randomId(), org_id: p.orgId, workspace_id: ws.id, prefix: v.prefix, name: v.name, description: v.description ?? '', categories: [...(v.categories ?? DEFAULT_CATEGORIES)].sort((a, b) => a.digit - b.digit), created_by: p.userId });
  await audit(ctx.db, ctx.log, { orgId: p.orgId, who: whoOf(p), what: 'registry.create', surface: p.surface, target: `workspace:${ws.id}`, details: { prefix: row.prefix, name: row.name } });
  return toRegistry(row, ws.slug);
}

export async function updateRegistry(ctx: AppContext, p: Principal, prefix: string, patch: RegistryPatch): Promise<Registry> {
  const { row, workspace } = await requireRegistry(ctx, p, prefix, 'author');
  const v = parse(RegistryPatchSchema, patch);
  const categories = v.categories ? [...v.categories].sort((a, b) => a.digit - b.digit) : row.categories;
  const used = new Set((await takenNumbers(ctx.db, row.id)).map(categoryOf));
  const dropped = [...used].filter((d) => !categories.some((c) => c.digit === d));
  if (dropped.length) throw badRequest(`records already use categor${dropped.length === 1 ? 'y' : 'ies'} ${dropped.join(', ')}; keep ${dropped.length === 1 ? 'it' : 'them'} in the scheme`);
  const next = await patchRegistry(ctx.db, row.id, { name: v.name ?? row.name, description: v.description ?? row.description, categories });
  await audit(ctx.db, ctx.log, { orgId: p.orgId, who: whoOf(p), what: 'registry.update', surface: p.surface, target: `workspace:${row.workspace_id}`, details: { prefix: row.prefix } });
  // A category is an area of the standard: a renamed one regroups its lines.
  if (v.categories) await rebuildNow(ctx, p.orgId, whoOf(p));
  return toRegistry(next, workspace);
}

export async function peekNextNumber(ctx: AppContext, p: Principal, prefix: string, category: number): Promise<{ number: number; ref: string; categoryName: string }> {
  const { row } = await requireRegistry(ctx, p, prefix, 'viewer');
  try {
    const number = nextNumber(row.categories, category, await takenNumbers(ctx.db, row.id));
    return { number, ref: refOf({ prefix: row.prefix, number }), categoryName: categoryName(row.categories, category)! };
  } catch (err) {
    throw badRequest((err as Error).message);
  }
}

/** Box and view links as rows, each checked against the head of its document. */
export async function resolveGoverns(ctx: AppContext, p: Principal, registryWorkspace: string, governs: readonly GovernsInput[]): Promise<Omit<LinkRow, 'decision_id'>[]> {
  const out: Omit<LinkRow, 'decision_id'>[] = [];
  const models = new Map<string, { nodes: Set<string>; views: Set<string>; id: string }>();
  for (const g of governs) {
    const [ws, doc] = g.document.includes('/') ? (g.document.split('/', 2) as [string, string]) : [registryWorkspace, g.document];
    const key = `${ws}/${doc}`;
    let m = models.get(key);
    if (!m) {
      const w = await requireWorkspace(ctx.db, p, ws, 'viewer');
      const d = await documentBySlug(ctx.db, w.id, doc);
      if (!d) throw badRequest(`document ${key} not found`);
      const head = await headVersion(ctx.db, d);
      const model = head ? loadStored(head.yaml, head.imports).model : undefined;
      m = { id: d.id, nodes: new Set(model?.nodes.keys() ?? []), views: new Set(model?.views.map((v) => v.id) ?? []) };
      models.set(key, m);
    }
    if (g.box !== undefined && !m.nodes.has(g.box)) throw badRequest(`${key} has no box ${g.box}; link a box by its id`);
    if (g.view !== undefined && !m.views.has(g.view)) throw badRequest(`${key} has no view ${g.view}`);
    out.push({ document_id: m.id, target_kind: g.box !== undefined ? 'box' : 'view', target_id: (g.box ?? g.view)! });
  }
  return out;
}

async function relatedIds(db: Db, orgId: string, home: RegistryRow, refs: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const ref of refs) {
    const row = await placedByRef(db, orgId, ref, home.id);
    if (!row) throw badRequest(`related record ${ref} not found`);
    if (!ids.includes(row.id)) ids.push(row.id);
  }
  return ids;
}

/** After every write to a record: its search vector, its citations, the citations that waited for its number, a revision, and an audit entry. */
export async function remember(ctx: AppContext, tx: Db, p: Principal, rowId: string, message: string, what: string, details: Record<string, unknown> = {}): Promise<void> {
  await reindex(tx, rowId);
  await indexRecord(tx, p.orgId, rowId);
  const row = (await placedById(tx, p.orgId, rowId))!;
  await resolvePending(tx, p.orgId, refOf(row), rowId);
  const snapshot = (await present({ ...ctx, db: tx }, p, [row]))[0]!;
  await addRevision(tx, { orgId: p.orgId, decisionId: rowId, snapshot, message, authorUserId: p.userId, surface: p.surface });
  await audit(tx, ctx.log, { orgId: p.orgId, who: whoOf(p), what, surface: p.surface, target: `decision:${rowId}`, details: { ref: refOf(row), message, ...details } });
  // An acceptance and the edition it changes land together (VAN-3018).
  await rebuildStandards(ctx, tx, p.orgId, whoOf(p));
}

/** Refuses a position whose binding word or binds are not on the estate's lists. */
async function checkPosition(ctx: AppContext, p: Principal, position: Position | null | undefined): Promise<void> {
  if (!position) return;
  const s = await standardSetting(ctx.db, p.orgId);
  if (!s.bindings.includes(position.binding)) throw badRequest(`position.binding "${position.binding}" is not on the estate's list: ${s.bindings.join(', ')} (standard#bindings)`);
  const strangers = position.binds.filter((b) => !s.binds.includes(b));
  if (strangers.length) throw badRequest(`position.binds ${strangers.join(', ')} not on the estate's list: ${s.binds.join(', ')} (standard#binds)`);
}

interface Prepared {
  readonly row: Omit<NewDecisionRow, 'id' | 'number'>;
  readonly links: Omit<LinkRow, 'decision_id'>[];
}

async function prepare(ctx: AppContext, p: Principal, registry: RegistryRow, workspace: string, input: unknown, supersedes: string | null): Promise<Prepared> {
  const v = parse(DecisionCreateSchema, input);
  await checkPosition(ctx, p, v.position);
  if (categoryName(registry.categories, v.category) === undefined) throw badRequest(`category ${v.category} is not in ${registry.prefix}'s scheme (${schemeText(registry.categories)})`);
  return {
    row: {
      org_id: p.orgId,
      registry_id: registry.id,
      category: v.category,
      title: v.title,
      status: v.status,
      decided_on: v.decidedOn,
      updated_on: v.updatedOn ?? dayOf(),
      deciders: v.deciders,
      context: v.context,
      decision: v.decision,
      consequences: v.consequences,
      alternatives: v.alternatives,
      related: await relatedIds(ctx.db, p.orgId, registry, v.related),
      position: v.position ?? null,
      supersedes_id: supersedes,
      created_by: p.userId,
    },
    links: await resolveGoverns(ctx, p, workspace, v.governs),
  };
}

async function insertNext(tx: Db, registry: RegistryRow, prepared: Prepared): Promise<string> {
  await lockRegistry(tx, registry.id);
  const number = nextNumber(registry.categories, prepared.row.category, await takenNumbers(tx, registry.id));
  const id = ulid();
  await insertDecision(tx, { ...prepared.row, id, number });
  await setLinks(tx, prepared.row.org_id, id, prepared.links);
  return id;
}

export async function createDecision(ctx: AppContext, p: Principal, prefix: string, input: DecisionCreate): Promise<Decision> {
  const { row: registry, workspace } = await requireRegistry(ctx, p, prefix, 'author');
  const prepared = await prepare(ctx, p, registry, workspace, input, null);
  const id = await ctx.db.transaction(async (tx) => {
    const id = await insertNext(tx, registry, prepared);
    await remember(ctx, tx, p, id, 'created', 'decision.create');
    return id;
  });
  ctx.log.info('decision.created', { registry: registry.prefix, id });
  return (await present(ctx, p, [(await placedById(ctx.db, p.orgId, id))!]))[0]!;
}

/** A refinement: the record changes in place and Last updated moves, unless `minor` says it is a date or wording fix; a date sent wins either way. */
export async function updateDecision(ctx: AppContext, p: Principal, ref: string, patch: DecisionPatch): Promise<Decision> {
  const { row, registry, workspace } = await requireDecision(ctx, p, ref, 'author');
  const v = parse(DecisionPatchSchema, patch);
  await checkPosition(ctx, p, v.position);
  // A record marked superseded with no successor was marked so by mistake, and may be set right.
  if (v.status && v.status !== row.status && row.status === 'superseded' && row.superseded_by_id) throw badRequest(`${refOf(row)} is superseded; its status stays as it is`);
  const link = await successionOf(ctx.db, p.orgId, row, v);
  const old = link?.old.id === row.id;
  const fields: DecisionFields = {
    title: v.title ?? row.title,
    status: old ? 'superseded' : (v.status ?? row.status),
    decided_on: v.decidedOn ?? row.decided_on,
    updated_on: v.updatedOn ?? (v.minor ? row.updated_on : dayOf()),
    deciders: v.deciders ?? row.deciders,
    context: v.context ?? row.context,
    decision: v.decision ?? row.decision,
    consequences: v.consequences ?? row.consequences,
    alternatives: v.alternatives ?? row.alternatives,
    related: v.related ? await relatedIds(ctx.db, p.orgId, registry, v.related) : row.related,
    position: v.position === undefined ? row.position : v.position,
    supersedes_id: link && !old ? link.old.id : row.supersedes_id,
    superseded_by_id: link && old ? link.next.id : row.superseded_by_id,
  };
  const links = v.governs ? await resolveGoverns(ctx, p, workspace, v.governs) : undefined;
  await ctx.db.transaction(async (tx) => {
    await updateDecisionRow(tx, row.id, fields);
    if (links) await setLinks(tx, p.orgId, row.id, links);
    // The other end of a new supersede link: the successor's back link when it has none, or the old record's status and successor.
    const other = link ? (old ? link.next : link.old) : undefined;
    if (link && other && !(old ? other.supersedes_id : other.superseded_by_id)) {
      await updateDecisionRow(tx, other.id, old ? { ...fieldsOf(other), supersedes_id: row.id } : { ...fieldsOf(other), superseded_by_id: row.id });
      await remember(ctx, tx, p, other.id, old ? `supersedes ${refOf(row)}` : `superseded by ${refOf(row)}`, 'decision.supersede');
    }
    await remember(ctx, tx, p, row.id, v.message ?? (link ? (old ? `superseded by ${refOf(link.next)}` : `supersedes ${refOf(link.old)}`) : v.minor ? 'fixed wording' : 'refined'), 'decision.update');
  });
  return (await present(ctx, p, [(await placedById(ctx.db, p.orgId, row.id))!]))[0]!;
}

/**
 * A supersede link between two records that already exist, named by a write
 * of either one: the old record's `supersededBy`, or the successor's
 * `supersedes`. The old record must be superseded with no successor, or be
 * marked superseded by this same write. A link once set never changes.
 */
async function successionOf(db: Db, orgId: string, row: PlacedRow, v: z.output<typeof DecisionPatchSchema>): Promise<{ old: PlacedRow; next: PlacedRow } | undefined> {
  if (v.supersededBy !== undefined && v.supersedes !== undefined) throw badRequest('name one supersede link in a write: superseded_by on the old record, or supersedes on its successor');
  const named = v.supersededBy ?? v.supersedes;
  if (named === undefined) {
    if (v.status === 'superseded' && row.status !== 'superseded') throw badRequest(`a record is superseded by writing the record that replaces it (vantage_tool vantage_decision_supersede), or, when that record exists, by naming it with superseded_by`);
    return undefined;
  }
  const other = await placedByRef(db, orgId, named, row.registry_id);
  if (!other) throw badRequest(`record ${named} not found`);
  if (other.registry_id !== row.registry_id) throw badRequest(`${refOf(other)} is in another registry; a record is superseded by one in its own registry, ${row.prefix}`);
  if (other.id === row.id) throw badRequest(`${refOf(row)} cannot supersede itself`);
  const [old, next] = v.supersededBy !== undefined ? [row, other] : [other, row];
  if (old.superseded_by_id && old.superseded_by_id !== next.id) throw badRequest(`${refOf(old)} is already superseded by ${refOf((await placedById(db, orgId, old.superseded_by_id))!)}; it keeps that successor`);
  if (next.supersedes_id && next.supersedes_id !== old.id) throw badRequest(`${refOf(next)} already supersedes ${refOf((await placedById(db, orgId, next.supersedes_id))!)}; it keeps that link`);
  if (old.status !== 'superseded' && !(old.id === row.id && v.status === 'superseded')) {
    throw badRequest(old.id === row.id ? `${refOf(old)} is ${old.status}; mark it superseded in the same write: status: superseded with superseded_by: ${refOf(next)}` : `${refOf(old)} is ${old.status}, not superseded; mark it on its own record: status: superseded with superseded_by: ${refOf(next)}`);
  }
  // No loop: the successor's own line of successors never comes back to the old record.
  let at: PlacedRow | undefined = next;
  for (let hops = 0; at?.superseded_by_id && hops < 100; hops += 1) {
    if (at.superseded_by_id === old.id) throw badRequest(`${refOf(next)} is itself superseded, by a line of records that leads back to ${refOf(old)}`);
    at = await placedById(db, orgId, at.superseded_by_id);
  }
  return { old, next };
}

/** A pivot: a new record in the same registry supersedes the old one, which keeps its body. The category and the links default to the old record's. */
export async function supersedeDecision(ctx: AppContext, p: Principal, ref: string, input: Omit<DecisionCreate, 'category'> & { category?: number | undefined }): Promise<{ old: Decision; new: Decision }> {
  const { row: old, registry, workspace } = await requireDecision(ctx, p, ref, 'author');
  if (old.status === 'superseded') throw badRequest(`${refOf(old)} is already superseded${old.superseded_by_id ? `; supersede its successor instead` : ''}`);
  const prepared = await prepare(ctx, p, registry, workspace, { ...input, category: input.category ?? old.category }, old.id);
  // With no links of its own, the new record governs what the old one did.
  const links = input.governs === undefined ? (await linksOf(ctx.db, [old.id])).map(({ decision_id: _, ...l }) => l) : prepared.links;
  const id = await ctx.db.transaction(async (tx) => {
    const id = await insertNext(tx, registry, { ...prepared, links });
    await updateDecisionRow(tx, old.id, { ...fieldsOf(old), status: 'superseded', superseded_by_id: id, updated_on: prepared.row.updated_on });
    await remember(ctx, tx, p, id, `supersedes ${refOf(old)}`, 'decision.create');
    await remember(ctx, tx, p, old.id, 'superseded', 'decision.supersede');
    return id;
  });
  const [a, b] = await present(ctx, p, [(await placedById(ctx.db, p.orgId, old.id))!, (await placedById(ctx.db, p.orgId, id))!]);
  return { old: a!, new: b! };
}

export function fieldsOf(row: PlacedRow): DecisionFields {
  return {
    title: row.title,
    status: row.status,
    decided_on: row.decided_on,
    updated_on: row.updated_on,
    deciders: row.deciders,
    context: row.context,
    decision: row.decision,
    consequences: row.consequences,
    alternatives: row.alternatives,
    related: row.related,
    position: row.position,
    supersedes_id: row.supersedes_id,
    superseded_by_id: row.superseded_by_id,
  };
}


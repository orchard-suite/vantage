/**
 * Moving a record: a new number in its registry, a new category, or a new
 * registry. The record keeps its id; its old citation becomes an alias
 * that still resolves, and no other record ever takes the number. Every
 * citation the index knows of is rewritten to the new one, as a new
 * version of each document and a revision of each record, by the caller.
 * A source the caller cannot write keeps resolving through the alias and
 * is reported, never a reason to fail. A dry run reports the same and
 * writes nothing.
 */
import { z } from 'zod';
import { formatNumber } from '@vantage/model';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import type { Db } from '../db/db.ts';
import { accessibleWorkspaces } from '../authz.ts';
import { audit } from '../audit.ts';
import { badRequest, HttpError } from '../http.ts';
import { documentById, headVersion } from '../documents/repo.ts';
import { saveDocument, type SaveResult } from '../documents/save.ts';
import { incomingFiles } from '../documents/pages.ts';
import { categoryName, categoryOf, nextNumber, numberProblem, schemeText } from './numbering.ts';
import { aliasesOf, lockRegistry, moveRow, placedById, placedByIds, refOf, takenNumbers, updateDecisionRow, type PlacedRow, type RegistryRow } from './repo.ts';
import { recordUrl, requireDecision, requireRegistry } from './read.ts';
import { fieldsOf, remember, whoOf } from './write.ts';
import { documentUrl } from './backlinks.ts';
import { pageBytes } from './citations.ts';
import { fromRef, rewriteDocumentText, rewriteRecordText, toRef, type Move, type Writer } from './rewrite.ts';
import { PrefixSchema } from './types.ts';

export const MoveSchema = z
  .object({
    registry: PrefixSchema.optional().describe('The registry to move the record to; its own when absent'),
    number: z.number().int().min(1).max(9999).optional().describe('The exact new number; it must be free in the registry'),
    category: z.number().int().min(0).max(9).optional().describe('The new category; the record takes the next number there'),
    dryRun: z.boolean().optional(),
    message: z.string().max(500).optional(),
  })
  .strict()
  .refine((m) => m.registry !== undefined || m.number !== undefined || m.category !== undefined, 'name a registry, a number, or a category');
export type MoveInput = z.input<typeof MoveSchema>;

/** One source the move rewrites, or cannot. */
export interface MovePlace {
  readonly kind: 'document' | 'record';
  /** workspace/document, or the record's citation. */
  readonly source: string;
  readonly title: string;
  readonly url: string;
  /** The boxes and pages, or the parts of the record, that cite it. */
  readonly places: readonly string[];
  /** Why it was not rewritten; absent on a rewrite. */
  readonly reason?: string;
}

export interface MoveReport {
  readonly dryRun: boolean;
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly url: string;
  readonly rewritten: readonly MovePlace[];
  readonly cannot: readonly MovePlace[];
  /** Sources that cite the record in workspaces or registries the caller cannot open; the alias keeps them resolving. */
  readonly hidden: number;
  /** Sources that cite it only by id (Related, a box's governs link, adr:<ULID>); they follow on their own. */
  readonly followed: number;
}

interface Plan {
  readonly docs: { id: string; place: MovePlace }[];
  readonly records: { row: PlacedRow; place: MovePlace }[];
  readonly cannot: MovePlace[];
  readonly hidden: number;
  readonly followed: number;
}

/** The number the record takes, checked against everything the registry ever handed out but the record's own old numbers. */
async function targetNumber(db: Db, row: PlacedRow, to: RegistryRow, input: z.output<typeof MoveSchema>): Promise<number> {
  const own = new Set((await aliasesOf(db, [row.id])).filter((a) => a.registry_id === to.id).map((a) => a.number));
  if (to.id === row.registry_id) own.add(row.number);
  const taken = (await takenNumbers(db, to.id)).filter((n) => !own.has(n));
  if (input.number !== undefined) {
    if (input.category !== undefined && categoryOf(input.number) !== input.category) throw badRequest(`${formatNumber(input.number)} is not in category ${input.category}; send the number or the category`);
    const problem = numberProblem(to.categories, input.number, taken);
    if (problem) throw badRequest(`${problem}; a number is never reused`);
    return input.number;
  }
  const category = input.category ?? row.category;
  if (categoryName(to.categories, category) === undefined) throw badRequest(`category ${category} is not in ${to.prefix}'s scheme (${schemeText(to.categories)}); name a category`);
  try {
    return nextNumber(to.categories, category, taken);
  } catch (err) {
    throw badRequest((err as Error).message);
  }
}

async function plan(ctx: AppContext, p: Principal, row: PlacedRow): Promise<Plan> {
  const rows = await ctx.db.query<{ document_id: string | null; source_decision_id: string | null; place_kind: string; place_id: string; cited_as: string }>(
    'select document_id, source_decision_id, place_kind, place_id, cited_as from decision_citations where decision_id = $1 and (source_decision_id is null or source_decision_id <> $1)',
    [row.id],
  );
  const machine = (r: { cited_as: string }): boolean => r.cited_as.toLowerCase().startsWith('adr:');
  const workspaces = new Map((await accessibleWorkspaces(ctx.db, p)).map((w) => [w.id, w]));
  const docs: Plan['docs'] = [];
  const records: Plan['records'] = [];
  const cannot: MovePlace[] = [];
  let hidden = 0;
  // Each document a link governs follows the record by id.
  let followed = Number((await ctx.db.query<{ n: string }>('select count(distinct document_id)::text as n from decision_links where decision_id = $1', [row.id]))[0]?.n ?? 0);
  const bySource = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.document_id ? `d:${r.document_id}` : `r:${r.source_decision_id}`;
    bySource.set(key, [...(bySource.get(key) ?? []), r]);
  }
  const sources = await placedByIds(ctx.db, p.orgId, [...new Set(rows.map((r) => r.source_decision_id).filter((x): x is string => !!x))]);
  for (const [key, mine] of bySource) {
    const texts = mine.filter((r) => !machine(r) && r.place_kind !== 'related');
    if (!texts.length) {
      followed++;
      continue;
    }
    const places = [...new Set(texts.map((r) => (r.place_kind === 'body' ? r.place_id : `${r.place_kind} ${r.place_id}`)))];
    if (key.startsWith('d:')) {
      const doc = await documentById(ctx.db, key.slice(2));
      const ws = doc ? workspaces.get(doc.workspace_id) : undefined;
      if (!doc || !ws) {
        hidden++;
        continue;
      }
      const place: MovePlace = { kind: 'document', source: `${ws.slug}/${doc.slug}`, title: doc.name, url: documentUrl(ws.slug, doc.slug), places };
      if (ws.role === 'author') docs.push({ id: doc.id, place });
      else cannot.push({ ...place, reason: `you can read ${ws.slug} but not write it` });
      continue;
    }
    const src = sources.find((s) => s.id === key.slice(2));
    const ws = src ? workspaces.get(src.workspace_id) : undefined;
    if (!src || !ws) {
      hidden++;
      continue;
    }
    const place: MovePlace = { kind: 'record', source: refOf(src), title: src.title, url: recordUrl(ws.slug, refOf(src)), places };
    if (ws.role === 'author') records.push({ row: src, place });
    else cannot.push({ ...place, reason: `you can read ${src.prefix} but not write it` });
  }
  return { docs, records, cannot, hidden, followed };
}

function rewriteFields(row: PlacedRow, m: Move, w: Writer): ReturnType<typeof fieldsOf> {
  const r = (t: string): string => rewriteRecordText(t, m, w);
  return { ...fieldsOf(row), title: r(row.title), context: r(row.context), decision: r(row.decision), consequences: r(row.consequences), alternatives: row.alternatives.map((a) => ({ option: r(a.option), rejected: r(a.rejected) })) };
}

const changed = (a: ReturnType<typeof fieldsOf>, b: ReturnType<typeof fieldsOf>): boolean => JSON.stringify(a) !== JSON.stringify(b);

/** Rewrites one document's head; answers why not when it cannot. */
async function rewriteDocument(ctx: AppContext, p: Principal, documentId: string, m: Move, message: string): Promise<string | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const doc = await documentById(ctx.db, documentId);
    const head = doc ? await headVersion(ctx.db, doc) : undefined;
    if (!doc || !head) return 'the document has no version';
    const yaml = rewriteDocumentText(head.yaml, m);
    const imports = Object.fromEntries(Object.entries(head.imports).map(([k, v]) => [k, rewriteDocumentText(v, m)]));
    const files: Record<string, Uint8Array> = {};
    for (const [path, bytes] of Object.entries(await pageBytes(ctx, p.orgId, head.attachments))) {
      const text = new TextDecoder().decode(bytes);
      const next = rewriteDocumentText(text, m);
      if (next !== text) files[path] = new TextEncoder().encode(next);
    }
    if (yaml === head.yaml && JSON.stringify(imports) === JSON.stringify(head.imports) && !Object.keys(files).length) return undefined;
    let r: SaveResult;
    try {
      r = await saveDocument(ctx, { orgId: p.orgId, workspaceId: doc.workspace_id, documentId: doc.id, yaml, imports, files: incomingFiles(ctx, p.orgId, files), message, expectedVersionId: head.id, authorUserId: p.userId, who: whoOf(p), surface: p.surface });
    } catch (err) {
      // A document that already had errors cannot save until someone fixes it; its old citation still resolves meanwhile.
      if (err instanceof HttpError && err.status === 422) return 'the document has errors, so it cannot save until they are fixed; the old citation still resolves';
      throw err;
    }
    if (r.status !== 'conflict') return undefined;
  }
  return 'someone saved it while the move ran; the old citation still resolves';
}

export async function moveDecision(ctx: AppContext, p: Principal, ref: string, input: MoveInput): Promise<MoveReport> {
  const parsed = MoveSchema.safeParse(input);
  if (!parsed.success) throw badRequest('invalid move', { issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'move'}: ${i.message}`) });
  const v = parsed.data;
  const dryRun = v.dryRun ?? false;
  const { row, registry: from, workspace } = await requireDecision(ctx, p, ref, 'author');
  const { row: to, workspace: toWorkspace } = v.registry && v.registry !== from.prefix ? await requireRegistry(ctx, p, v.registry, 'author') : { row: from, workspace };
  const number = await targetNumber(ctx.db, row, to, v);
  if (to.id === row.registry_id && number === row.number) throw badRequest(`${refOf(row)} is already there`);
  const m: Move = { fromRegistry: from.id, fromPrefix: from.prefix, fromNumber: row.number, toRegistry: to.id, toPrefix: to.prefix, toNumber: number };
  const planned = await plan(ctx, p, row);
  const base = { dryRun, id: row.id, from: fromRef(m), to: toRef(m), url: recordUrl(toWorkspace, toRef(m)), hidden: planned.hidden, followed: planned.followed };
  ctx.log.info('decision.move.start', { id: row.id, from: base.from, to: base.to, dryRun, documents: planned.docs.length, records: planned.records.length, cannot: planned.cannot.length, hidden: planned.hidden });
  if (dryRun) return { ...base, rewritten: [...planned.docs, ...planned.records].map((x) => x.place), cannot: planned.cannot };

  const message = v.message ?? `${base.from} moved to ${base.to}`;
  const rewritten: MovePlace[] = [];
  await ctx.db.transaction(async (tx) => {
    for (const id of [...new Set([from.id, to.id])].sort()) await lockRegistry(tx, id);
    // The lock is held now; a number taken since the plan was read refuses the move.
    if ((await targetNumber(tx, row, to, { ...v, number })) !== number) throw badRequest(`${base.to} was taken while the move ran; try again`);
    await moveRow(tx, row, { registryId: to.id, number });
    const self = (await placedById(tx, p.orgId, row.id))!;
    await updateDecisionRow(tx, row.id, rewriteFields(self, m, { registry: from.id, self: true }));
    await remember(ctx, tx, p, row.id, message, 'decision.move', { from: base.from, to: base.to });
    for (const { row: src, place } of planned.records) {
      const fresh = (await placedById(tx, p.orgId, src.id))!;
      const next = rewriteFields(fresh, m, { registry: fresh.registry_id, self: false });
      if (!changed(fieldsOf(fresh), next)) continue;
      await updateDecisionRow(tx, src.id, next);
      await remember(ctx, tx, p, src.id, `cites ${base.to}, which was ${base.from}`, 'decision.update');
      rewritten.push(place);
    }
  });
  const cannot = [...planned.cannot];
  for (const { id, place } of planned.docs) {
    try {
      const why = await rewriteDocument(ctx, p, id, m, message);
      if (why) cannot.push({ ...place, reason: why });
      else rewritten.push(place);
    } catch (err) {
      cannot.push({ ...place, reason: (err as Error).message });
    }
  }
  await audit(ctx.db, ctx.log, { orgId: p.orgId, who: whoOf(p), what: 'decision.move.citations', surface: p.surface, target: `decision:${row.id}`, details: { from: base.from, to: base.to, rewritten: rewritten.map((x) => x.source), cannot: cannot.map((x) => x.source), hidden: planned.hidden } });
  ctx.log.info('decision.move.end', { id: row.id, from: base.from, to: base.to, rewritten: rewritten.length, cannot: cannot.length, hidden: planned.hidden });
  return { ...base, rewritten, cannot };
}

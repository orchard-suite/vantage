/**
 * Reading decision records as a person may: the registries in the
 * workspaces they can open, a record by any citation, a registry's list,
 * search, history, and what a document's boxes are governed by. A record
 * in a registry the reader cannot open shows as its citation alone.
 */
import type { AppContext } from '../context.ts';
import type { Principal, Role } from '../auth/principal.ts';
import { accessibleWorkspaces, memberWorkspaces, requireWorkspace } from '../authz.ts';
import { HttpError, notFound } from '../http.ts';
import { machineRef } from '@vantage/model';
import { categoryName } from './numbering.ts';
import { aliasesOf, linksOf, linksToDocument, listPlaced, placedByIds, placedByRef, refOf, resolveRefs, registriesIn, registryByPrefix, revisionsOf, stubOf, type ListFilter, type PlacedRow, type RegistryRow } from './repo.ts';
import type { Decision, DecisionRevision, DecisionStub, Governs, Registry } from './types.ts';

export interface Reach {
  /** Workspace id to slug, for every workspace the reader may open. */
  readonly slugs: ReadonlyMap<string, string>;
  readonly registries: readonly RegistryRow[];
}

export async function reach(ctx: AppContext, p: Principal): Promise<Reach> {
  const ws = await accessibleWorkspaces(ctx.db, p);
  return { slugs: new Map(ws.map((w) => [w.id, w.slug])), registries: await registriesIn(ctx.db, p.orgId, ws.map((w) => w.id)) };
}

export function toRegistry(row: RegistryRow, workspace: string): Registry {
  return { id: row.id, prefix: row.prefix, name: row.name, description: row.description, categories: row.categories, workspace, workspaceId: row.workspace_id, createdAt: row.created_at.toISOString() };
}

/** The registries the reader may open, optionally only one workspace's. */
export async function listRegistries(ctx: AppContext, p: Principal, workspace?: string): Promise<Registry[]> {
  const r = await reach(ctx, p);
  return r.registries.filter((g) => !workspace || r.slugs.get(g.workspace_id) === workspace).map((g) => toRegistry(g, r.slugs.get(g.workspace_id) ?? ''));
}

/** A registry by prefix, with the caller holding `role` in its workspace; a registry they cannot open is not found. */
export async function requireRegistry(ctx: AppContext, p: Principal, prefix: string, role: Role): Promise<{ row: RegistryRow; workspace: string }> {
  const row = await registryByPrefix(ctx.db, p.orgId, prefix);
  if (!row) throw notFound(`registry ${prefix}`);
  const ws = (await accessibleWorkspaces(ctx.db, p)).find((w) => w.id === row.workspace_id);
  if (!ws) throw notFound(`registry ${prefix}`);
  await requireWorkspace(ctx.db, p, ws.slug, role);
  return { row, workspace: ws.slug };
}

/** A record by citation, with the caller holding `role` in its registry's workspace. `home` lets ADR-2001 mean that registry's record. */
export async function requireDecision(ctx: AppContext, p: Principal, ref: string, role: Role, home?: string): Promise<{ row: PlacedRow; registry: RegistryRow; workspace: string }> {
  const homeRow = home ? await registryByPrefix(ctx.db, p.orgId, home) : undefined;
  const row = await placedByRef(ctx.db, p.orgId, ref, homeRow?.id);
  if (!row) throw notFound(`decision ${ref}`);
  const { row: registry, workspace } = await requireRegistry(ctx, p, row.prefix, role);
  return { row, registry, workspace };
}

const hidden = (row: PlacedRow): DecisionStub => ({ id: row.id, ref: refOf(row), title: 'Not shared with you', status: row.status });

/** Records as the reader sees them, with their links, related records, and supersede links filled in. */
export async function present(ctx: AppContext, p: Principal, rows: readonly PlacedRow[], r?: Reach): Promise<Decision[]> {
  if (!rows.length) return [];
  const seen = r ?? (await reach(ctx, p));
  const registries = new Map(seen.registries.map((g) => [g.id, g]));
  const otherIds = [...new Set(rows.flatMap((row) => [...row.related, row.supersedes_id, row.superseded_by_id].filter((x): x is string => !!x)))];
  const others = new Map((await placedByIds(ctx.db, p.orgId, otherIds)).map((o) => [o.id, o]));
  const stub = (id: string | null): DecisionStub | null => {
    const o = id ? others.get(id) : undefined;
    if (!o) return null;
    return registries.has(o.registry_id) ? stubOf(o) : hidden(o);
  };
  const links = await linksOf(ctx.db, rows.map((x) => x.id));
  const aliases = await aliasesOf(ctx.db, rows.map((x) => x.id));
  const docIds = [...new Set(links.map((l) => l.document_id))];
  const docs = new Map(
    (docIds.length ? await ctx.db.query<{ id: string; slug: string; name: string; workspace_id: string }>('select id, slug, name, workspace_id from documents where id = any($1::text[])', [docIds]) : []).map((d) => [d.id, d]),
  );
  return rows.map((row) => {
    const registry = registries.get(row.registry_id);
    const governs: Governs[] = [];
    for (const l of links) {
      if (l.decision_id !== row.id) continue;
      const d = docs.get(l.document_id);
      const ws = d ? seen.slugs.get(d.workspace_id) : undefined;
      if (!d || !ws) continue;
      governs.push({ workspace: ws, document: d.slug, documentName: d.name, ...(l.target_kind === 'box' ? { box: l.target_id } : { view: l.target_id }) });
    }
    return {
      id: row.id,
      ref: refOf(row),
      machineRef: machineRef(row.id),
      aliases: aliases.filter((a) => a.decision_id === row.id).map(refOf),
      registry: row.prefix,
      workspace: seen.slugs.get(row.workspace_id) ?? '',
      number: row.number,
      category: row.category,
      categoryName: (registry && categoryName(registry.categories, row.category)) ?? String(row.category),
      title: row.title,
      status: row.status,
      decidedOn: row.decided_on,
      updatedOn: row.updated_on,
      deciders: row.deciders,
      context: row.context,
      decision: row.decision,
      consequences: row.consequences,
      alternatives: row.alternatives,
      related: row.related.map((id) => stub(id)).filter((x): x is DecisionStub => x !== null),
      alignment: row.alignment,
      supersedes: stub(row.supersedes_id),
      supersededBy: stub(row.superseded_by_id),
      governs,
    };
  });
}

export async function readDecision(ctx: AppContext, p: Principal, ref: string, home?: string): Promise<Decision> {
  const { row } = await requireDecision(ctx, p, ref, 'viewer', home);
  return (await present(ctx, p, [row]))[0]!;
}

/** One registry's records, or every registry the reader may open when `prefix` is absent. */
export async function listDecisions(ctx: AppContext, p: Principal, prefix: string | undefined, filter: ListFilter = {}): Promise<Decision[]> {
  const r = await reach(ctx, p);
  let ids = r.registries.map((g) => g.id);
  if (prefix) {
    const { row } = await requireRegistry(ctx, p, prefix, 'viewer');
    ids = [row.id];
  }
  if (!ids.length) return [];
  return present(ctx, p, await listPlaced(ctx.db, ids, filter), r);
}

export async function decisionHistory(ctx: AppContext, p: Principal, ref: string): Promise<DecisionRevision[]> {
  const { row } = await requireDecision(ctx, p, ref, 'viewer');
  return (await revisionsOf(ctx.db, row.id)).map((v) => ({ id: v.id, message: v.message, author: v.author_label, surface: v.surface, createdAt: v.created_at.toISOString(), snapshot: v.snapshot }));
}

export interface DecisionHit {
  readonly ref: string;
  readonly title: string;
  readonly status: string;
  readonly workspaceSlug: string;
  readonly headline: string;
  readonly rank: number;
}

/** Full-text search over the records in the reader's own library, like document search. */
export async function searchDecisions(ctx: AppContext, p: Principal, query: string, limit = 20): Promise<DecisionHit[]> {
  const ws = await memberWorkspaces(ctx.dbRead, p);
  if (!ws.length || !query.trim()) return [];
  const rows = await ctx.dbRead.query<{ prefix: string; number: number; title: string; status: string; wslug: string; headline: string; rank: number }>(
    `select r.prefix, d.number, d.title, d.status, w.slug as wslug,
            ts_headline('english', d.title || '. ' || d.context || ' ' || d.decision, websearch_to_tsquery('english', $1), 'MaxFragments=1, MaxWords=14, MinWords=4') as headline,
            ts_rank(d.search, websearch_to_tsquery('english', $1)) as rank
       from decisions d
       join decision_registries r on r.id = d.registry_id
       join workspaces w on w.id = r.workspace_id
      where r.workspace_id = any($2::text[]) and d.search @@ websearch_to_tsquery('english', $1)
      order by rank desc, r.prefix, d.number
      limit $3`,
    [query, ws.map((w) => w.id), Math.min(limit, 100)],
  );
  return rows.map((x) => ({ ref: refOf(x), title: x.title, status: x.status, workspaceSlug: x.wslug, headline: x.headline, rank: Number(x.rank) }));
}

/** What a reader's viewer shows for one document: each record that governs its boxes or views, and the records its YAML and pages cite. */
export interface DocumentDecision extends DecisionStub {
  readonly url: string;
  readonly boxes: readonly string[];
  readonly views: readonly string[];
}

export function recordUrl(workspace: string, ref: string): string {
  return `/w/${encodeURIComponent(workspace)}/decisions/${encodeURIComponent(ref)}`;
}

export async function documentDecisions(ctx: AppContext, p: Principal, documentId: string, cite: readonly string[]): Promise<{ decisions: DocumentDecision[]; cited: Record<string, string> }> {
  const r = await reach(ctx, p);
  const open = new Map(r.registries.map((g) => [g.id, g]));
  const links = await linksToDocument(ctx.db, documentId);
  const linked = await placedByIds(ctx.db, p.orgId, [...new Set(links.map((l) => l.decision_id))]);
  const byId = new Map<string, PlacedRow>(linked.filter((x) => open.has(x.registry_id)).map((x) => [x.id, x]));
  const cited: Record<string, string> = {};
  for (const text of [...new Set(cite)].slice(0, 200)) {
    const row = await placedByRef(ctx.db, p.orgId, text);
    if (!row || !open.has(row.registry_id)) continue;
    byId.set(row.id, row);
    cited[text] = row.id;
  }
  const decisions = [...byId.values()]
    .sort((a, b) => a.prefix.localeCompare(b.prefix) || a.number - b.number)
    .map((row) => {
      const mine = links.filter((l) => l.decision_id === row.id);
      return {
        ...stubOf(row),
        url: recordUrl(r.slugs.get(row.workspace_id) ?? '', refOf(row)),
        boxes: mine.filter((l) => l.target_kind === 'box').map((l) => l.target_id),
        views: mine.filter((l) => l.target_kind === 'view').map((l) => l.target_id),
      };
    });
  return { decisions, cited };
}

/** Citations a document makes that name no record in the organization; a save refuses them. */
export async function unknownCitations(ctx: AppContext, orgId: string, refs: readonly string[]): Promise<string[]> {
  const found = await resolveRefs(ctx.db, orgId, refs);
  return refs.filter((ref) => !found.has(ref));
}

export function badRef(ref: string): HttpError {
  return new HttpError(400, `${ref} is not a decision record citation; cite one as PREFIX-NNNN (SHOP-2001) or adr:<ULID>`);
}

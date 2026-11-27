/**
 * Decision registries and records in the database: rows, the lookups by
 * citation, the number lock, links, revisions, and the search vector.
 * No access checks here; read.ts and write.ts decide who may call what.
 */
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { randomId } from '../crypto.ts';
import { parseDecisionRef, qualifiedRef } from '@vantage/model';
import type { Alignment, Alternative, Category, DecisionStatus, DecisionStub } from './types.ts';

export interface RegistryRow {
  readonly id: string;
  readonly org_id: string;
  readonly workspace_id: string;
  readonly prefix: string;
  readonly name: string;
  readonly description: string;
  readonly categories: Category[];
  readonly created_at: Date;
}

export interface DecisionRow {
  readonly id: string;
  readonly org_id: string;
  readonly registry_id: string;
  readonly number: number;
  readonly category: number;
  readonly title: string;
  readonly status: DecisionStatus;
  readonly decided_on: string | null;
  readonly updated_on: string;
  readonly deciders: string[];
  readonly context: string;
  readonly decision: string;
  readonly consequences: string;
  readonly alternatives: Alternative[];
  readonly related: string[];
  readonly alignment: Alignment | null;
  readonly supersedes_id: string | null;
  readonly superseded_by_id: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** A decision row with its registry's prefix and workspace, as most reads want it. */
export interface PlacedRow extends DecisionRow {
  readonly prefix: string;
  readonly workspace_id: string;
}

export interface LinkRow {
  readonly decision_id: string;
  readonly document_id: string;
  readonly target_kind: 'box' | 'view';
  readonly target_id: string;
}

const PLACED = 'select d.*, r.prefix, r.workspace_id from decisions d join decision_registries r on r.id = d.registry_id';

export const refOf = (row: { prefix: string; number: number }): string => qualifiedRef(row.prefix, row.number);
export const stubOf = (row: PlacedRow): DecisionStub => ({ id: row.id, ref: refOf(row), title: row.title, status: row.status });

export async function registryByPrefix(db: Db, orgId: string, prefix: string): Promise<RegistryRow | undefined> {
  return maybe<RegistryRow>(db, 'select * from decision_registries where org_id = $1 and prefix = $2', [orgId, prefix.toUpperCase()]);
}

export async function registriesIn(db: Db, orgId: string, workspaceIds: readonly string[]): Promise<RegistryRow[]> {
  return db.query<RegistryRow>('select * from decision_registries where org_id = $1 and workspace_id = any($2::text[]) order by prefix', [orgId, [...workspaceIds]]);
}

export async function insertRegistry(db: Db, row: Omit<RegistryRow, 'created_at'> & { readonly created_by: string | null }): Promise<RegistryRow> {
  await db.query('insert into decision_registries (id, org_id, workspace_id, prefix, name, description, categories, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8)', [
    row.id,
    row.org_id,
    row.workspace_id,
    row.prefix,
    row.name,
    row.description,
    JSON.stringify(row.categories),
    row.created_by,
  ]);
  return (await maybe<RegistryRow>(db, 'select * from decision_registries where id = $1', [row.id]))!;
}

export async function patchRegistry(db: Db, id: string, patch: { name: string; description: string; categories: readonly Category[] }): Promise<RegistryRow> {
  await db.query('update decision_registries set name = $2, description = $3, categories = $4 where id = $1', [id, patch.name, patch.description, JSON.stringify(patch.categories)]);
  return (await maybe<RegistryRow>(db, 'select * from decision_registries where id = $1', [id]))!;
}

export async function countDecisions(db: Db, registryIds: readonly string[]): Promise<number> {
  if (!registryIds.length) return 0;
  return Number((await db.query<{ n: string }>('select count(*)::text as n from decisions where registry_id = any($1::text[])', [[...registryIds]]))[0]?.n ?? 0);
}

/** The numbers the registry holds: its records' numbers and the numbers records held before they moved. A discarded record (discard.ts) leaves no row, so its number is free again; every other number stays taken for good. */
export async function takenNumbers(db: Db, registryId: string): Promise<number[]> {
  return (await db.query<{ number: number }>('select number from decisions where registry_id = $1 union select number from decision_aliases where registry_id = $1', [registryId])).map((r) => r.number);
}

/** Holds the registry's numbers until the transaction ends, so two writers never take the same one. */
export async function lockRegistry(tx: Db, registryId: string): Promise<void> {
  await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`vantage.decisions.${registryId}`]);
}

export async function placedById(db: Db, orgId: string, id: string): Promise<PlacedRow | undefined> {
  return maybe<PlacedRow>(db, `${PLACED} where d.org_id = $1 and d.id = $2`, [orgId, id]);
}

export async function placedByIds(db: Db, orgId: string, ids: readonly string[]): Promise<PlacedRow[]> {
  if (!ids.length) return [];
  return db.query<PlacedRow>(`${PLACED} where d.org_id = $1 and d.id = any($2::text[])`, [orgId, [...ids]]);
}

/** A record a citation found, and whether the citation is a number the record held before it moved. */
export interface Resolved {
  readonly row: PlacedRow;
  readonly alias: boolean;
}

/**
 * The record a citation names: SHOP-2001 by prefix and number, adr:<ULID> by id, and ADR-2001 only
 * within `home`, the registry the citing text belongs to. A number a record held before it moved
 * still finds it, as an alias.
 */
export async function resolveRef(db: Db, orgId: string, text: string, home?: string): Promise<Resolved | undefined> {
  return (await resolveRefs(db, orgId, [text], home)).get(text);
}

/**
 * Every citation of a list at once, as resolveRef reads each: a document that cites fifty records
 * costs three queries, not a hundred. The map holds the citations that found a record.
 */
export async function resolveRefs(db: Db, orgId: string, texts: readonly string[], home?: string): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>();
  const machine = new Map<string, string[]>();
  // The registry each citation looks in, by prefix or (for a local number) by id, and its number.
  const numbered = new Map<string, { match: 'prefix' | 'id'; key: string; number: number; texts: string[] }>();
  for (const text of new Set(texts)) {
    const ref = parseDecisionRef(text);
    if (!ref) continue;
    if (ref.kind === 'machine') {
      machine.set(ref.id, [...(machine.get(ref.id) ?? []), text]);
      continue;
    }
    if (ref.kind === 'local' && !home) continue;
    const [match, key] = ref.kind === 'local' ? (['id', home!] as const) : (['prefix', ref.prefix] as const);
    const k = `${match}\0${key}\0${ref.number}`;
    const entry = numbered.get(k) ?? { match, key, number: ref.number, texts: [] };
    entry.texts.push(text);
    numbered.set(k, entry);
  }
  if (machine.size) for (const row of await placedByIds(db, orgId, [...machine.keys()])) for (const t of machine.get(row.id) ?? []) out.set(t, { row, alias: false });
  for (const match of ['prefix', 'id'] as const) {
    const wanted = [...numbered.values()].filter((e) => e.match === match);
    if (!wanted.length) continue;
    const pairs = [wanted.map((e) => e.key), wanted.map((e) => e.number)];
    const byPlace = (key: string, number: number) => wanted.find((e) => e.key === key && e.number === number);
    const live = await db.query<PlacedRow & { q_key: string; q_number: number }>(
      `${PLACED.replace('select d.*', 'select d.*, q.key as q_key, q.number as q_number')} join unnest($2::text[], $3::int[]) as q(key, number) on r.${match} = q.key and d.number = q.number where d.org_id = $1`,
      [orgId, ...pairs],
    );
    for (const { q_key, q_number, ...row } of live) for (const t of byPlace(q_key, q_number)?.texts ?? []) out.set(t, { row, alias: false });
    const rest = wanted.filter((e) => !out.has(e.texts[0]!));
    if (!rest.length) continue;
    const moved = await db.query<PlacedRow & { q_key: string; q_number: number }>(
      `${PLACED.replace('select d.*', 'select d.*, q.key as q_key, q.number as q_number')} join decision_aliases a on a.decision_id = d.id join decision_registries ar on ar.id = a.registry_id join unnest($2::text[], $3::int[]) as q(key, number) on ar.${match} = q.key and a.number = q.number where d.org_id = $1`,
      [orgId, rest.map((e) => e.key), rest.map((e) => e.number)],
    );
    for (const { q_key, q_number, ...row } of moved) for (const t of byPlace(q_key, q_number)?.texts ?? []) if (!out.has(t)) out.set(t, { row, alias: true });
  }
  return out;
}

export async function placedByRef(db: Db, orgId: string, text: string, home?: string): Promise<PlacedRow | undefined> {
  return (await resolveRef(db, orgId, text, home))?.row;
}

export interface AliasRow {
  readonly decision_id: string;
  readonly registry_id: string;
  readonly prefix: string;
  readonly number: number;
}

/** The numbers each record held before it moved, oldest first. */
export async function aliasesOf(db: Db, decisionIds: readonly string[]): Promise<AliasRow[]> {
  if (!decisionIds.length) return [];
  return db.query<AliasRow>('select a.decision_id, a.registry_id, r.prefix, a.number from decision_aliases a join decision_registries r on r.id = a.registry_id where a.decision_id = any($1::text[]) order by a.created_at, r.prefix, a.number', [[...decisionIds]]);
}

/** Moves a record to a new registry and number: the old number stays with it as an alias, and an alias of its own at the new number is taken back. */
export async function moveRow(db: Db, row: PlacedRow, to: { registryId: string; number: number }): Promise<void> {
  await db.query('insert into decision_aliases (org_id, registry_id, number, decision_id) values ($1, $2, $3, $4)', [row.org_id, row.registry_id, row.number, row.id]);
  await db.query('delete from decision_aliases where registry_id = $1 and number = $2 and decision_id = $3', [to.registryId, to.number, row.id]);
  await db.query('update decisions set registry_id = $2, number = $3, category = $4, updated_at = now() where id = $1', [row.id, to.registryId, to.number, Math.floor(to.number / 1000)]);
}

export interface ListFilter {
  readonly category?: number | undefined;
  readonly status?: DecisionStatus | undefined;
  readonly query?: string | undefined;
}

export async function listPlaced(db: Db, registryIds: readonly string[], filter: ListFilter = {}, limit = 500): Promise<PlacedRow[]> {
  const params: unknown[] = [[...registryIds]];
  let where = 'd.registry_id = any($1::text[])';
  if (filter.category !== undefined) {
    params.push(filter.category);
    where += ` and d.category = $${params.length}`;
  }
  if (filter.status) {
    params.push(filter.status);
    where += ` and d.status = $${params.length}`;
  }
  if (filter.query?.trim()) {
    params.push(filter.query);
    where += ` and d.search @@ websearch_to_tsquery('english', $${params.length})`;
  }
  params.push(limit);
  return db.query<PlacedRow>(`${PLACED} where ${where} order by r.prefix, d.number limit $${params.length}`, params);
}

export interface NewDecisionRow {
  readonly id: string;
  readonly org_id: string;
  readonly registry_id: string;
  readonly number: number;
  readonly category: number;
  readonly title: string;
  readonly status: DecisionStatus;
  readonly decided_on: string | null;
  readonly updated_on: string;
  readonly deciders: readonly string[];
  readonly context: string;
  readonly decision: string;
  readonly consequences: string;
  readonly alternatives: readonly Alternative[];
  readonly related: readonly string[];
  readonly alignment: Alignment | null;
  readonly supersedes_id: string | null;
  readonly created_by: string | null;
}

export async function insertDecision(db: Db, r: NewDecisionRow): Promise<void> {
  await db.query(
    `insert into decisions (id, org_id, registry_id, number, category, title, status, decided_on, updated_on, deciders, context, decision, consequences, alternatives, related, alignment, supersedes_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [r.id, r.org_id, r.registry_id, r.number, r.category, r.title, r.status, r.decided_on, r.updated_on, JSON.stringify(r.deciders), r.context, r.decision, r.consequences, JSON.stringify(r.alternatives), JSON.stringify(r.related), r.alignment ? JSON.stringify(r.alignment) : null, r.supersedes_id, r.created_by],
  );
}

export type DecisionFields = Pick<DecisionRow, 'title' | 'status' | 'decided_on' | 'updated_on' | 'deciders' | 'context' | 'decision' | 'consequences' | 'alternatives' | 'related' | 'alignment' | 'superseded_by_id' | 'supersedes_id'>;

export async function updateDecisionRow(db: Db, id: string, f: DecisionFields): Promise<void> {
  await db.query(
    `update decisions set title = $2, status = $3, decided_on = $4, updated_on = $5, deciders = $6, context = $7, decision = $8, consequences = $9, alternatives = $10, related = $11, alignment = $12, superseded_by_id = $13, supersedes_id = $14, updated_at = now() where id = $1`,
    [id, f.title, f.status, f.decided_on, f.updated_on, JSON.stringify(f.deciders), f.context, f.decision, f.consequences, JSON.stringify(f.alternatives), JSON.stringify(f.related), f.alignment ? JSON.stringify(f.alignment) : null, f.superseded_by_id, f.supersedes_id],
  );
}

/** Weighs the citation, the numbers it held before it moved, and the title over the body, so SHOP-2001 or a title word finds its record first. */
export async function reindex(db: Db, id: string): Promise<void> {
  await db.query(
    `update decisions d set search =
        setweight(to_tsvector('simple', r.prefix || '-' || lpad(d.number::text, 4, '0') || ' adr-' || lpad(d.number::text, 4, '0')), 'A')
     || setweight(to_tsvector('simple', coalesce((select string_agg(ar.prefix || '-' || lpad(a.number::text, 4, '0'), ' ') from decision_aliases a join decision_registries ar on ar.id = a.registry_id where a.decision_id = d.id), '')), 'A')
     || setweight(to_tsvector('english', d.title), 'A')
     || setweight(to_tsvector('english', d.context || ' ' || d.decision || ' ' || d.consequences || ' ' || coalesce((select string_agg(a->>'option' || ' ' || (a->>'rejected'), ' ') from jsonb_array_elements(d.alternatives) a), '')), 'B')
     || setweight(to_tsvector('simple', coalesce((select string_agg(x, ' ') from jsonb_array_elements_text(d.deciders) x), '')), 'C')
       from decision_registries r where r.id = d.registry_id and d.id = $1`,
    [id],
  );
}

export async function linksOf(db: Db, decisionIds: readonly string[]): Promise<LinkRow[]> {
  if (!decisionIds.length) return [];
  return db.query<LinkRow>('select decision_id, document_id, target_kind, target_id from decision_links where decision_id = any($1::text[]) order by document_id, target_kind, target_id', [[...decisionIds]]);
}

export async function linksToDocument(db: Db, documentId: string): Promise<LinkRow[]> {
  return db.query<LinkRow>('select decision_id, document_id, target_kind, target_id from decision_links where document_id = $1', [documentId]);
}

export async function setLinks(db: Db, orgId: string, decisionId: string, links: readonly Omit<LinkRow, 'decision_id'>[]): Promise<void> {
  await db.query('delete from decision_links where decision_id = $1', [decisionId]);
  for (const l of links) {
    await db.query('insert into decision_links (decision_id, org_id, document_id, target_kind, target_id) values ($1, $2, $3, $4, $5) on conflict do nothing', [decisionId, orgId, l.document_id, l.target_kind, l.target_id]);
  }
}

export async function addRevision(db: Db, r: { orgId: string; decisionId: string; snapshot: unknown; message: string; authorUserId: string | null; surface: string }): Promise<void> {
  await db.query('insert into decision_revisions (id, org_id, decision_id, snapshot, message, author_user_id, surface) values ($1, $2, $3, $4, $5, $6, $7)', [
    randomId(),
    r.orgId,
    r.decisionId,
    JSON.stringify(r.snapshot),
    r.message,
    r.authorUserId,
    r.surface,
  ]);
}

export interface RevisionRow {
  readonly id: string;
  readonly snapshot: Record<string, unknown>;
  readonly message: string;
  readonly author_user_id: string | null;
  readonly author_label: string | null;
  readonly surface: string;
  readonly created_at: Date;
}

export async function revisionsOf(db: Db, decisionId: string): Promise<RevisionRow[]> {
  return db.query<RevisionRow>(
    `select v.id, v.snapshot, v.message, v.author_user_id, coalesce(u.display_name, u.email) as author_label, v.surface, v.created_at
       from decision_revisions v left join users u on u.id = v.author_user_id
      where v.decision_id = $1 order by v.created_at desc, v.id`,
    [decisionId],
  );
}


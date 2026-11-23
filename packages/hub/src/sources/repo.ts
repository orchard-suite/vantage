/**
 * Rows and reads for connectors, their observed models, runs, and mappings.
 * A connector belongs to one workspace and runs outside the hub; it signs
 * in with its own OAuth client, whose id the row holds. One with an interval
 * runs in the shared pool on the hub's schedule (`runs.ts`). Its slug is unique
 * in the workspace and is the prefix every observed entity key carries, so
 * a document only ever reads the connectors of its own workspace.
 */
import { parse as parseYaml } from 'yaml';
import { emptyObserved, MappingSchema, type Mapping, type ObservedEntity, type ObservedItem, type ObservedModel, type ObservedProvenance, type ObservedRelation } from '@vantage/connectors';
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';

export type Approval = 'pending' | 'approved' | 'stopped';

export interface SourceLastRun {
  readonly at: string;
  readonly status: 'ok' | 'failed';
  readonly trigger: RunTrigger;
  readonly counts: RunCounts;
  readonly warnings: number;
  readonly error?: string;
}

export interface SourceRow {
  readonly id: string;
  readonly org_id: string;
  readonly workspace_id: string;
  readonly name: string;
  readonly slug: string;
  /** The connector kind the runner runs (azure-resource-graph, orrery, http, push). */
  readonly connector: string;
  readonly config: Record<string, unknown>;
  /** The OAuth client that may read this connector's settings and push to it. */
  readonly client_id: string;
  /** Minutes between the runs the hub schedules in the shared pool; null runs on a runner of its own or is pushed to. */
  readonly every_minutes: number | null;
  readonly enabled: boolean;
  readonly created_by: string | null;
  readonly approval: Approval;
  readonly approval_by: string | null;
  readonly approval_at: Date | null;
  readonly last_run: SourceLastRun | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export type RunTrigger = 'push';

export interface RunCounts {
  readonly entities: number;
  readonly relations: number;
  readonly appeared: number;
  readonly vanished: number;
  readonly returned: number;
  readonly factChanges: number;
  /** Open items this connector reports now, and how many opened and closed in this run. */
  readonly itemsOpen?: number;
  readonly itemsOpened?: number;
  readonly itemsClosed?: number;
  readonly documentsOverlaid: number;
}

export interface SourceRunRow {
  readonly id: string;
  readonly org_id: string;
  readonly source_id: string;
  readonly job_id: string | null;
  readonly trigger: RunTrigger;
  readonly status: 'ok' | 'failed';
  readonly started_at: Date;
  readonly finished_at: Date;
  readonly counts: Partial<RunCounts>;
  readonly warnings: readonly string[];
  readonly error: string | null;
}

export interface MappingRow {
  readonly id: string;
  readonly org_id: string;
  readonly source_id: string;
  readonly name: string;
  readonly yaml: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const SOURCE = 'select id, org_id, workspace_id, name, slug, connector, config, client_id, every_minutes, enabled, created_by, approval, approval_by, approval_at, last_run, created_at, updated_at from sources';

/** The connectors of one workspace. Its readers see these and nothing else. */
export async function workspaceConnectors(db: Db, workspaceId: string): Promise<SourceRow[]> {
  return db.query<SourceRow>(`${SOURCE} where workspace_id = $1 order by name`, [workspaceId]);
}

/** Connectors the scheduler may queue in the pool: an interval, and neither stopped by an admin nor paused. */
export async function scheduledConnectors(db: Db): Promise<SourceRow[]> {
  return db.query<SourceRow>(`${SOURCE} where every_minutes is not null and enabled and approval <> 'stopped'`);
}

/** One connector of a workspace, by id or slug. */
export async function connectorIn(db: Db, workspaceId: string, ref: string): Promise<SourceRow | undefined> {
  return maybe<SourceRow>(db, `${SOURCE} where workspace_id = $1 and (id = $2 or slug = $2)`, [workspaceId, ref]);
}

/** One connector by id, whatever workspace holds it: the worker and the admin page. */
export async function sourceById(db: Db, id: string): Promise<SourceRow | undefined> {
  return maybe<SourceRow>(db, `${SOURCE} where id = $1`, [id]);
}

/** Every connector a client may act as: the same OAuth app may serve one connector in each of several workspaces. */
export async function connectorsForClient(db: Db, clientId: string): Promise<SourceRow[]> {
  return db.query<SourceRow>(`${SOURCE} where lower(client_id) = lower($1) order by name`, [clientId]);
}

/** Every connector in the org with its workspace, waiting ones first, for the admin page. */
export async function orgConnectors(db: Db, orgId: string): Promise<(SourceRow & { workspace_slug: string; workspace_name: string; created_by_name: string | null })[]> {
  return db.query(
    `select s.id, s.org_id, s.workspace_id, s.name, s.slug, s.connector, s.config, s.client_id, s.every_minutes, s.enabled, s.created_by, s.approval, s.approval_by, s.approval_at, s.last_run, s.created_at, s.updated_at,
            w.slug as workspace_slug, w.name as workspace_name, coalesce(u.display_name, u.email, u.subject) as created_by_name
       from sources s join workspaces w on w.id = s.workspace_id left join users u on u.id = s.created_by
      where s.org_id = $1
      order by case s.approval when 'pending' then 0 when 'approved' then 1 else 2 end, w.name, s.name`,
    [orgId],
  );
}

export async function setConnectorApproval(db: Db, id: string, approval: Exclude<Approval, 'pending'>, by: string): Promise<void> {
  await db.query('update sources set approval = $2, approval_by = $3, approval_at = now(), updated_at = now() where id = $1', [id, approval, by]);
}

/** Why a connector may not push now, or undefined when it may. */
export function connectorBlocked(row: Pick<SourceRow, 'approval' | 'enabled'>, approvalRequired: boolean): string | undefined {
  if (row.approval === 'stopped') return 'an admin stopped this connector';
  if (approvalRequired && row.approval !== 'approved') return 'this connector is waiting for an admin to approve it';
  if (!row.enabled) return 'its authors paused this connector';
  return undefined;
}

/** Fields that say what a connector reads and as whom; changing any of them takes back an approval. */
export function connectorChanged(before: Pick<SourceRow, 'connector' | 'client_id' | 'config'>, after: Pick<SourceRow, 'connector' | 'client_id' | 'config'>): boolean {
  return before.connector !== after.connector || before.client_id.toLowerCase() !== after.client_id.toLowerCase() || JSON.stringify(before.config) !== JSON.stringify(after.config);
}

/**
 * Observed models by source, kept in memory while their stored version is
 * current: every render of every bound document reads the same model, and
 * a large one is tens of megabytes to fetch and parse. A cheap version
 * read decides whether the copy is still good. The oldest go first once
 * the copies hold more than CACHE_ENTITIES entities. Callers never change
 * a model they read; a merge builds a new one.
 */
const CACHE_ENTITIES = 2_000_000;
const caches = new WeakMap<Db, Map<string, { version: number; model: ObservedModel; size: number }>>();

function cacheOf(db: Db): Map<string, { version: number; model: ObservedModel; size: number }> {
  let c = caches.get(db);
  if (!c) caches.set(db, (c = new Map()));
  return c;
}

function remember(db: Db, sourceId: string, version: number, model: ObservedModel): void {
  const c = cacheOf(db);
  c.delete(sourceId);
  c.set(sourceId, { version, model, size: Object.keys(model.entities).length + Object.keys(model.relations).length });
  let total = 0;
  for (const e of c.values()) total += e.size;
  for (const [id, e] of c) {
    if (total <= CACHE_ENTITIES || c.size === 1) break;
    c.delete(id);
    total -= e.size;
  }
}

type Item = ObservedEntity | ObservedRelation | ObservedItem;
/** An item as stored: without the time it was last seen, which the row or the source carries. */
type Stored<T extends Item> = Omit<T, 'observed' | 'provenance'> & { readonly provenance?: Omit<ObservedProvenance, 'observed'> };
interface ItemRow<T extends Item> {
  readonly key: string;
  readonly data: Stored<T>;
  readonly observed: string;
}

function stored<T extends Item>(item: T): Stored<T> {
  if (!('provenance' in item)) {
    const { observed: _o, ...rest } = item;
    return rest as Stored<T>;
  }
  const { observed: _o, provenance, ...rest } = item;
  const { observed: _p, ...kept } = provenance;
  return { ...rest, provenance: kept } as Stored<T>;
}

/** The time a stored item was last seen: its own, or the source's last full read when that saw it later. */
function revive<T extends Item>(row: ItemRow<T>, fullObserved: string | null): T {
  const present = !('missingSince' in row.data) || row.data.missingSince === undefined;
  const observed = present && fullObserved !== null && Date.parse(fullObserved) > Date.parse(row.observed) ? fullObserved : row.observed;
  return (row.data.provenance ? { ...row.data, observed, provenance: { ...row.data.provenance, observed } } : { ...row.data, observed }) as T;
}

/** The observed model of one source, from the cache when its version is current. */
export async function observedModel(db: Db, sourceId: string, opts: { cache?: Db } = {}): Promise<{ model: ObservedModel; version: number }> {
  const cacheDb = opts.cache ?? db;
  const current = await maybe<{ version: number; full_observed: string | null }>(db, 'select version, full_observed from observed_models where source_id = $1', [sourceId]);
  if (!current) return { model: emptyObserved(), version: 0 };
  const hit = cacheOf(cacheDb).get(sourceId);
  if (hit && hit.version === current.version) return { model: hit.model, version: hit.version };
  const entities: ObservedModel['entities'] = {};
  const relations: ObservedModel['relations'] = {};
  // In key order: the model is built in the order rows arrive, and the same rows must draw the same picture.
  for (const r of await db.query<ItemRow<ObservedEntity>>('select key, data, observed from observed_entities where source_id = $1 order by key', [sourceId])) entities[r.key] = revive(r, current.full_observed);
  for (const r of await db.query<ItemRow<ObservedRelation>>('select key, data, observed from observed_relations where source_id = $1 order by key', [sourceId])) relations[r.key] = revive(r, current.full_observed);
  const items: Record<string, ObservedItem> = {};
  for (const r of await db.query<ItemRow<ObservedItem>>('select key, data, observed from observed_items where source_id = $1 order by key', [sourceId])) items[r.key] = revive(r, current.full_observed);
  const model: ObservedModel = { entities, relations, items };
  remember(cacheDb, sourceId, current.version, model);
  return { model, version: current.version };
}

const CHUNK = 2_000;

/** Upserts `items` and deletes `gone` in one table, in chunks. */
async function writeItems(tx: Db, table: 'observed_entities' | 'observed_relations' | 'observed_items', sourceId: string, items: readonly Item[], gone: readonly string[]): Promise<void> {
  for (let i = 0; i < items.length; i += CHUNK) {
    const part = items.slice(i, i + CHUNK);
    await tx.query(
      `insert into ${table} (source_id, key, data, observed)
         select $1, k, d::jsonb, o from unnest($2::text[], $3::text[], $4::text[]) as t(k, d, o)
         on conflict (source_id, key) do update set data = excluded.data, observed = excluded.observed`,
      [sourceId, part.map((x) => x.key), part.map((x) => JSON.stringify(stored(x))), part.map((x) => x.observed)],
    );
  }
  for (let i = 0; i < gone.length; i += CHUNK) await tx.query(`delete from ${table} where source_id = $1 and key = any($2::text[])`, [sourceId, gone.slice(i, i + CHUNK)]);
}

/** JSON with every object's keys sorted: the same text for the same content, whatever order the keys came in (Postgres stores jsonb keys in its own order). */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
}

/**
 * The rows that differ between two models of one source: items whose
 * stored content changed (new, changed facts or fields, gone missing,
 * returned), items a partial slice saw (their own time moves), and keys
 * no longer there. A full read that only saw an item again writes nothing
 * for it; the source's full_observed carries the time.
 */
export function observedDelta(previous: ObservedModel, next: ObservedModel, batch: { readonly observed: string; readonly partial?: boolean | undefined }): { entities: Item[]; relations: Item[]; items: Item[]; goneEntities: string[]; goneRelations: string[]; goneItems: string[] } {
  const diff = (before: Record<string, Item>, after: Record<string, Item>): { write: Item[]; gone: string[] } => {
    const write: Item[] = [];
    for (const [key, item] of Object.entries(after)) {
      const old = before[key];
      if (!old || (batch.partial && item.observed === batch.observed) || canonical(stored(old)) !== canonical(stored(item))) write.push(item);
    }
    return { write, gone: Object.keys(before).filter((k) => !(k in after)) };
  };
  const e = diff(previous.entities, next.entities);
  const r = diff(previous.relations, next.relations);
  const i = diff(previous.items ?? {}, next.items ?? {});
  return { entities: e.write, relations: r.write, items: i.write, goneEntities: e.gone, goneRelations: r.gone, goneItems: i.gone };
}

/**
 * Folds one batch into a source's stored model under a lock on the source,
 * so two runs of one source never merge against the same old model: reads
 * the current model, lets `merge` build the next, and writes the rows that
 * differ. Returns what `merge` returned and the new version. A full batch
 * observed before the last full read is stale (two pushes finished out of
 * order) and changes nothing.
 */
export async function updateObservedModel<T extends { model: ObservedModel }>(
  db: Db,
  source: SourceRow,
  batch: { readonly observed: string; readonly partial?: boolean | undefined },
  merge: (previous: ObservedModel) => T,
): Promise<(T & { version: number; written: number; stale?: undefined }) | { stale: string }> {
  const out = await db.transaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`vantage.observed.${source.id}`]);
    const last = await maybe<{ full_observed: string | null }>(tx, 'select full_observed from observed_models where source_id = $1', [source.id]);
    if (!batch.partial && last?.full_observed && Date.parse(batch.observed) < Date.parse(last.full_observed)) return { stale: `observed ${batch.observed}, before the last full read at ${last.full_observed}` };
    const previous = await observedModel(tx, source.id, { cache: db });
    const merged = merge(previous.model);
    const delta = observedDelta(previous.model, merged.model, batch);
    await writeItems(tx, 'observed_entities', source.id, delta.entities, delta.goneEntities);
    await writeItems(tx, 'observed_relations', source.id, delta.relations, delta.goneRelations);
    await writeItems(tx, 'observed_items', source.id, delta.items, delta.goneItems);
    const rows = await tx.query<{ version: number }>(
      `insert into observed_models (org_id, source_id, version, full_observed) values ($1, $2, 1, $3)
         on conflict (source_id) do update set version = observed_models.version + 1, full_observed = coalesce(excluded.full_observed, observed_models.full_observed), updated_at = now()
         returning version`,
      [source.org_id, source.id, batch.partial ? null : batch.observed],
    );
    const written = delta.entities.length + delta.relations.length + delta.items.length + delta.goneEntities.length + delta.goneRelations.length + delta.goneItems.length;
    return { ...merged, version: rows[0]!.version, written, stale: undefined };
  });
  // The merged model holds its items in merge order and its facts in the batch's key order; a read
  // from the rows holds them in another. Readers draw from the rows' form only, so the next read loads it.
  if (out.stale === undefined) cacheOf(db).delete(source.id);
  return out;
}

/**
 * The observed entities and relations of a workspace's connectors, as one
 * model (keys are slug-prefixed and slugs are unique in a workspace, so they
 * never collide). `only` narrows it to the connectors a document draws from.
 */
export async function observedForWorkspace(db: Db, workspaceId: string, only?: readonly string[]): Promise<{ model: ObservedModel; sources: readonly string[] }> {
  const sources = (await workspaceConnectors(db, workspaceId)).filter((s) => !only || only.includes(s.slug));
  const entities: Record<string, ObservedModel['entities'][string]> = {};
  const relations: Record<string, ObservedModel['relations'][string]> = {};
  const items: Record<string, ObservedItem> = {};
  for (const s of sources) {
    const { model } = await observedModel(db, s.id);
    Object.assign(entities, model.entities);
    Object.assign(relations, model.relations);
    Object.assign(items, model.items);
  }
  return { model: { entities, relations, items }, sources: sources.map((s) => s.slug) };
}

export async function recordRun(db: Db, run: Omit<SourceRunRow, 'org_id'> & { readonly orgId: string }): Promise<void> {
  await db.query('insert into source_runs (id, org_id, source_id, job_id, trigger, status, started_at, finished_at, counts, warnings, error) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)', [
    run.id,
    run.orgId,
    run.source_id,
    run.job_id,
    run.trigger,
    run.status,
    run.started_at,
    run.finished_at,
    JSON.stringify(run.counts),
    JSON.stringify(run.warnings),
    run.error,
  ]);
  const last: SourceLastRun = { at: run.finished_at.toISOString(), status: run.status, trigger: run.trigger, counts: { entities: 0, relations: 0, appeared: 0, vanished: 0, returned: 0, factChanges: 0, documentsOverlaid: 0, ...run.counts }, warnings: run.warnings.length, ...(run.error ? { error: run.error } : {}) };
  await db.query('update sources set last_run = $2, updated_at = now() where id = $1', [run.source_id, JSON.stringify(last)]);
}

export async function listRuns(db: Db, sourceId: string, limit = 50): Promise<SourceRunRow[]> {
  return db.query<SourceRunRow>('select * from source_runs where source_id = $1 order by started_at desc limit $2', [sourceId, Math.min(limit, 500)]);
}

export async function listMappings(db: Db, sourceId: string): Promise<MappingRow[]> {
  return db.query<MappingRow>('select * from mappings where source_id = $1 order by name', [sourceId]);
}

/** Parses mapping YAML; returns the mapping or the problems a caller shows. */
export function parseMapping(yaml: string, sourceSlug: string): { mapping?: Mapping; problems: string[] } {
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch (err) {
    return { problems: [`yaml: ${(err as Error).message}`] };
  }
  const parsed = MappingSchema.safeParse(raw);
  if (!parsed.success) return { problems: parsed.error.issues.map((i) => `${i.path.join('.') || 'mapping'}: ${i.message}`) };
  if (parsed.data.source !== sourceSlug) return { problems: [`source: mapping names ${parsed.data.source} but this source is ${sourceSlug}`] };
  return { mapping: parsed.data, problems: [] };
}

/** The mapping a run applies: the first by name that parses. One source, one mapping in effect; the rest are drafts. */
export async function activeMapping(db: Db, source: SourceRow): Promise<{ mapping: Mapping; row: MappingRow } | undefined> {
  for (const row of await listMappings(db, source.id)) {
    const { mapping } = parseMapping(row.yaml, source.slug);
    if (mapping) return { mapping, row };
  }
  return undefined;
}

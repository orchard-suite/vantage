/**
 * Rendering one version into its artifacts, with the observed layer laid
 * over bound nodes, boxes dimmed past the workspace freshness threshold,
 * and a drift report. The drawing runs on the render pool (draw.ts). Each render
 * writes its files into a folder of its own and swaps its rows in one
 * transaction, so a reader sees the last render or the new one, never a
 * mix; the old files go after the swap. An overlay whose inputs match the
 * last render's digest draws nothing and only refreshes the drift report.
 * A view's SVG and PNG and the standalone HTML are made on first request
 * (derived.ts).
 *
 * A render reads the document's last render as a cache: unchanged views are
 * taken as they were, and their rows name the entries already stored.
 */
import { boxDependents, rework, reworkDocument } from '../tracking/worked.ts';
import { lockFeed } from '../tracking/store.ts';
import { bindsOf, freshness, itemsNeeded, observedNeeded, type Drift, type ObservedItem, type ObservedModel } from '@vantage/connectors';
import { documentsOf, loadStored, searchText } from '../documents/model.ts';
import { pagesSearchText } from '../documents/pages.ts';
import type { AppContext } from '../context.ts';
import { channelName, maybe, type Db } from '../db/db.ts';
import { randomId } from '../crypto.ts';
import { documentById, type DocumentRow, type RenderedKind, type VersionRow } from '../documents/repo.ts';
import { observedModel, workspaceConnectors } from '../sources/repo.ts';
import { resourceInputs } from '../documents/assets.ts';
import { shellBundle, type CachedView, type RangeView } from '../render/document-task.ts';
import { drawDocument, poolRunner, type DrawResult } from './draw.ts';
import { RENDERER } from '../render/renderer.ts';
import { enqueue, type JobLog } from './jobs.ts';

export const DOC_CHANNEL_PREFIX = 'vantage_doc';

/** How long a replaced render's files stay readable. */
export const FILES_GRACE_MS = 120_000;

export interface RenderOutcome {
  readonly hash: string;
  readonly artifacts: number;
  readonly reused: boolean;
  /** True when the inputs matched the last render and nothing was drawn. */
  readonly skipped?: boolean;
  readonly errors: number;
  readonly drift: Drift['counts'];
  /** True when the drift report differs from the one stored before this render. */
  readonly driftChanged: boolean;
  readonly sources: readonly string[];
}

export interface DriftReportRow {
  readonly document_id: string;
  readonly version_id: string;
  readonly report: Drift;
  readonly counts: Drift['counts'];
  readonly updated_at: Date;
}

export interface RenderState {
  readonly version_hash: string;
  readonly render_id: string;
  readonly digest: string;
  /** The release that drew it; null for renders older than the column. */
  readonly renderer: string | null;
}

export async function driftReport(ctx: AppContext, documentId: string): Promise<DriftReportRow | undefined> {
  return maybe<DriftReportRow>(ctx.db, 'select document_id, version_id, report, counts, updated_at from drift_reports where document_id = $1', [documentId]);
}

export async function renderState(db: Db, hash: string): Promise<RenderState | undefined> {
  return maybe<RenderState>(db, 'select version_hash, render_id, digest, renderer from render_states where version_hash = $1', [hash]);
}

/** What a render kept of each view (its digest, anchors, and size); null when the document did not parse. Large: read only where needed. */
export async function renderViews(db: Db, hash: string): Promise<Readonly<Record<string, CachedView>> | null | undefined> {
  return (await maybe<{ views: Record<string, CachedView> | null }>(db, 'select views from render_states where version_hash = $1', [hash]))?.views;
}

/** The freshness threshold in days for a workspace: its setting, else the hub default. */
export async function freshnessDays(ctx: AppContext, workspaceId: string): Promise<number> {
  const row = await maybe<{ days: number | null }>(ctx.db, "select (settings->>'freshnessDays')::int as days from workspaces where id = $1", [workspaceId]);
  return row?.days ?? ctx.config.FRESHNESS_DAYS;
}

export function bundleUrl(ctx: AppContext, documentId: string): string {
  return `${ctx.config.PUBLIC_URL}/api/v1/documents/${documentId}/bundle`;
}

/**
 * The observed layer one version reads: of the connectors of its workspace
 * that it binds or observes, only the entities and relations it looks
 * at, and of every connector of the workspace, the open items that point
 * at a box it binds. A render thread receives a copy, so a small document
 * bound to a large source stays a small task.
 */
export async function observedForDocument(ctx: AppContext, doc: DocumentRow, version: Pick<VersionRow, 'yaml' | 'imports'>): Promise<{ model: ObservedModel; sources: readonly string[] }> {
  const docs = documentsOf(version.yaml, version.imports);
  // In a fixed order, so the same observations always build the same model.
  const all = (await workspaceConnectors(ctx.db, doc.workspace_id)).sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const sources = all.filter((s) => doc.bind_sources.includes(s.slug));
  const entities: ObservedModel['entities'] = {};
  const relations: ObservedModel['relations'] = {};
  for (const s of sources) {
    // Narrow each source before merging, so a large source is never copied whole.
    const needed = observedNeeded(docs, (await observedModel(ctx.db, s.id)).model);
    Object.assign(entities, needed.entities);
    Object.assign(relations, needed.relations);
  }
  const binds = bindsOf(docs);
  const items: Record<string, ObservedItem> = {};
  // Items of any connector may point at a bound box, by key or by fact; only bound documents read them.
  if (binds.size) for (const s of all) Object.assign(items, itemsNeeded(binds, entities, (await observedModel(ctx.db, s.id)).model.items));
  const reporting = all.filter((s) => !doc.bind_sources.includes(s.slug) && Object.values(items).some((i) => i.source === s.slug)).map((s) => s.slug);
  return { model: { entities, relations, ...(Object.keys(items).length ? { items } : {}) }, sources: [...sources.map((s) => s.slug), ...reporting] };
}

/** The render pool's input for a version: its text, the observed layer, and its icons and pictures. */
export async function renderInput(ctx: AppContext, doc: DocumentRow, version: VersionRow) {
  const observed = await observedForDocument(ctx, doc, version);
  const resources = await resourceInputs(ctx, { orgId: version.org_id, workspaceId: doc.workspace_id, attachments: version.attachments });
  const thresholdDays = await freshnessDays(ctx, doc.workspace_id);
  return { observed, input: { yaml: version.yaml, imports: version.imports, hash: version.hash, observed: observed.model, resources, thresholdDays, now: new Date().toISOString() } };
}

interface Written {
  readonly viewId: string;
  /** A view entry's digest. */
  readonly digest?: string;
  readonly kind: RenderedKind;
  readonly key: string;
  readonly bytes: number;
  readonly contentType: string;
}

async function storeDrift(ctx: AppContext, doc: DocumentRow, version: VersionRow, report: Drift, tx: Db = ctx.db): Promise<boolean> {
  const previous = await maybe<{ items: unknown }>(tx, "select report->'items' as items from drift_reports where document_id = $1", [doc.id]);
  const changed = JSON.stringify(previous?.items ?? []) !== JSON.stringify(report.items);
  await tx.query(
    `insert into drift_reports (org_id, document_id, version_id, report, counts) values ($1, $2, $3, $4, $5)
       on conflict (document_id) do update set version_id = excluded.version_id, report = excluded.report, counts = excluded.counts, updated_at = now()`,
    [version.org_id, doc.id, version.id, JSON.stringify(report), JSON.stringify(report.counts)],
  );
  // What a box saw may be a roadmap item's proof; the hub moves the item in the same transaction as the report.
  if (changed) {
    const moved = tx === ctx.db ? await reworkDocument(ctx.db, version.org_id, doc.id) : await reworkInTx(tx, version.org_id, doc.id);
    if (moved.length) ctx.log.info('items.reworked', { documentId: doc.id, items: moved });
  }
  return changed;
}

async function reworkInTx(tx: Db, orgId: string, documentId: string): Promise<string[]> {
  const ids = await boxDependents(tx, documentId);
  if (!ids.length) return [];
  await lockFeed(tx, orgId);
  return rework(tx, orgId, ids);
}

/** The last render of a document that kept its views, with its files by view and kind: what the next render reuses. */
interface CacheSource {
  readonly cached: Readonly<Record<string, CachedView>>;
  readonly files: ReadonlyMap<string, ArtifactKey>;
}

interface ArtifactKey {
  readonly key: string;
  readonly contentType: string;
  readonly bytes: number;
}

async function cacheSource(ctx: AppContext, documentId: string): Promise<CacheSource | undefined> {
  const state = await maybe<{ version_hash: string; render_id: string; views: Record<string, CachedView> }>(
    ctx.db,
    `select rs.version_hash, rs.render_id, rs.views from render_states rs
       where rs.views is not null and rs.version_hash in (select hash from versions where document_id = $1)
       order by rs.updated_at desc limit 1`,
    [documentId],
  );
  if (!state) return undefined;
  const rows = await ctx.db.query<{ view_id: string; blob_key: string; content_type: string; bytes: string }>("select view_id, blob_key, content_type, bytes from artifacts where version_hash = $1 and render_id = $2 and kind = 'view'", [state.version_hash, state.render_id]);
  const files = new Map(rows.map((r) => [r.view_id, { key: r.blob_key, contentType: r.content_type, bytes: Number(r.bytes) }]));
  // A view with no stored entry (a render from before entries were stored apart) is drawn again; its anchors still start a range.
  const cached = Object.fromEntries(Object.entries(state.views).map(([id, v]) => [id, files.has(id) ? v : { ...v, digest: '' }]));
  return { cached, files };
}

export async function renderVersion(ctx: AppContext, version: VersionRow, opts: { replace: boolean; jlog: JobLog; trigger: 'save' | 'overlay' }): Promise<RenderOutcome> {
  const log = ctx.log.child({ versionId: version.id, documentId: version.document_id });
  const doc = await documentById(ctx.db, version.document_id);
  if (!doc) throw new Error(`document ${version.document_id} not found`);
  const started = Date.now();
  const { observed, input } = await renderInput(ctx, doc, version);
  const previous = await renderState(ctx.db, version.hash);
  const source = await cacheSource(ctx, doc.id);
  log.info('render.start', { hash: version.hash, replace: opts.replace, binds: doc.bind_sources, visibleSources: observed.sources, observedEntities: Object.keys(observed.model.entities).length, openItems: Object.keys(observed.model.items ?? {}).length, thresholdDays: input.thresholdDays, previous: previous?.render_id ?? null, cached: source ? Object.keys(source.cached).length : 0 });
  const inputMs = Date.now() - started;
  const out = await drawDocument(poolRunner(ctx, { background: opts.trigger === 'overlay' }), { ...input, cached: source?.cached }, { previousDigest: opts.replace ? previous?.digest : undefined });
  const drawMs = Date.now() - started - inputMs;

  if (out.kind === 'skipped') {
    // A matching digest means this release would draw the same picture, so the render counts as this release's.
    await ctx.db.query('update render_states set renderer = $2 where version_hash = $1', [version.hash, RENDERER]);
    const driftChanged = await storeDrift(ctx, doc, version, out.drift);
    opts.jlog.add('info', 'inputs match the last render; nothing drawn', { digest: out.digest, driftChanged });
    log.info('render.skipped', { hash: version.hash, digest: out.digest, ms: drawMs, driftChanged, drift: out.drift.counts });
    return { hash: version.hash, artifacts: 0, reused: true, skipped: true, errors: out.errors, drift: out.drift.counts, driftChanged, sources: observed.sources };
  }

  const stored = await storeRender(ctx, doc, version, out, source, { jlog: opts.jlog, log });
  await indexPages(ctx, doc, version, input.resources.files);
  await notifyDocument(ctx, doc.id, version.id, version.hash);
  const pictureMs = Date.now() - started;
  ctx.metrics.renderPass.record(pictureMs / 1000, { pass: 'picture', trigger: opts.trigger });
  if (opts.trigger === 'save' && !previous) ctx.metrics.firstPicture.record((Date.now() - version.created_at.getTime()) / 1000);
  const ranges = out.kind === 'rendered' ? { ranges: out.ranges, redrawn: out.redrawn } : {};
  log.info('render.picture', { renderId: stored.renderId, drawn: stored.drawn, reused: stored.reused, drawnViews: stored.drawnViews, ...ranges, ms: pictureMs, inputMs, drawMs, storeMs: pictureMs - inputMs - drawMs, filesMs: stored.filesMs, rowsMs: stored.rowsMs });

  const grades = freshness(observed.model, new Date(input.now), input.thresholdDays);
  const bound = Object.values(observed.model.entities).filter((e) => doc.bind_sources.includes(e.source));
  const fresh = bound.filter((e) => grades[e.key] === 'fresh').length;
  const stale = bound.filter((e) => grades[e.key] === 'stale').length;
  const missing = bound.filter((e) => grades[e.key] === 'missing').length;
  opts.jlog.add('info', 'render complete', { renderId: stored.renderId, artifacts: stored.artifacts, errors: out.errors, drift: out.drift.counts, driftChanged: stored.driftChanged, fresh, stale, missing });
  log.info('render.end', { hash: version.hash, renderId: stored.renderId, artifacts: stored.artifacts, errors: out.errors, bytes: stored.bytes, drawMs, pictureMs, ms: Date.now() - started, drawn: stored.drawn, reused: stored.reused, drift: out.drift.counts, driftChanged: stored.driftChanged, fresh, stale, missing });
  return { hash: version.hash, artifacts: stored.artifacts, reused: false, errors: out.errors, drift: out.drift.counts, driftChanged: stored.driftChanged, sources: observed.sources };
}

/**
 * A save indexes what the YAML says; the pages are files, read here. The
 * head version's pages join the document's search text when it is drawn.
 */
async function indexPages(ctx: AppContext, doc: DocumentRow, version: VersionRow, files: Readonly<Record<string, Uint8Array>>): Promise<void> {
  const pages = pagesSearchText(files);
  if (!pages) return;
  const text = `${searchText(loadStored(version.yaml, version.imports).model, doc.name)}\n${pages}`;
  // The index is a convenience: a text Postgres will not index must never fail the draw.
  await ctx.db.query("update documents set search = to_tsvector('english', $2) where id = $1 and head_version_id = $3", [doc.id, text, version.id]).catch((err: unknown) => ctx.log.warn('search.pages.failed', { documentId: doc.id, versionId: version.id, error: (err as Error).message }));
}

interface Stored {
  readonly renderId: string;
  readonly artifacts: number;
  readonly bytes: number;
  readonly drawn: number;
  readonly reused: number;
  /** The views this render laid out, for telling a real change from a cache miss in the log. */
  readonly drawnViews: readonly string[];
  readonly driftChanged: boolean;
  /** Writing this render's files, and swapping its rows in. */
  readonly filesMs: number;
  readonly rowsMs: number;
}

/** Writes the bundle's shell and each drawn view's entry into the render's own folder, names the entries of reused views, and swaps its rows in. */
async function storeRender(ctx: AppContext, doc: DocumentRow, version: VersionRow, out: Exclude<DrawResult, { kind: 'skipped' }>, source: CacheSource | undefined, o: { jlog: JobLog; log: AppContext['log'] }): Promise<Stored> {
  const renderId = randomId();
  const written: Written[] = [];
  const scores: Record<string, number> = {};
  const views: Record<string, CachedView> = {};
  let drawn = 0;
  let reused = 0;
  const drawnViews: string[] = [];
  // Bundles and entries are stored gzipped (the `.gz` key says so): a fraction of the bytes to write, and sent as they are.
  const put = async (viewId: string, kind: RenderedKind, data: Uint8Array, digest?: string): Promise<void> => {
    const name = kind === 'bundle' ? 'bundle.json.gz' : `v/${safe(viewId)}.json.gz`;
    const key = `${version.hash}/${renderId}/${name}`;
    await ctx.blob.put(key, data, 'application/json');
    written.push({ viewId, kind, key, bytes: data.byteLength, contentType: 'application/json', ...(digest !== undefined ? { digest } : {}) });
  };
  const filesStarted = Date.now();
  if (out.kind === 'unparsable') {
    await put('', 'bundle', out.bundleGz);
    o.jlog.add('warn', 'document does not parse; bundle carries the diagnostics only', { errors: out.errors });
    o.log.warn('render.unparsable', { errors: out.errors });
  } else {
    await put('', 'bundle', Bun.gzipSync(shellBundle(out.shell, out.views)));
    // Each drawn view's entry is written side by side; a reused view's entry stays where it is, and this render's rows name it too (a file goes only when no row names it, gc.ts).
    await Promise.all(
      out.views.map(async (v) => {
        scores[v.id] = v.score;
        views[v.id] = cachedOf(v);
        if (v.entryGz !== undefined) {
          drawn++;
          drawnViews.push(v.id);
          await put(v.id, 'view', v.entryGz, v.digest);
          o.jlog.add('info', `rendered view ${v.id}`, { score: v.score, width: v.width, height: v.height });
          return;
        }
        const from = source?.files.get(v.id);
        if (!from) throw new Error(`the cached entry of view ${v.id} is missing`);
        reused++;
        written.push({ viewId: v.id, kind: 'view', key: from.key, bytes: from.bytes, contentType: from.contentType, digest: v.digest });
      }),
    );
  }

  const filesMs = Date.now() - filesStarted;
  let old: { blob_key: string }[] = [];
  let driftChanged = false;
  const rowsStarted = Date.now();
  await ctx.db.transaction(async (tx) => {
    // Two renders of one version (a save and an overlay) replace its rows one after the other.
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`vantage.artifacts.${version.hash}`]);
    old = await tx.query<{ blob_key: string }>('delete from artifacts where version_hash = $1 returning blob_key', [version.hash]);
    // Every row in one statement: a large render is one round trip, not one per file.
    await tx.query(
      `insert into artifacts (id, org_id, version_hash, view_id, kind, blob_key, bytes, content_type, render_id, digest)
         select id, $1, $2, view_id, kind, blob_key, bytes, content_type, $3, digest
         from unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::bigint[], $9::text[], $10::text[]) as t(id, view_id, kind, blob_key, bytes, content_type, digest)`,
      [version.org_id, version.hash, renderId, written.map(() => randomId()), written.map((w) => w.viewId), written.map((w) => w.kind), written.map((w) => w.key), written.map((w) => w.bytes), written.map((w) => w.contentType), written.map((w) => w.digest ?? null)],
    );
    await tx.query(
      `insert into render_states (version_hash, render_id, digest, views, renderer) values ($1, $2, $3, $4, $5)
         on conflict (version_hash) do update set render_id = excluded.render_id, digest = excluded.digest, views = excluded.views, renderer = excluded.renderer, updated_at = now()`,
      [version.hash, renderId, out.digest, out.kind === 'rendered' ? JSON.stringify(views) : null, RENDERER],
    );
    await tx.query('update versions set scores = $2 where hash = $1', [version.hash, JSON.stringify(scores)]);
    driftChanged = await storeDrift(ctx, doc, version, out.drift, tx);
  });
  // Old files go a while after the new rows are in: a reader that found the old rows a moment
  // ago, or on a replica a moment behind, still finds its files.
  const keep = new Set(written.map((w) => w.key));
  // Renders of 0.0.32 and 0.0.33 kept a `.gz` copy beside each raw bundle and variants file.
  const gone = old.flatMap((r) => (r.blob_key.endsWith('.json') ? [r.blob_key, `${r.blob_key}.gz`] : [r.blob_key])).filter((k) => !keep.has(k));
  if (gone.length) await enqueue(ctx.db, { orgId: version.org_id, kind: 'drop-files', payload: { keys: gone }, runAt: new Date(Date.now() + FILES_GRACE_MS) });
  if (old.length) o.log.info('render.replaced', { removed: old.length, blobsDeleted: gone.length });
  return { renderId, artifacts: written.length, bytes: written.reduce((a, w) => a + w.bytes, 0), drawn, reused, drawnViews, driftChanged, filesMs, rowsMs: Date.now() - rowsStarted };
}

function cachedOf(v: RangeView): CachedView {
  return { digest: v.digest, ...(v.anchors ? { anchors: v.anchors } : {}), score: v.score, width: v.width, height: v.height };
}

export async function notifyDocument(ctx: AppContext, documentId: string, versionId: string, hash: string): Promise<void> {
  await ctx.db.notify(channelName(DOC_CHANNEL_PREFIX, documentId), JSON.stringify({ versionId, hash }));
  ctx.log.debug('render.notified', { documentId, versionId });
}

function safe(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_');
}

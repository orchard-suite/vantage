/**
 * Serving the viewer bundle. The stored bundle goes out as it was written,
 * compressed once by the worker, so a large bundle is never parsed,
 * encoded, or compressed again per request. The fields that belong to
 * this reader and this moment (the head version, the render, the hub
 * panel settings, and that presence is on) ride in the X-Vantage-Reader header,
 * base64url JSON the viewer lays over the body. A reader whose copy is
 * current gets 304. A guest link limited to one view gets the bundle cut
 * to that view, its layout kit too, so it carries nothing else. Reads go to
 * the read replica when there is one; a reader a moment behind gets the
 * previous render, and the live stream brings the next. While the head
 * version is still drawing, a reader gets the newest version that is drawn,
 * marked `drawing`, so the page never waits on a blank stage.
 *
 * A bundle drawn by this release lists its views by id and digest, and the
 * viewer reads each view's entry from its own address. An entry is the same
 * for the same digest, so a reader's browser keeps it, and a save sends
 * only the views it changed.
 */
import { createHash } from 'node:crypto';
import type { Context } from 'hono';
import type { AppContext } from '../context.ts';
import type { HubEnv } from './env.ts';
import type { ResolvedDocument } from './resolve.ts';
import { mayDeleteDocument } from '../authz.ts';
import { artifact, headVersion, versionById, type ArtifactRow, type VersionRow } from '../documents/repo.ts';
import { isGzipKey, plainBytes, storedBundle, storedEntry, type StoredFile } from '../documents/derived.ts';
import { HttpError, notFound } from '../http.ts';
import { renderInput, renderState } from '../worker/artifacts.ts';
import { kitForView, type LayoutKit } from '@vantage/render';
import { enqueueDraw } from '../worker/jobs.ts';
import { RENDERER } from '../render/renderer.ts';
import { readerTheme } from '../theme.ts';
import { kindOfDocument } from '../tracking/kinds.ts';

function pending(resolved: ResolvedDocument, message: string, extra: Record<string, unknown>): Record<string, unknown> {
  return { title: resolved.document.name, theme: 'light', views: [], diagnostics: [{ severity: 'info', message }], live: true, presence: true, ...extra };
}

/** The bundle for one reader, as a response. */
export async function bundleResponse(ctx: AppContext, c: Context<HubEnv>, resolved: ResolvedDocument, opts: { csrf?: string | undefined } = {}): Promise<Response> {
  const head = await headVersion(ctx.dbRead, resolved.document);
  if (!head) return c.json({ ...pending(resolved, 'this document has no versions yet', {}) });
  const p = c.get('principal');
  const ws = resolved.workspace;
  // A document that defines a kind of item names it and its Work board, so an empty stage can point there.
  const kind = ws && p ? await kindOfDocument(ctx.dbRead, resolved.document.id) : undefined;
  const items = ws && kind ? { items: { name: kind.name, url: `/w/${encodeURIComponent(ws.slug)}?tab=work&kind=${encodeURIComponent(kind.prefix)}` } } : {};
  const hub = ws && p ? { hub: { documentId: resolved.document.id, version: head.id, canEdit: ws.role === 'author', canDelete: mayDeleteDocument(p, ws, resolved.document.created_by), workspaceUrl: `/w/${encodeURIComponent(ws.slug)}`, apiBase: '/api/v1', theme: readerTheme(p), ...items, ...(opts.csrf ? { csrf: opts.csrf } : {}) } } : {};
  const shown = await shownBundle(ctx, resolved.document.id, head);
  if (!shown) {
    ctx.log.info('bundle.pending', { documentId: resolved.document.id, versionId: head.id });
    return c.json(pending(resolved, 'rendering; this page refreshes when the picture is ready', { pending: true, ...hub }));
  }
  const { row, version } = shown;
  const drawing = version.id !== head.id;
  if (drawing) ctx.log.info('bundle.drawing', { documentId: resolved.document.id, versionId: head.id, shownVersionId: version.id });
  else await redrawIfOld(ctx, resolved.document, version);
  const extra = { live: true, presence: true, recordings: true, version: version.id, render: row.render_id, ...(drawing ? { drawing: true } : {}), ...hub };
  const extraJson = JSON.stringify(extra);
  const etag = `W/"${row.render_id ?? row.id}-${createHash('sha1').update(extraJson).update(resolved.onlyView ?? '').digest('hex').slice(0, 16)}"`;
  const headers = { 'content-type': 'application/json', 'cache-control': 'private, no-cache', etag };
  if (c.req.header('if-none-match') === etag) return c.body(null, 304, headers);
  const reader = { 'x-vantage-reader': Buffer.from(extraJson).toString('base64url'), vary: 'accept-encoding' };

  if (resolved.onlyView !== undefined) {
    const stored = await storedBundle(ctx, version);
    if (!stored) throw new HttpError(500, 'artifact blob missing', { key: row.blob_key });
    const body = await ctx.render.run('oneView', { bundle: stored.bundle, view: resolved.onlyView, extra });
    return c.body(body, 200, { ...headers, ...reader });
  }
  // The body is the stored bundle, compressed once by the worker.
  const file = await storedFile(ctx, row) ?? (await retryOnPrimary(ctx, version.hash, '', 'bundle'));
  if (!file) throw new HttpError(500, 'artifact blob missing', { key: row.blob_key });
  ctx.log.debug('bundle.served', { documentId: resolved.document.id, versionId: version.id, bytes: file.bytes.byteLength, gzip: file.gzip });
  return send(c, file, { ...headers, ...reader });
}

/**
 * One view's entry, by the digest the bundle listed it under: its address
 * names no version, so it stays the same across saves that leave the view
 * alone, and the reader's browser keeps it for good.
 */
export async function viewEntryResponse(ctx: AppContext, c: Context<HubEnv>, resolved: ResolvedDocument): Promise<Response> {
  const viewId = c.req.query('view');
  const digest = c.req.query('d');
  if (!viewId || !digest) throw new HttpError(400, 'view and d are required');
  if (resolved.onlyView !== undefined && resolved.onlyView !== viewId) throw notFound('view');
  const file = (await storedEntry(ctx.dbRead, ctx, resolved.document.id, viewId, digest)) ?? (await storedEntry(ctx.db, ctx, resolved.document.id, viewId, digest));
  if (!file) throw notFound('view');
  return send(c, file, { 'content-type': 'application/json', 'cache-control': 'private, max-age=31536000, immutable', vary: 'accept-encoding' });
}

/**
 * The layout kit of a version still drawing, so the viewer lays the view
 * on its stage out at once; the hub's own picture replaces it when drawn.
 */
export async function viewKitResponse(ctx: AppContext, c: Context<HubEnv>, resolved: ResolvedDocument): Promise<Response> {
  const versionId = c.req.query('version');
  if (!versionId) throw new HttpError(400, 'version is required');
  const version = await versionById(ctx.dbRead, versionId);
  if (!version || version.document_id !== resolved.document.id) throw notFound('version');
  const { input } = await renderInput(ctx, resolved.document, version);
  const text = await ctx.render.run('kit', input);
  if (text === undefined) throw notFound('kit');
  const body = resolved.onlyView !== undefined ? JSON.stringify(kitForView(JSON.parse(text) as LayoutKit, resolved.onlyView)) : text;
  return c.body(body, 200, { 'content-type': 'application/json', 'cache-control': 'private, max-age=60' });
}

/**
 * A head drawn by an older release lacks what this release's viewer needs
 * (its layout kit, say). Reading it queues a redraw, and every read does
 * until a current worker has drawn it: an old worker that takes the job
 * during a rollout draws the old way and leaves it old.
 */
async function redrawIfOld(ctx: AppContext, document: ResolvedDocument['document'], version: VersionRow): Promise<void> {
  const state = await renderState(ctx.dbRead, version.hash);
  if (!state || state.renderer === RENDERER) return;
  const job = await enqueueDraw(ctx.db, { orgId: document.org_id, kind: 'overlay', documentId: document.id, payload: { reason: 'drawn by an older release' } });
  ctx.log.info('bundle.redraw', { documentId: document.id, versionId: version.id, drawnBy: state.renderer, renderer: RENDERER, job });
}

/** The bundle a reader sees: the head version's, else the newest drawn version's while the head draws. */
async function shownBundle(ctx: AppContext, documentId: string, head: VersionRow): Promise<{ row: ArtifactRow; version: VersionRow } | undefined> {
  const row = await artifact(ctx.dbRead, head.hash, '', 'bundle');
  if (row) return { row, version: head };
  const last = await ctx.dbRead.query<VersionRow>(
    `select v.* from versions v
       where v.document_id = $1 and exists (select 1 from artifacts a where a.version_hash = v.hash and a.view_id = '' and a.kind = 'bundle')
       order by v.created_at desc limit 1`,
    [documentId],
  );
  const version = last[0];
  const drawn = version ? await artifact(ctx.dbRead, version.hash, '', 'bundle') : undefined;
  return version && drawn ? { row: drawn, version } : undefined;
}

/** A file as the client takes it: gzipped as stored when it accepts gzip, unpacked when it does not. */
function send(c: Context<HubEnv>, file: StoredFile, headers: Record<string, string>): Response {
  if (file.gzip && acceptsGzip(c)) return c.body(new Uint8Array(file.bytes), 200, { ...headers, 'content-encoding': 'gzip' });
  return c.body(new Uint8Array(plainBytes(file)), 200, headers);
}

async function storedFile(ctx: AppContext, row: ArtifactRow): Promise<StoredFile | undefined> {
  const bytes = await ctx.blob.get(row.blob_key);
  return bytes ? { bytes, contentType: row.content_type, renderId: row.render_id, gzip: isGzipKey(row.blob_key) } : undefined;
}

/** A replica a moment behind can name a render whose files are already gone; the primary names the current one. */
async function retryOnPrimary(ctx: AppContext, hash: string, viewId: string, kind: 'bundle'): Promise<StoredFile | undefined> {
  const row = await artifact(ctx.db, hash, viewId, kind);
  return row ? storedFile(ctx, row) : undefined;
}

function acceptsGzip(c: Context<HubEnv>): boolean {
  return /\bgzip\b/.test(c.req.header('accept-encoding') ?? '');
}

/** The head version's bundle as JSON text, or cut to one view; for copies that stand alone. */
export async function headBundle(ctx: AppContext, resolved: Pick<ResolvedDocument, 'document'>, opts: { onlyView?: string | undefined } = {}): Promise<{ versionId: string; json: string } | undefined> {
  const head = await headVersion(ctx.dbRead, resolved.document);
  if (!head) return undefined;
  const stored = await storedBundle(ctx, head);
  if (!stored) return undefined;
  const json = opts.onlyView !== undefined ? await ctx.render.run('oneView', { bundle: stored.bundle, view: opts.onlyView }) : stored.bundle;
  return { versionId: head.id, json };
}

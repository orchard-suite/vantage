/**
 * Reading a version's artifacts, and making the derived ones on first
 * request: a view's SVG laid out again as its render laid it out, its PNG
 * from that SVG, the standalone HTML from the bundle. Each is drawn on the render pool, stored in
 * the folder of the render it came from, and recorded only while that
 * render is still the current one, so a file made from an old picture
 * never outlives it. Two requests for the same file in one process share
 * one drawing.
 */
import { fontCss } from '@vantage/render';
import type { AppContext } from '../context.ts';
import { maybe, type Db } from '../db/db.ts';
import { randomId } from '../crypto.ts';
import { artifact, artifactsFor, type ArtifactKind, type ArtifactRow, type DerivedKind, type VersionRow } from './repo.ts';
import { bundleUrl, renderInput, renderViews } from '../worker/artifacts.ts';
import { documentById } from './repo.ts';
import type { AnchorList } from '../render/document-task.ts';

export interface StoredFile {
  /** As stored: gzipped when `gzip` is set. */
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly renderId: string | null;
  readonly gzip: boolean;
}

/** Bundles are stored gzipped, under a key ending in `.gz`. */
export const isGzipKey = (key: string): boolean => key.endsWith('.gz');

/** A stored file's bytes as they are meant to be read, unpacked when stored gzipped. */
export function plainBytes(file: StoredFile): Uint8Array {
  return file.gzip ? Bun.gunzipSync(new Uint8Array(file.bytes)) : file.bytes;
}

/** A stored file's bytes as text, unpacked when stored gzipped. */
export function fileText(file: StoredFile): string {
  return new TextDecoder().decode(plainBytes(file));
}

const inFlight = new Map<string, Promise<StoredFile | undefined>>();

async function read(ctx: AppContext, row: ArtifactRow): Promise<StoredFile | undefined> {
  const bytes = await ctx.blob.get(row.blob_key);
  if (!bytes) {
    ctx.log.warn('artifact.blob.missing', { key: row.blob_key, kind: row.kind });
    return undefined;
  }
  return { bytes, contentType: row.content_type, renderId: row.render_id, gzip: isGzipKey(row.blob_key) };
}

function folderOf(key: string): string {
  return key.slice(0, key.lastIndexOf('/'));
}

/** Stores a derived file in its source's render folder and records it if that render is still current. */
async function keep(ctx: AppContext, version: VersionRow, from: ArtifactRow, viewId: string, kind: ArtifactKind, name: string, bytes: Uint8Array, contentType: string): Promise<void> {
  // The source file may be one an earlier render stored and this render reuses, so the folder comes from the render, not the file.
  const key = from.render_id ? `${version.hash}/${from.render_id}/${name}` : `${folderOf(from.blob_key)}/${name}`;
  await ctx.blob.put(key, bytes, contentType);
  const rows = await ctx.db.query<{ id: string }>(
    `insert into artifacts (id, org_id, version_hash, view_id, kind, blob_key, bytes, content_type, render_id)
       select $1, $2, $3, $4, $5, $6, $7, $8, $9 where exists (select 1 from artifacts where id = $10)
       on conflict do nothing returning id`,
    [randomId(), version.org_id, version.hash, viewId, kind, key, bytes.byteLength, contentType, from.render_id, from.id],
  );
  if (!rows.length) {
    await ctx.blob.delete(key);
    ctx.log.info('artifact.derived.dropped', { hash: version.hash, viewId, kind, reason: 'a newer render replaced its source' });
  } else ctx.log.info('artifact.derived', { hash: version.hash, viewId, kind, bytes: bytes.byteLength });
}

async function derive(ctx: AppContext, version: VersionRow, viewId: string, kind: DerivedKind): Promise<StoredFile | undefined> {
  if (kind === 'svg') {
    const from = await artifact(ctx.db, version.hash, viewId, 'view');
    const views = await renderViews(ctx.db, version.hash);
    const doc = await documentById(ctx.db, version.document_id);
    if (!from || !views || !doc) return undefined;
    const anchors: Record<string, AnchorList> = {};
    for (const [id, v] of Object.entries(views)) if (v.anchors) anchors[id] = v.anchors;
    const { input } = await renderInput(ctx, doc, version);
    const svg = await ctx.render.run('viewSvg', { yaml: input.yaml, imports: input.imports, hash: input.hash, observed: input.observed, resources: input.resources, thresholdDays: input.thresholdDays, now: input.now, viewId, anchors });
    if (svg === undefined) return undefined;
    const bytes = new TextEncoder().encode(svg);
    await keep(ctx, version, from, viewId, 'svg', `${safe(viewId)}.svg`, bytes, 'image/svg+xml');
    return { bytes, contentType: 'image/svg+xml', renderId: from.render_id, gzip: false };
  }
  if (kind === 'png') {
    const svg = await storedArtifact(ctx, version, viewId, 'svg');
    // Renders from before entries were stored apart kept an SVG per view.
    const svgRow = (await artifact(ctx.db, version.hash, viewId, 'view')) ?? (await artifact(ctx.db, version.hash, viewId, 'svg'));
    if (!svgRow || !svg) return undefined;
    const png = await ctx.render.run('png', { svg: fileText(svg) });
    await keep(ctx, version, svgRow, viewId, 'png', `${safe(viewId)}.png`, png, 'image/png');
    return { bytes: png, contentType: 'image/png', renderId: svgRow.render_id, gzip: false };
  }
  const stored = await storedBundle(ctx, version);
  if (!stored) return undefined;
  const html = new TextEncoder().encode(await ctx.render.run('html', { bundle: stored.bundle, refresh: { url: bundleUrl(ctx, version.document_id), version: version.id } }));
  await keep(ctx, version, stored.row, '', 'html', 'index.html', html, 'text/html; charset=utf-8');
  return { bytes: html, contentType: 'text/html; charset=utf-8', renderId: stored.row.render_id, gzip: false };
}

/** A stored artifact, or a derived one made now. Undefined when the version has not rendered yet. */
export async function storedArtifact(ctx: AppContext, version: VersionRow, viewId: string, kind: ArtifactKind): Promise<StoredFile | undefined> {
  if (kind === 'bundle') {
    // Whole, with every view's entry: the stored shell only lists them.
    const stored = await storedBundle(ctx, version);
    return stored ? { bytes: new TextEncoder().encode(stored.bundle), contentType: 'application/json', renderId: stored.row.render_id, gzip: false } : undefined;
  }
  const row = await artifact(ctx.db, version.hash, viewId, kind);
  if (row) {
    const file = await read(ctx, row);
    if (file) return file;
  }
  if (kind !== 'svg' && kind !== 'png' && kind !== 'html') return undefined;
  const flight = `${version.hash}/${viewId}/${kind}`;
  let p = inFlight.get(flight);
  if (!p) {
    p = derive(ctx, version, viewId, kind).finally(() => inFlight.delete(flight));
    inFlight.set(flight, p);
  }
  return p;
}

/**
 * The bundle of one render as text, every view's entry in it: what a copy
 * that stands alone (the HTML, a guest link to one view, an export)
 * carries. A stored bundle lists its views, and their entries are read
 * beside it.
 */
export async function storedBundle(ctx: AppContext, version: VersionRow): Promise<{ row: ArtifactRow; bundle: string } | undefined> {
  const row = await artifact(ctx.db, version.hash, '', 'bundle');
  const file = row ? await read(ctx, row) : undefined;
  if (!row || !file) return undefined;
  const text = fileText(file);
  const shell = JSON.parse(text) as { lazy?: boolean; views: { id: string }[] } & Record<string, unknown>;
  if (!shell.lazy) return { row, bundle: text };
  const rows = new Map((await artifactsFor(ctx.db, version.hash)).filter((r) => r.kind === 'view').map((r) => [r.view_id, r]));
  const views = await Promise.all(
    shell.views.map(async (v) => {
      const r = rows.get(v.id);
      const entry = r ? await read(ctx, r) : undefined;
      if (!entry) throw new Error(`the entry of view ${v.id} is missing`);
      return JSON.parse(fileText(entry)) as unknown;
    }),
  );
  // The stored shell names the hub's font files; a copy that stands alone carries the faces.
  const { lazy: _lazy, ...rest } = shell;
  return { row, bundle: JSON.stringify({ ...rest, fontCss: fontCss(), views }) };
}

/** A view's stored entry with the given digest, from any render of the document, gzipped as stored. */
export async function storedEntry(db: Db, ctx: AppContext, documentId: string, viewId: string, digest: string): Promise<StoredFile | undefined> {
  const row = await maybe<ArtifactRow>(
    db,
    `select a.* from artifacts a
       where a.kind = 'view' and a.view_id = $2 and a.digest = $3
         and a.version_hash in (select hash from versions where document_id = $1)
       limit 1`,
    [documentId, viewId, digest],
  );
  return row ? read(ctx, row) : undefined;
}

function safe(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * The files a document reads: pictures, custom icon files, the Markdown
 * pages of its doc views, and the pictures those pages embed, carried
 * by each version as attachments (path, hash, type, size) with the bytes in
 * the blob store under `assets/<org>/<hash>`. Content addressed, so a save
 * that repeats a file stores nothing new.
 */
import { ARTIFACT_DIR, isDocumentPath, type Model } from '@vantage/model';
import { LayeredIconSource, MapAssetSource, documentFiles, fileTypeOf, modelResources, type Resources } from '@vantage/render';
import { defaultIcons } from '@vantage/server';
import type { AppContext } from '../context.ts';
import { sha256Bytes } from '../crypto.ts';
import { badRequest } from '../http.ts';
import { workspaceIconMap, workspaceIcons } from '../workspace-icons.ts';
import type { ResourceData } from '../render/resources.ts';

export interface Attachment {
  /** The path the document names, relative to it. */
  readonly path: string;
  readonly hash: string;
  readonly contentType: string;
  readonly size: number;
}

export const ASSET_LIMITS = { fileBytes: 2_000_000, versionBytes: 20_000_000 } as const;

/** A relative path inside the document's folder to a picture, a Markdown page, or any file under artifacts/, or the reason it is not. */
export function assetPathProblem(path: string): string | undefined {
  if (!isDocumentPath(path)) return `${path} is not a relative path of letters, digits, dots, dashes, and slashes`;
  if (!attachmentType(path)) return `${path} is not a picture or a page; use svg, png, jpg, gif, webp, or md, or keep it under ${ARTIFACT_DIR} as an artifact`;
  return undefined;
}

/** Whether a file is an artifact: kept and versioned, never drawn, so no render reads it. */
export const isArtifact = (path: string): boolean => path.startsWith(ARTIFACT_DIR);

const ARTIFACT_TYPES: Readonly<Record<string, string>> = { json: 'application/json', yaml: 'text/yaml; charset=utf-8', yml: 'text/yaml; charset=utf-8', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', zip: 'application/zip', pdf: 'application/pdf' };

/** The content type a file is stored with: a picture's or a page's, and for an artifact its own or plain bytes. */
export function attachmentType(path: string): string | undefined {
  const known = fileTypeOf(path);
  if (known || !isArtifact(path)) return known;
  return ARTIFACT_TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';
}

export const assetKey = (orgId: string, hash: string): string => `assets/${orgId}/${hash}`;

/** Checks and stores new files; returns their attachments. Throws 400 on a bad path or an oversized file. */
export async function storeAssets(ctx: AppContext, orgId: string, files: Readonly<Record<string, Uint8Array>>): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const [path, data] of Object.entries(files)) {
    const problem = assetPathProblem(path);
    if (problem) throw badRequest(problem);
    if (data.byteLength > ASSET_LIMITS.fileBytes) throw badRequest(`${path} is ${data.byteLength} bytes; the limit is ${ASSET_LIMITS.fileBytes}`);
    const hash = await sha256Bytes(data);
    const contentType = attachmentType(path)!;
    await ctx.blob.put(assetKey(orgId, hash), data, contentType);
    out.push({ path, hash, contentType, size: data.byteLength });
  }
  ctx.log.info('assets.stored', { orgId, files: out.length, bytes: out.reduce((s, a) => s + a.size, 0) });
  return out;
}

/** The head's attachments with the new ones laid over by path. */
export function overlayAttachments(head: readonly Attachment[], added: readonly Attachment[]): Attachment[] {
  const byPath = new Map(head.map((a) => [a.path, a]));
  for (const a of added) byPath.set(a.path, a);
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The attachments a version keeps: those the document still names, in its
 * YAML or in a page. `pages` holds the Markdown among them, so a picture
 * only a page embeds stays attached.
 */
export function keptAttachments(all: readonly Attachment[], model: Model | undefined, pages: Readonly<Record<string, Uint8Array>>): Attachment[] {
  const named = new Set(model ? documentFiles(model, new MapAssetSource(pages)) : all.map((a) => a.path));
  const kept = all.filter((a) => named.has(a.path));
  const total = kept.reduce((s, a) => s + a.size, 0);
  if (total > ASSET_LIMITS.versionBytes) throw badRequest(`the version's files total ${total} bytes; the limit is ${ASSET_LIMITS.versionBytes}`);
  return kept;
}

/** Decodes `{ path: base64 }` from a request body. */
export function decodeAssets(encoded: Readonly<Record<string, string>> | undefined): Record<string, Uint8Array> | undefined {
  if (!encoded) return undefined;
  const out: Record<string, Uint8Array> = {};
  for (const [path, b64] of Object.entries(encoded)) out[path] = new Uint8Array(Buffer.from(b64, 'base64'));
  return out;
}

/** The version's files, read from the blob store. A missing blob is left out; validation reports the file as missing. */
export async function readAttachments(ctx: Pick<AppContext, 'blob' | 'log'>, orgId: string, attachments: readonly Attachment[]): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  for (const a of attachments) {
    const data = await ctx.blob.get(assetKey(orgId, a.hash));
    if (data) out[a.path] = data;
    else ctx.log.warn('assets.missing', { orgId, path: a.path, hash: a.hash });
  }
  return out;
}

/**
 * The files a render reads: every one but the artifacts. An artifact's
 * check needs only to know it is attached, so it stands in as an empty file.
 */
function drawnFrom(attachments: readonly Attachment[]): Attachment[] {
  return attachments.filter((a) => !isArtifact(a.path));
}

async function filesToDraw(ctx: Pick<AppContext, 'blob' | 'log'>, orgId: string, attachments: readonly Attachment[]): Promise<Record<string, Uint8Array>> {
  const files = await readAttachments(ctx, orgId, drawnFrom(attachments));
  for (const a of attachments) if (isArtifact(a.path)) files[a.path] = new Uint8Array();
  return files;
}

/** Icons and pictures for a model in the hub: its own icons, the workspace pack, the shipped packs, and the version's files. */
export async function hubResources(ctx: AppContext, model: Model, scope: { orgId: string; workspaceId: string; attachments: readonly Attachment[] }): Promise<Required<Resources>> {
  const files = await filesToDraw(ctx, scope.orgId, scope.attachments);
  const pack = await workspaceIcons(ctx, scope.orgId, scope.workspaceId);
  return modelResources(model, new LayeredIconSource([pack, defaultIcons()]), new MapAssetSource(files));
}

/** What a render thread draws a version's icons and pictures from: its files and the workspace pack. */
export async function resourceInputs(ctx: AppContext, scope: { orgId: string; workspaceId: string; attachments: readonly Attachment[] }): Promise<ResourceData> {
  const files = await filesToDraw(ctx, scope.orgId, scope.attachments);
  const pack = await workspaceIconMap(ctx, scope.orgId, scope.workspaceId);
  // A page belongs to its own doc view, so it stays out of the key every picture shares: a page edit redraws no picture.
  const drawn = drawnFrom(scope.attachments).filter((a) => !/\.md$/i.test(a.path));
  return { files, icons: pack.icons, key: `${drawn.map((a) => `${a.path}=${a.hash}`).join(',')}|${pack.key}` };
}

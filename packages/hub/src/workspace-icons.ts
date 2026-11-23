/**
 * A workspace's own icon pack: logos and marks every document in the
 * workspace may name as `pack/name`. Rows in `workspace_icons`, bytes in
 * the blob store under `icons/<org>/<hash>`. A change re-renders the
 * workspace's documents so their pictures pick it up.
 */
import { dataUrl, MapIconSource, mimeOf, pictureIcon, type IconSource } from '@vantage/render';
import { defaultIcons } from '@vantage/server';
import type { AppContext } from './context.ts';
import type { Db } from './db/db.ts';
import type { Surface } from './audit.ts';
import { audit } from './audit.ts';
import { sha256Bytes } from './crypto.ts';
import { badRequest, notFound } from './http.ts';
import { listDocuments } from './documents/repo.ts';
import { enqueueDraw } from './worker/jobs.ts';
import { ASSET_LIMITS } from './documents/assets.ts';

export interface WorkspaceIconRow {
  readonly workspace_id: string;
  readonly org_id: string;
  readonly id: string;
  readonly hash: string;
  readonly content_type: string;
  readonly size: number;
  readonly created_at: Date;
}

export interface IconActor {
  readonly orgId: string;
  readonly who: string;
  readonly surface: Surface;
}

export const iconKey = (orgId: string, hash: string): string => `icons/${orgId}/${hash}`;

const ICON_ID = /^[a-z0-9-]+\/[a-z0-9-]+$/;

/** Content types a workspace icon may have: the pictures a browser and the PNG renderer both draw. */
export const ICON_TYPES = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export function iconIdProblem(id: string): string | undefined {
  if (!ICON_ID.test(id)) return `icon id ${id} is not pack/name in lowercase letters, digits, and dashes`;
  const pack = id.slice(0, id.indexOf('/'));
  if (defaultIcons().list(pack).length) return `pack ${pack} ships with Vantage; give the workspace pack its own name`;
  return undefined;
}

/** The content type for an upload: the one given when it is a picture, else the one a file name implies. */
export function iconType(contentType: string | undefined, filename?: string): string | undefined {
  const given = contentType?.split(';')[0]?.trim().toLowerCase();
  if (given && (ICON_TYPES as readonly string[]).includes(given)) return given;
  return filename ? mimeOf(filename) : undefined;
}

export async function listWorkspaceIcons(db: Db, workspaceId: string): Promise<WorkspaceIconRow[]> {
  return db.query<WorkspaceIconRow>('select * from workspace_icons where workspace_id = $1 order by id', [workspaceId]);
}

/** The workspace pack as plain data, icon id to drawn icon, and a key that changes when the pack does. */
export async function workspaceIconMap(ctx: AppContext, orgId: string, workspaceId: string): Promise<{ icons: Record<string, string>; key: string }> {
  const icons: Record<string, string> = {};
  const rows = await listWorkspaceIcons(ctx.db, workspaceId);
  for (const r of rows) {
    const data = await ctx.blob.get(iconKey(orgId, r.hash));
    if (data) icons[r.id] = pictureIcon(dataUrl(r.content_type, data));
    else ctx.log.warn('icons.missing', { workspaceId, id: r.id, hash: r.hash });
  }
  return { icons, key: rows.map((r) => `${r.id}=${r.hash}`).join(',') };
}

/** The workspace pack as an icon source. */
export async function workspaceIcons(ctx: AppContext, orgId: string, workspaceId: string): Promise<IconSource> {
  return new MapIconSource((await workspaceIconMap(ctx, orgId, workspaceId)).icons);
}

/** Re-renders every document in the workspace under its head version. */
async function rerender(ctx: AppContext, orgId: string, workspaceId: string, reason: string): Promise<number> {
  let n = 0;
  for (const d of await listDocuments(ctx.db, workspaceId)) {
    if (!d.head_version_id) continue;
    await enqueueDraw(ctx.db, { orgId, kind: 'overlay', documentId: d.id, payload: { reason } });
    n++;
  }
  return n;
}

export async function putWorkspaceIcon(ctx: AppContext, actor: IconActor, workspaceId: string, id: string, data: Uint8Array, contentType: string): Promise<WorkspaceIconRow> {
  const problem = iconIdProblem(id);
  if (problem) throw badRequest(problem);
  if (!(ICON_TYPES as readonly string[]).includes(contentType)) throw badRequest(`content type ${contentType} is not a picture; use ${ICON_TYPES.join(', ')}`);
  if (data.byteLength === 0) throw badRequest('the icon is empty');
  if (data.byteLength > ASSET_LIMITS.fileBytes) throw badRequest(`the icon is ${data.byteLength} bytes; the limit is ${ASSET_LIMITS.fileBytes}`);
  const hash = await sha256Bytes(data);
  await ctx.blob.put(iconKey(actor.orgId, hash), data, contentType);
  await ctx.db.transaction(async (tx) => {
    await tx.query(
      'insert into workspace_icons (workspace_id, org_id, id, hash, content_type, size) values ($1, $2, $3, $4, $5, $6) on conflict (workspace_id, id) do update set hash = excluded.hash, content_type = excluded.content_type, size = excluded.size, created_at = now()',
      [workspaceId, actor.orgId, id, hash, contentType, data.byteLength],
    );
    await audit(tx, ctx.log, { orgId: actor.orgId, who: actor.who, what: 'icon.put', surface: actor.surface, target: `workspace:${workspaceId}`, details: { id, hash, contentType, size: data.byteLength } });
  });
  const queued = await rerender(ctx, actor.orgId, workspaceId, `icon ${id}`);
  ctx.log.info('icon.put', { workspaceId, id, contentType, size: data.byteLength, rerender: queued });
  return (await ctx.db.query<WorkspaceIconRow>('select * from workspace_icons where workspace_id = $1 and id = $2', [workspaceId, id]))[0]!;
}

export async function deleteWorkspaceIcon(ctx: AppContext, actor: IconActor, workspaceId: string, id: string): Promise<void> {
  const gone = await ctx.db.transaction(async (tx) => {
    const rows = await tx.query<{ hash: string }>('delete from workspace_icons where workspace_id = $1 and id = $2 returning hash', [workspaceId, id]);
    if (rows.length) await audit(tx, ctx.log, { orgId: actor.orgId, who: actor.who, what: 'icon.delete', surface: actor.surface, target: `workspace:${workspaceId}`, details: { id } });
    return rows[0];
  });
  if (!gone) throw notFound(`icon ${id}`);
  const shared = await ctx.db.query('select 1 as x from workspace_icons where org_id = $1 and hash = $2 limit 1', [actor.orgId, gone.hash]);
  if (!shared.length) await ctx.blob.delete(iconKey(actor.orgId, gone.hash));
  const queued = await rerender(ctx, actor.orgId, workspaceId, `icon ${id} removed`);
  ctx.log.info('icon.deleted', { workspaceId, id, blobKept: shared.length > 0, rerender: queued });
}

export function iconJson(r: WorkspaceIconRow): Record<string, unknown> {
  return { id: r.id, contentType: r.content_type, size: r.size, updatedAt: r.created_at };
}

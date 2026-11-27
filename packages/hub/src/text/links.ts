/**
 * The hub page each kind of thing opens at. Every answer that names a
 * thing links it through here, so a document, a record, and an item link
 * the same way from find, outline, and a save.
 */
import type { AppContext } from '../context.ts';
import { maybe } from '../db/db.ts';

const at = (ctx: AppContext, ...parts: string[]): string => `${ctx.config.PUBLIC_URL}/w/${parts.map(encodeURIComponent).join('/')}`;

export const documentLink = (ctx: AppContext, workspace: string, document: string): string => at(ctx, workspace, document);

export const recordLink = (ctx: AppContext, workspace: string, ref: string): string => at(ctx, workspace, 'decisions', ref);

export const itemLink = (ctx: AppContext, workspace: string, key: string): string => at(ctx, workspace, 'work', key);

/** The slug of a workspace by its id, for a thing that knows only the id. */
export async function workspaceSlug(ctx: AppContext, id: string): Promise<string> {
  return (await maybe<{ slug: string }>(ctx.db, 'select slug from workspaces where id = $1', [id]))?.slug ?? '';
}

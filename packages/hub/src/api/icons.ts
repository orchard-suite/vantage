/** A workspace's own icon pack: list, read, upload, delete. */
import { Hono } from 'hono';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { principal, who } from './common.ts';
import { requireWorkspace } from '../authz.ts';
import { badRequest, notFound } from '../http.ts';
import { deleteWorkspaceIcon, iconJson, iconKey, iconType, listWorkspaceIcons, putWorkspaceIcon, ICON_TYPES } from '../workspace-icons.ts';

export function iconRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  const base = '/workspaces/:workspace/icons';

  reg.add({ method: 'get', path: base, summary: "The workspace's own icons; documents name them as pack/name", tag: 'icons', params: ['workspace'], auth: 'viewer' });
  app.get(base, async (c) => {
    const ws = await requireWorkspace(ctx.db, principal(c), c.req.param('workspace'), 'viewer');
    return c.json({ icons: (await listWorkspaceIcons(ctx.db, ws.id)).map(iconJson) });
  });

  reg.add({ method: 'get', path: `${base}/:pack/:name`, summary: 'The picture of one workspace icon', tag: 'icons', params: ['workspace', 'pack', 'name'], auth: 'viewer' });
  app.get(`${base}/:pack/:name`, async (c) => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'viewer');
    const id = `${c.req.param('pack')}/${c.req.param('name')}`;
    const row = (await listWorkspaceIcons(ctx.db, ws.id)).find((r) => r.id === id);
    const data = row ? await ctx.blob.get(iconKey(p.orgId, row.hash)) : undefined;
    if (!row || !data) throw notFound(`icon ${id}`);
    // A picture served on its own could carry script when it is SVG; the sandbox keeps it inert.
    return c.body(new Uint8Array(data), 200, { 'content-type': row.content_type, 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'cache-control': 'private, max-age=60' });
  });

  reg.add({ method: 'put', path: `${base}/:pack/:name`, summary: `Upload or replace a workspace icon; the body is the picture (${ICON_TYPES.join(', ')}) and the documents re-render`, tag: 'icons', params: ['workspace', 'pack', 'name'], auth: 'author', responses: { '200': 'stored', '400': 'bad id, type, or size' } });
  app.put(`${base}/:pack/:name`, async (c) => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'author');
    const name = c.req.param('name');
    const type = iconType(c.req.header('content-type'), name);
    if (!type) throw badRequest(`send the picture with a content type of ${ICON_TYPES.join(', ')}`);
    const data = new Uint8Array(await c.req.arrayBuffer());
    const row = await putWorkspaceIcon(ctx, { orgId: p.orgId, who: who(p), surface: p.surface }, ws.id, `${c.req.param('pack')}/${name}`, data, type);
    return c.json(iconJson(row));
  });

  reg.add({ method: 'delete', path: `${base}/:pack/:name`, summary: 'Delete a workspace icon; the documents re-render without it', tag: 'icons', params: ['workspace', 'pack', 'name'], auth: 'author', responses: { '204': 'deleted' } });
  app.delete(`${base}/:pack/:name`, async (c) => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'author');
    await deleteWorkspaceIcon(ctx, { orgId: p.orgId, who: who(p), surface: p.surface }, ws.id, `${c.req.param('pack')}/${c.req.param('name')}`);
    return c.body(null, 204);
  });

  return app;
}

/**
 * The scope tree over HTTP (VAN-3017): read it, replace it, or set one
 * workspace's scope. Each route goes through the same write the text form
 * does, so a tree read from the catalog refuses an edit here too.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { stringify } from 'yaml';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, principal } from './common.ts';
import { scopesState, type ScopesState } from '../scopes/text.ts';
import { setScopeOf, writeScopes } from '../scopes/write.ts';

const json = (s: ScopesState) => ({ source: s.setting.source, ...(s.setting.source === 'catalog' ? { catalog: s.setting.catalog } : {}), scopes: s.scopes, workspaces: Object.fromEntries(s.workspaces) });

/** The tree as JSON is the text form's fields; the write reads the same fields. */
const TreeBody = z.object({ source: z.enum(['hub', 'catalog']), catalog: z.record(z.string(), z.unknown()).optional(), scopes: z.array(z.record(z.string(), z.unknown())).max(5_000).optional(), workspaces: z.record(z.string(), z.string()).optional() });

const ScopeBody = z.object({ scope: z.string().min(1).nullable() });

export function scopeRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  reg.add({ method: 'get', path: '/scopes', summary: 'The scope tree: where it comes from, each scope with its parent, kind, steward, and facets, and the workspaces that name one; a workspace not listed belongs to the whole estate', tag: 'scopes', auth: 'user', responses: { '200': '{ source, catalog?, scopes: [{ id, name, kind, parent?, steward?, facets, url? }], workspaces: { slug: scope } }' } });
  app.get('/scopes', async (c) => c.json(json(await scopesState(ctx, principal(c)))));

  reg.add({ method: 'put', path: '/scopes', summary: "Replace the scope tree, its source, and the workspaces that name a scope. The tree and its source are an admin's; a workspace's scope is its owner's. A tree read from the catalog refuses edits", tag: 'scopes', auth: 'user', body: { source: 'hub or catalog', catalog: '{ connector: workspace/connector, kinds, steward, facets } for catalog', scopes: '[{ id, name, kind, parent?, steward?, facets? }]', workspaces: '{ slug: scope }' }, responses: { '200': '{ status, version, message }' } });
  app.put('/scopes', async (c) => {
    const p = principal(c);
    const input = await body(c, TreeBody);
    return c.json(await writeScopes(ctx, p, stringify(input), p.surface));
  });

  reg.add({ method: 'put', path: '/workspaces/:workspace/scope', summary: 'Set the owner scope of one workspace, or null for the whole estate; the workspace owner or an admin', tag: 'scopes', params: ['workspace'], auth: 'author', body: { scope: 'a scope id, or null' }, responses: { '200': '{ status, version, message }' } });
  app.put('/workspaces/:workspace/scope', async (c) => {
    const p = principal(c);
    const input = await body(c, ScopeBody);
    return c.json(await setScopeOf(ctx, p, c.req.param('workspace'), input.scope, p.surface));
  });
  return app;
}

/** Export a workspace (or one document) as a zip; import a zip or one YAML. */
import { Hono } from 'hono';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { principal, who } from './common.ts';
import { requireWorkspace } from '../authz.ts';
import { exportWorkspace, importWorkspace } from '../transfer.ts';
import { audit } from '../audit.ts';
import { badRequest } from '../http.ts';

export function transferRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  reg.add({ method: 'get', path: '/workspaces/:workspace/export', summary: 'Zip of every document: yaml, imports, pins, and artifacts; ?document= limits to one', tag: 'transfer', params: ['workspace'], query: ['document'], auth: 'viewer' });
  app.get('/workspaces/:workspace/export', async (c) => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'viewer');
    const out = await exportWorkspace(ctx, ws.id, { documentSlug: c.req.query('document') });
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'workspace.export', surface: p.surface, target: `workspace:${ws.id}`, details: { documents: out.documents, files: out.files } });
    return c.body(out.zip.buffer.slice(out.zip.byteOffset, out.zip.byteOffset + out.zip.byteLength) as ArrayBuffer, 200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${ws.slug}.zip"` });
  });

  reg.add({ method: 'post', path: '/workspaces/:workspace/import', summary: 'Import a zip (application/zip body) or one YAML (application/yaml body, ?name=); existing slugs get a new version. A file whose document has errors saves nothing: its result is refused, with each error by code, message, path, and line, and the other files still import', tag: 'transfer', params: ['workspace'], query: ['name'], auth: 'author', responses: { '200': 'one result per file', '422': 'every file was refused; the results name their errors' } });
  app.post('/workspaces/:workspace/import', async (c) => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'author');
    const type = c.req.header('content-type') ?? '';
    const actor = { orgId: p.orgId, userId: p.userId, writer: p, who: who(p), surface: p.surface };
    let out;
    if (type.includes('zip')) out = await importWorkspace(ctx, actor, ws.id, { zip: new Uint8Array(await c.req.arrayBuffer()) });
    else if (type.includes('yaml') || type.includes('text/plain')) out = await importWorkspace(ctx, actor, ws.id, { yaml: await c.req.text(), ...(c.req.query('name') ? { name: c.req.query('name')! } : {}) });
    else throw badRequest('send application/zip or application/yaml');
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'workspace.import', surface: p.surface, target: `workspace:${ws.id}`, details: { documents: out.results.length } });
    const refusedAll = out.results.length > 0 && out.results.every((r) => r.status === 'refused');
    return c.json(out, refusedAll ? 422 : 200);
  });

  return app;
}

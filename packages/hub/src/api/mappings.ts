/**
 * Mappings per connector: YAML from the connector's types and facts to
 * profile types and display labels, validated against the mapping schema
 * before it is stored. Authors of the connector's workspace manage them.
 * The first mapping by name that parses is the one a run applies.
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { mappingJsonSchema } from '@vantage/connectors';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, Name, principal, who } from './common.ts';
import { requireWorkspace } from '../authz.ts';
import type { Principal, Role } from '../auth/principal.ts';
import { audit } from '../audit.ts';
import { randomId } from '../crypto.ts';
import { badRequest, notFound } from '../http.ts';
import { maybe } from '../db/db.ts';
import { connectorIn, listMappings, parseMapping, type MappingRow, type SourceRow } from '../sources/repo.ts';

const MappingBody = z.object({ name: Name, yaml: z.string().min(1).max(1_000_000) }).strict();

function mappingJson(m: MappingRow, sourceSlug: string): Record<string, unknown> {
  const { mapping, problems } = parseMapping(m.yaml, sourceSlug);
  return { id: m.id, sourceId: m.source_id, name: m.name, yaml: m.yaml, valid: Boolean(mapping), problems, profile: mapping?.profile ?? null, types: mapping ? Object.keys(mapping.types).length : 0, createdAt: m.created_at, updatedAt: m.updated_at };
}

export function mappingRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  const base = '/workspaces/:workspace/connectors/:connector/mappings';
  const scoped = async (c: Context<HubEnv>, role: Role): Promise<{ p: Principal; s: SourceRow }> => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace') ?? '', role);
    const s = await connectorIn(ctx.db, ws.id, c.req.param('connector') ?? '');
    if (!s) throw notFound('connector');
    return { p, s };
  };

  reg.add({ method: 'get', path: '/mappings/schema', summary: 'JSON Schema of a mapping', tag: 'mappings', auth: 'user' });
  app.get('/mappings/schema', (c) => {
    principal(c);
    return c.json(mappingJsonSchema());
  });

  reg.add({ method: 'get', path: base, summary: 'Mappings of a connector, each with its validation', tag: 'mappings', params: ['workspace', 'connector'], auth: 'viewer' });
  app.get(base, async (c) => {
    const { s } = await scoped(c, 'viewer');
    return c.json({ mappings: (await listMappings(ctx.db, s.id)).map((m) => mappingJson(m, s.slug)) });
  });

  reg.add({ method: 'post', path: base, summary: 'Create a mapping; the YAML must validate and name this connector', tag: 'mappings', params: ['workspace', 'connector'], body: { name: 'label', yaml: 'mapping text' }, auth: 'author', responses: { '201': 'created', '400': 'invalid mapping with problems' } });
  app.post(base, async (c) => {
    const { p, s } = await scoped(c, 'author');
    const input = await body(c, MappingBody);
    const { mapping, problems } = parseMapping(input.yaml, s.slug);
    if (!mapping) throw badRequest('invalid mapping', { problems });
    const id = randomId();
    await ctx.db.query('insert into mappings (id, org_id, source_id, name, yaml) values ($1, $2, $3, $4, $5)', [id, p.orgId, s.id, input.name, input.yaml]);
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'mapping.create', surface: p.surface, target: `connector:${s.id}`, details: { mappingId: id, profile: mapping.profile, types: Object.keys(mapping.types).length } });
    return c.json(mappingJson((await maybe<MappingRow>(ctx.db, 'select * from mappings where id = $1', [id]))!, s.slug), 201);
  });

  reg.add({ method: 'put', path: `${base}/:mapping`, summary: 'Replace a mapping after validating it', tag: 'mappings', params: ['workspace', 'connector', 'mapping'], body: { name: 'label', yaml: 'mapping text' }, auth: 'author', responses: { '200': 'updated', '400': 'invalid mapping with problems' } });
  app.put(`${base}/:mapping`, async (c) => {
    const { p, s } = await scoped(c, 'author');
    const input = await body(c, MappingBody);
    const { mapping, problems } = parseMapping(input.yaml, s.slug);
    if (!mapping) throw badRequest('invalid mapping', { problems });
    const rows = await ctx.db.query('update mappings set name = $3, yaml = $4, updated_at = now() where id = $1 and source_id = $2 returning id', [c.req.param('mapping'), s.id, input.name, input.yaml]);
    if (!rows.length) throw notFound('mapping');
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'mapping.update', surface: p.surface, target: `connector:${s.id}`, details: { mappingId: c.req.param('mapping'), profile: mapping.profile } });
    return c.json(mappingJson((await maybe<MappingRow>(ctx.db, 'select * from mappings where id = $1', [c.req.param('mapping')]))!, s.slug));
  });

  reg.add({ method: 'delete', path: `${base}/:mapping`, summary: 'Delete a mapping', tag: 'mappings', params: ['workspace', 'connector', 'mapping'], auth: 'author', responses: { '204': 'deleted' } });
  app.delete(`${base}/:mapping`, async (c) => {
    const { p, s } = await scoped(c, 'author');
    const rows = await ctx.db.query('delete from mappings where id = $1 and source_id = $2 returning id', [c.req.param('mapping'), s.id]);
    if (!rows.length) throw notFound('mapping');
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'mapping.delete', surface: p.surface, target: `connector:${s.id}`, details: { mappingId: c.req.param('mapping') } });
    return c.body(null, 204);
  });

  return app;
}

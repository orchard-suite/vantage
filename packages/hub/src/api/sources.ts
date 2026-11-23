/**
 * Connectors: one per row, owned by one workspace. Authors of the workspace
 * add, change, and remove them; its readers see them; nobody else does. A
 * connector runs outside the hub and signs in with its own OAuth client,
 * whose id the row holds, so the hub stores no credential for it. The
 * client reads its settings and pushes batches through the connector
 * routes in push.ts. With CONNECTOR_APPROVAL a connector pushes only once
 * an admin approves it, and a change of kind, client, or settings takes the
 * approval back. A connector with an interval runs in the shared runner
 * pool on the hub's schedule, and an author may run it now (`runs.ts`). A
 * workspace holds at most CONNECTOR_MAX_PER_WORKSPACE connectors. The
 * connector and target catalogues live here too.
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, principal, who } from './common.ts';
import { requireWorkspace, type AccessibleWorkspace } from '../authz.ts';
import type { Principal, Role } from '../auth/principal.ts';
import { audit } from '../audit.ts';
import { keptKey } from './push.ts';
import { conflict, notFound } from '../http.ts';
import { connectorBlocked, connectorIn, listRuns, observedModel, workspaceConnectors, type SourceRow } from '../sources/repo.ts';
import { nextRunAt, queueConnectorRun, runRefusal } from '../sources/runs.ts';
import { ConnectorInput, createConnector, PUSH_CONNECTOR, updateConnector } from '../sources/save.ts';

export function sourceJson(s: SourceRow, approvalRequired: boolean): Record<string, unknown> {
  return {
    id: s.id,
    workspaceId: s.workspace_id,
    name: s.name,
    slug: s.slug,
    connector: s.connector,
    config: s.config,
    clientId: s.client_id,
    every: s.every_minutes,
    nextRunAt: nextRunAt(s, new Date()),
    enabled: s.enabled,
    approval: s.approval,
    approvalAt: s.approval_at,
    blocked: connectorBlocked(s, approvalRequired) ?? null,
    createdBy: s.created_by,
    lastRun: s.last_run,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}

export function sourceRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  const base = '/workspaces/:workspace/connectors';
  const required = ctx.config.CONNECTOR_APPROVAL;

  const scoped = async (c: Context<HubEnv>, role: Role): Promise<{ p: Principal; ws: AccessibleWorkspace; s: SourceRow }> => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace') ?? '', role);
    const s = await connectorIn(ctx.db, ws.id, c.req.param('connector') ?? '');
    if (!s) throw notFound('connector');
    return { p, ws, s };
  };

  reg.add({ method: 'get', path: '/connectors', summary: 'Connector kinds a connector may name, with the JSON Schema of their settings', tag: 'connectors', auth: 'user' });
  app.get('/connectors', (c) => {
    principal(c);
    const kinds = ctx.connectors.list().map((k) => ({ id: k.id, configSchema: z.toJSONSchema(k.configSchema, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' }) }));
    return c.json({
      signIn: ctx.connectorTokens ? { audience: ctx.connectorTokens.audience, role: ctx.connectorTokens.role } : null,
      connectors: [{ id: PUSH_CONNECTOR, configSchema: { type: 'object' }, note: 'takes no settings; whatever its client pushes is the batch' }, ...kinds],
    });
  });

  reg.add({ method: 'get', path: '/targets', summary: 'Publish targets a publication may name', tag: 'publications', auth: 'user' });
  app.get('/targets', (c) => c.json({ targets: ctx.targets.list() }));

  reg.add({ method: 'get', path: base, summary: 'Connectors of a workspace with their last run', tag: 'connectors', params: ['workspace'], auth: 'viewer' });
  app.get(base, async (c) => {
    const ws = await requireWorkspace(ctx.db, principal(c), c.req.param('workspace'), 'viewer');
    return c.json({ approvalRequired: required, connectors: (await workspaceConnectors(ctx.db, ws.id)).map((s) => sourceJson(s, required)) });
  });

  reg.add({ method: 'post', path: base, summary: 'Add a connector to a workspace; it pushes once an admin approves it when CONNECTOR_APPROVAL is on', tag: 'connectors', params: ['workspace'], body: { name: 'label', slug: 'prefix of every observed key, unique in the workspace; defaults from the name', connector: 'connector kind, or push', config: 'settings the runner reads; no secrets', clientId: 'the OAuth client id the connector signs in as', enabled: 'default true' }, auth: 'author', responses: { '201': 'created', '400': 'invalid kind, settings, or slug taken' } });
  app.post(base, async (c) => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'author');
    const input = await body(c, ConnectorInput);
    return c.json(sourceJson(await createConnector(ctx, p, p.surface, ws.id, input), required), 201);
  });

  reg.add({ method: 'get', path: `${base}/:connector`, summary: 'One connector (by id or slug) with its last run', tag: 'connectors', params: ['workspace', 'connector'], auth: 'viewer' });
  app.get(`${base}/:connector`, async (c) => {
    const { s } = await scoped(c, 'viewer');
    return c.json(sourceJson(s, required));
  });

  reg.add({ method: 'put', path: `${base}/:connector`, summary: 'Replace a connector; the slug stays. A change of kind, client, or settings takes back an approval', tag: 'connectors', params: ['workspace', 'connector'], body: { name: 'label', connector: 'connector kind', config: 'object', clientId: 'OAuth client id', every: 'minutes between runs in the shared pool, or null for a runner of its own', enabled: 'boolean' }, auth: 'author' });
  app.put(`${base}/:connector`, async (c) => {
    const { p, s } = await scoped(c, 'author');
    const input = await body(c, ConnectorInput);
    return c.json(sourceJson(await updateConnector(ctx, p, p.surface, s, input), required));
  });

  reg.add({ method: 'delete', path: `${base}/:connector`, summary: 'Remove a connector with its observed model, runs, and mappings', tag: 'connectors', params: ['workspace', 'connector'], auth: 'author', responses: { '204': 'deleted' } });
  app.delete(`${base}/:connector`, async (c) => {
    const { p, s } = await scoped(c, 'author');
    await ctx.db.query('delete from sources where id = $1', [s.id]);
    await ctx.blob.delete(keptKey(s.org_id, s.id));
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'connector.delete', surface: p.surface, target: `connector:${s.id}`, details: { workspaceId: s.workspace_id, slug: s.slug } });
    return c.body(null, 204);
  });

  reg.add({ method: 'post', path: `${base}/:connector/run`, summary: 'Run a connector in the shared pool now; a run that already waits stands for this one', tag: 'connectors', params: ['workspace', 'connector'], auth: 'author', responses: { '202': 'queued with jobId', '200': 'a run already waited; its jobId', '409': 'runs on a runner of its own, waits for an admin, or is paused' } });
  app.post(`${base}/:connector/run`, async (c) => {
    const { p, s } = await scoped(c, 'author');
    const refused = runRefusal(s, ctx);
    if (refused) throw conflict(refused);
    const queued = await queueConnectorRun(ctx, s, { trigger: 'manual', who: who(p) });
    if (!queued) throw conflict('the run could not be queued; try again');
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'connector.run.queue', surface: p.surface, target: `connector:${s.id}`, details: { jobId: queued.jobId, queued: queued.queued } });
    return c.json({ jobId: queued.jobId, connectorId: s.id, alreadyWaiting: !queued.queued }, queued.queued ? 202 : 200);
  });

  reg.add({ method: 'get', path: `${base}/:connector/runs`, summary: 'Run history, newest first', tag: 'connectors', params: ['workspace', 'connector'], query: ['limit'], auth: 'viewer' });
  app.get(`${base}/:connector/runs`, async (c) => {
    const { s } = await scoped(c, 'viewer');
    const runs = await listRuns(ctx.db, s.id, Number(c.req.query('limit') ?? 50));
    return c.json({ runs: runs.map((r) => ({ id: r.id, jobId: r.job_id, trigger: r.trigger, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, counts: r.counts, warnings: r.warnings, error: r.error })) });
  });

  reg.add({ method: 'get', path: `${base}/:connector/observed`, summary: 'What a connector observed: counts, and the entities with ?entities=true', tag: 'connectors', params: ['workspace', 'connector'], query: ['entities'], auth: 'viewer' });
  app.get(`${base}/:connector/observed`, async (c) => {
    const { s } = await scoped(c, 'viewer');
    const { model, version } = await observedModel(ctx.db, s.id);
    const entities = Object.values(model.entities);
    const summary = { version, entities: entities.length, missing: entities.filter((e) => e.missingSince !== undefined).length, relations: Object.keys(model.relations).length, types: [...new Set(entities.map((e) => e.type))].sort() };
    return c.json(c.req.query('entities') === 'true' ? { ...summary, model } : summary);
  });

  return app;
}

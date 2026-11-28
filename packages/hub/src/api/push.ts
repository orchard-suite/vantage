/**
 * What a connector's own client may do: list the connectors it is
 * registered for, read one's settings, and push a batch (the push shape) or
 * a Backstage catalog document to it. The client signs in with an app-only
 * access token from the issuer; the hub matches its client id to the
 * connector's. A render thread checks the batch (and converts a Backstage
 * document); the web stores it and queues an ingest job, and the worker
 * merges it, records the run, and queues the overlays of the connector's
 * workspace. Rate limited per client and per address. A connector may also
 * keep bytes of its own between runs (its sources' tags and the answers they
 * named); the hub stores them as given, one blob per connector, and never
 * reads them.
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body } from './common.ts';
import { badRequest, forbidden, notFound, unauthorized, HttpError } from '../http.ts';
import { clientAddress, createRateLimiter } from '../ratelimit.ts';
import { connectorBlocked, connectorsForClient, sourceById, type SourceRow } from '../sources/repo.ts';
import { recordFailedRun } from '../sources/ingest.ts';
import { enqueue, jobById } from '../worker/jobs.ts';
import { pushKey } from '../worker/ingest-run.ts';
import { randomId } from '../crypto.ts';
import { servedConfig } from '../scopes/catalog.ts';

export const PUSH_LIMIT = { requests: 60, windowMs: 60_000 };
export const PUSH_MAX_BYTES = 20_000_000;
export const KEPT_MAX_BYTES = 20_000_000;

/** Where a connector's kept bytes live: one blob per connector, replaced on each store. */
export const keptKey = (orgId: string, sourceId: string): string => `kept/${orgId}/${sourceId}.bin`;

/** What a connector's client sees of its connector: enough to run it, nothing about its workspace's people or diagrams. */
async function settingsJson(ctx: AppContext, s: SourceRow, blocked: string | undefined): Promise<Record<string, unknown>> {
  return { id: s.id, name: s.name, slug: s.slug, connector: s.connector, config: await servedConfig(ctx, s), enabled: s.enabled, approval: s.approval, blocked: blocked ?? null };
}

export function pushRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  const limiter = createRateLimiter(PUSH_LIMIT.requests, PUSH_LIMIT.windowMs);
  const required = ctx.config.CONNECTOR_APPROVAL;

  /** The connector at :connector, which the calling client is registered for. */
  const mine = async (c: Context<HubEnv>): Promise<{ clientId: string; source: SourceRow }> => {
    const p = c.get('principal');
    if (!p) throw unauthorized();
    if (!p.connector || p.connector.pool) throw forbidden("a connector's own client token is required");
    const source = await sourceById(ctx.db, c.req.param('connector') ?? '');
    if (!source || source.client_id.toLowerCase() !== p.connector.clientId.toLowerCase()) {
      ctx.log.warn('connector.forbidden', { ref: c.req.param('connector'), clientId: p.connector.clientId });
      throw notFound('connector');
    }
    return { clientId: p.connector.clientId, source };
  };

  reg.add({ method: 'get', path: '/connector/me', summary: "The connectors the calling client is registered for, each with its settings and whether it may push", tag: 'push', auth: 'source' });
  app.get('/connector/me', async (c) => {
    const p = c.get('principal');
    if (!p) throw unauthorized();
    if (!p.connector || p.connector.pool) throw forbidden("a connector's own client token is required");
    const rows = await connectorsForClient(ctx.db, p.connector.clientId);
    return c.json({ clientId: p.connector.clientId, connectors: await Promise.all(rows.map((s) => settingsJson(ctx, s, connectorBlocked(s, required)))) });
  });

  reg.add({ method: 'get', path: '/connector/:connector', summary: "One connector's settings, for its own client", tag: 'push', params: ['connector'], auth: 'source' });
  app.get('/connector/:connector', async (c) => {
    const { source } = await mine(c);
    return c.json(await settingsJson(ctx, source, connectorBlocked(source, required)));
  });

  reg.add({ method: 'post', path: '/connector/:connector/batches', summary: 'Push a batch (the push shape, source and observed optional) or a Backstage catalog document; checked, then merged, stored, audited, and bound documents re-rendered by the worker', tag: 'push', params: ['connector'], body: { entities: 'array', relations: 'array', partial: 'true when this is one slice', observed: 'ISO time, default now' }, auth: 'source', responses: { '202': 'checked and queued; the worker merges it, and the connector runs list its counts', '400': 'invalid body', '403': 'not approved, stopped, or paused', '404': 'no such connector for this client', '413': 'body too large', '429': 'rate limited' } });
  app.post('/connector/:connector/batches', async (c) => {
    const { clientId, source } = await mine(c);
    const blocked = connectorBlocked(source, required);
    if (blocked) {
      ctx.log.info('push.blocked', { connectorId: source.id, reason: blocked });
      throw forbidden(blocked);
    }
    const address = clientAddress(c.req.raw);
    if (!limiter.allow(`client:${clientId}:${source.id}`) || !limiter.allow(`addr:${address}`)) {
      ctx.log.warn('push.ratelimited', { connectorId: source.id, clientId, address });
      throw new HttpError(429, 'push rate limit exceeded');
    }
    const length = Number(c.req.header('content-length') ?? '0');
    if (length > PUSH_MAX_BYTES) throw new HttpError(413, `body exceeds ${PUSH_MAX_BYTES} bytes`);
    const startedAt = new Date();
    const by = `connector-client:${clientId}`;
    const checked = await ctx.render.run('push', { text: await c.req.text(), slug: source.slug, receivedAt: startedAt.toISOString(), who: by });
    if (!checked.ok) throw badRequest(checked.error, checked.issues.length ? { issues: checked.issues } : undefined);
    const { shape, warnings } = checked;
    // The merge runs in the worker; the web only stores the checked batch until then.
    const key = pushKey(source.org_id, source.id, randomId());
    await ctx.blob.put(key, new TextEncoder().encode(checked.stored), 'application/json');
    const jobId = await enqueue(ctx.db, { orgId: source.org_id, kind: 'ingest', payload: { sourceId: source.id, key } });
    ctx.log.info('push.accepted', { connectorId: source.id, shape, entities: checked.entities, relations: checked.relations, partial: checked.partial, bytes: length, jobId });
    return c.json({ queued: true, job: jobId, shape, warnings }, 202);
  });

  reg.add({ method: 'get', path: '/connector/:connector/kept', summary: 'What the connector kept from its last run, as the bytes it stored', tag: 'push', params: ['connector'], auth: 'source', responses: { '200': 'the kept bytes', '204': 'nothing kept', '404': 'no such connector for this client' } });
  app.get('/connector/:connector/kept', async (c) => {
    const { source } = await mine(c);
    const bytes = await ctx.blob.get(keptKey(source.org_id, source.id));
    if (!bytes) return c.body(null, 204);
    return c.body(new Uint8Array(bytes), 200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
  });

  reg.add({ method: 'put', path: '/connector/:connector/kept', summary: 'Replace what the connector keeps for its next run; the hub stores the bytes as given', tag: 'push', params: ['connector'], auth: 'source', responses: { '204': 'stored', '404': 'no such connector for this client', '413': 'body too large', '429': 'rate limited' } });
  app.put('/connector/:connector/kept', async (c) => {
    const { clientId, source } = await mine(c);
    if (!limiter.allow(`client:${clientId}:${source.id}`)) {
      ctx.log.warn('kept.ratelimited', { connectorId: source.id, clientId });
      throw new HttpError(429, 'rate limit exceeded');
    }
    if (Number(c.req.header('content-length') ?? '0') > KEPT_MAX_BYTES) throw new HttpError(413, `body exceeds ${KEPT_MAX_BYTES} bytes`);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > KEPT_MAX_BYTES) throw new HttpError(413, `body exceeds ${KEPT_MAX_BYTES} bytes`);
    await ctx.blob.put(keptKey(source.org_id, source.id), bytes, 'application/octet-stream');
    ctx.log.info('kept.stored', { connectorId: source.id, bytes: bytes.length });
    return c.body(null, 204);
  });

  reg.add({ method: 'post', path: '/connector/:connector/failures', summary: 'Record a run that failed before it could push, so the workspace sees why', tag: 'push', params: ['connector'], body: { error: 'what went wrong', job: "optional: the pool's run this was" }, auth: 'source', responses: { '201': 'recorded' } });
  app.post('/connector/:connector/failures', async (c) => {
    const { clientId, source } = await mine(c);
    const input = await body(c, z.object({ error: z.string().min(1).max(4000), job: z.string().min(1).max(100).optional() }).strict());
    // A pool's run of this connector is named, so the pool's word on how it ended finds the failure already recorded.
    const job = input.job ? await jobById(ctx.db, input.job) : undefined;
    const jobId = job && job.kind === 'connector-run' && job.payload['sourceId'] === source.id ? job.id : null;
    const runId = await recordFailedRun(ctx, { source, trigger: 'push', startedAt: new Date(), jobId, who: `connector-client:${clientId}` }, input.error);
    return c.json({ runId }, 201);
  });

  return app;
}

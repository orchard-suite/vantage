import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createRegistry, runPool, type Connector, type FetchLike, type Logger } from '@vantage/connectors';
import { testApp, type TestApp } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';
import { scheduleDue } from '../worker/schedule.ts';
import { nextRunAt } from './runs.ts';

const groups: Connector<{ rg: string }> = {
  id: 'groups',
  configSchema: z.object({ rg: z.string() }).strict(),
  async *discover(ctx) {
    yield { source: 'x', observed: ctx.now().toISOString(), entities: [{ id: ctx.config.rg, type: 'resourcegroup', name: ctx.config.rg }], relations: [] };
  },
};
const host: Connector<Record<string, never>> = { id: 'host', configSchema: z.object({}).strict(), hostIdentity: true, async *discover() {} };

const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} };

async function setup(env: Record<string, string> = {}) {
  const t = await testApp({ connectors: [groups as Connector, host as Connector], env });
  const author = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: author.headers })).body['workspaces'] as { slug: string }[])[0]!;
  const make = (body: Record<string, unknown>) => t.json(`/api/v1/workspaces/${ws.slug}/connectors`, { method: 'POST', headers: author.headers, body: JSON.stringify(body) });
  return { t, author, ws, make };
}

const queuedRuns = async (t: TestApp) => t.ctx.db.query<{ id: string; state: string }>("select id, state from jobs where kind = 'connector-run' order by created_at");

describe('connector pool', () => {
  test('takes an interval only for a kind the pool runs, and no shorter than the hub allows', async () => {
    const { t, make } = await setup();
    expect((await make({ name: 'Push', connector: 'push', clientId: 'a', every: 10 })).body['error']).toContain('push connector has nothing to run');
    expect((await make({ name: 'Host', connector: 'host', config: {}, clientId: 'a', every: 10 })).body['error']).toContain('needs a runner of its own');
    expect((await make({ name: 'Fast', connector: 'groups', config: { rg: 'x' }, clientId: 'a', every: 2 })).body['error']).toContain('at most every 5 minutes');
    const made = await make({ name: 'Groups', connector: 'groups', config: { rg: 'x' }, clientId: 'a', every: 10 });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ every: 10 });
    expect(typeof made.body['nextRunAt']).toBe('string');
    await t.ctx.db.close();
  });

  test('holds at most the connectors a workspace may have', async () => {
    const { t, make } = await setup({ CONNECTOR_MAX_PER_WORKSPACE: '1' });
    expect((await make({ name: 'One', connector: 'push', clientId: 'a' })).status).toBe(201);
    const second = await make({ name: 'Two', connector: 'push', clientId: 'b' });
    expect(second.status).toBe(409);
    expect(second.body['error']).toContain('the most this hub allows');
    await t.ctx.db.close();
  });

  test('runs a connector now once however often it is asked, for authors only, and leaves it to the pool', async () => {
    const { t, author, ws, make } = await setup();
    const id = (await make({ name: 'Groups', connector: 'groups', config: { rg: 'x' }, clientId: 'app-1', every: 10 })).body['id'] as string;
    const own = (await make({ name: 'Own', connector: 'groups', config: { rg: 'y' }, clientId: 'app-2' })).body['id'] as string;
    const run = (c: string, headers = author.headers) => t.json(`/api/v1/workspaces/${ws.slug}/connectors/${c}/run`, { method: 'POST', headers });

    const first = await run(id);
    expect(first.status).toBe(202);
    const again = await run(id);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ jobId: first.body['jobId'], alreadyWaiting: true });
    expect((await run(own)).body['error']).toContain('runs on a runner of its own');
    // Someone who is no author of the workspace cannot.
    const other = await t.bearer('someone-else');
    expect([403, 404]).toContain((await run(id, other.headers)).status);

    // The hub's own worker never takes a connector run.
    await createWorker(t.ctx).drain();
    expect(await queuedRuns(t)).toEqual([{ id: first.body['jobId'] as string, state: 'queued' }]);
    await t.ctx.db.close();
  });

  test('leases runs only to the pool, keeps the lease, closes it, and drops a run whose connector was paused', async () => {
    const { t, author, ws, make } = await setup();
    const id = (await make({ name: 'Groups', connector: 'groups', config: { rg: 'x' }, clientId: 'app-1', every: 10 })).body['id'] as string;
    const pool = await t.pool();
    const lease = (headers: Record<string, string>) => t.json('/api/v1/connector-pool/lease', { method: 'POST', headers, body: JSON.stringify({ worker: 'w1' }) });
    expect((await lease(pool)).status).toBe(204);

    const jobId = (await t.json(`/api/v1/workspaces/${ws.slug}/connectors/${id}/run`, { method: 'POST', headers: author.headers })).body['jobId'] as string;
    expect((await lease(await t.connector('app-1'))).status).toBe(403);
    const leased = await lease(pool);
    expect(leased.status).toBe(200);
    expect(leased.body).toMatchObject({ job: { id: jobId, connector: id, clientId: 'app-1' }, leaseSeconds: t.ctx.config.JOB_LEASE_SECONDS });

    const call = (path: string, body: Record<string, unknown>) => t.json(`/api/v1/connector-pool/jobs/${jobId}/${path}`, { method: 'POST', headers: pool, body: JSON.stringify(body) });
    expect((await call('renew', { worker: 'w1' })).body).toEqual({ held: true });
    expect((await call('renew', { worker: 'w2' })).body).toEqual({ held: false });
    expect((await call('done', { worker: 'w2' })).body).toEqual({ state: 'lost' });
    expect((await call('done', { worker: 'w1' })).body).toEqual({ state: 'done' });

    // A pool token is no connector: it reads no connector's settings.
    expect((await t.app.request('/api/v1/connector/me', { headers: pool })).status).toBe(403);

    // A run queued before its connector was paused is closed, not handed out.
    await t.json(`/api/v1/workspaces/${ws.slug}/connectors/${id}/run`, { method: 'POST', headers: author.headers });
    await t.ctx.db.query('update sources set enabled = false where id = $1', [id]);
    expect((await lease(pool)).status).toBe(204);
    expect((await queuedRuns(t)).map((r) => r.state)).toEqual(['done', 'done']);
    await t.ctx.db.close();
  });

  test('the scheduler queues a connector in its due minute and no other', async () => {
    const { t, make } = await setup();
    const made = await make({ name: 'Groups', connector: 'groups', config: { rg: 'x' }, clientId: 'app-1', every: 10 });
    const due = nextRunAt({ id: made.body['id'] as string, every_minutes: 10 }, new Date('2026-10-28T03:00:00Z'))!;
    expect((await scheduleDue(t.ctx, new Date(due.getTime() - 60_000))).connectors).toBe(0);
    expect((await scheduleDue(t.ctx, due)).connectors).toBe(1);
    expect((await scheduleDue(t.ctx, new Date(due.getTime() + 10_000))).duplicates).toBe(1);
    expect(await queuedRuns(t)).toHaveLength(1);
    await t.ctx.db.close();
  });

  test('a pool runner leases a run and runs it as the connector\'s own app, which pushes what it found', async () => {
    const { t, author, ws, make } = await setup();
    const id = (await make({ name: 'Groups', slug: 'groups', connector: 'groups', config: { rg: 'prod' }, clientId: 'app-1', every: 10 })).body['id'] as string;
    await t.json(`/api/v1/workspaces/${ws.slug}/connectors/${id}/run`, { method: 'POST', headers: author.headers });

    const dir = mkdtempSync(join(tmpdir(), 'vantage-pool-'));
    writeFileSync(join(dir, 'token'), 'pool-sa-token\n');
    const tokens = { pool: (await t.pool('pool-app')).authorization!.slice(7), 'app-1': (await t.connector('app-1')).authorization!.slice(7) };
    const signedIn: string[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === 'https://login.example/token') {
        const form = new URLSearchParams(String(init?.body));
        expect(form.get('client_assertion')).toBe('pool-sa-token');
        signedIn.push(form.get('client_id')!);
        const token = form.get('client_id') === 'pool-app' ? tokens.pool : tokens['app-1'];
        return new Response(JSON.stringify({ access_token: token, expires_in: 3600 }), { headers: { 'content-type': 'application/json' } });
      }
      return t.app.request(url.replace('https://hub.test', ''), init as RequestInit);
    };
    const stop = new AbortController();
    const log: Logger = { ...quiet, info: (m) => m === 'pool run end' && stop.abort() };
    await runPool({ hub: 'https://hub.test', tokenUrl: 'https://login.example/token', clientId: 'pool-app', scope: 'api://hub/.default', assertionFile: join(dir, 'token'), registry: createRegistry([groups as Connector]), log, fetch: fetchImpl, waitSeconds: 0, signal: stop.signal, worker: 'w1' });

    expect(signedIn).toEqual(['pool-app', 'app-1']);
    expect((await queuedRuns(t)).map((r) => r.state)).toEqual(['done']);
    await createWorker(t.ctx).drain();
    const observed = await t.json(`/api/v1/workspaces/${ws.slug}/connectors/groups/observed?entities=true`, { headers: author.headers });
    expect(Object.keys((observed.body['model'] as { entities: Record<string, unknown> }).entities)).toEqual(['groups:prod']);
    await t.ctx.db.close();
  });

  test('a pooled run that fails before it pushes leaves one failed run with its error, whether or not the runner could report it', async () => {
    const { t, author, ws, make } = await setup();
    const signIn = (await make({ name: 'Refused', slug: 'refused', connector: 'groups', config: { rg: 'prod' }, clientId: 'app-refused', every: 10 })).body['id'] as string;
    const badConfig = (await make({ name: 'Bad', slug: 'bad', connector: 'groups', config: { rg: 'prod' }, clientId: 'app-bad', every: 10 })).body['id'] as string;
    // The pool's registry reads a config its kind refuses: the runner signs in, then reports the failure itself.
    const strict: Connector<{ rg: number }> = { id: 'groups', configSchema: z.object({ rg: z.number() }).strict(), async *discover() {} };

    const dir = mkdtempSync(join(tmpdir(), 'vantage-pool-'));
    writeFileSync(join(dir, 'token'), 'pool-sa-token\n');
    const tokens: Record<string, string> = { pool: (await t.pool('pool-app')).authorization!.slice(7), 'app-bad': (await t.connector('app-bad')).authorization!.slice(7) };
    const fetchImpl: FetchLike = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === 'https://login.example/token') {
        const client = new URLSearchParams(String(init?.body)).get('client_id')!;
        const token = client === 'pool-app' ? tokens['pool'] : tokens[client];
        if (!token) return new Response(JSON.stringify({ error: 'invalid_client', error_description: 'no federated credential matches' }), { status: 401, headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify({ access_token: token, expires_in: 3600 }), { headers: { 'content-type': 'application/json' } });
      }
      return t.app.request(url.replace('https://hub.test', ''), init as RequestInit);
    };
    for (const id of [signIn, badConfig]) {
      await t.json(`/api/v1/workspaces/${ws.slug}/connectors/${id}/run`, { method: 'POST', headers: author.headers });
      const stop = new AbortController();
      const log: Logger = { ...quiet, info: (m) => m === 'pool run end' && stop.abort() };
      await runPool({ hub: 'https://hub.test', tokenUrl: 'https://login.example/token', clientId: 'pool-app', scope: 'api://hub/.default', assertionFile: join(dir, 'token'), registry: createRegistry([strict as Connector]), log, fetch: fetchImpl, waitSeconds: 0, signal: stop.signal, worker: 'w1' });
    }

    expect((await queuedRuns(t)).map((r) => r.state)).toEqual(['failed', 'failed']);
    const runs = await t.ctx.db.query<{ source_id: string; status: string; error: string; job_id: string | null }>('select source_id, status, error, job_id from source_runs order by started_at');
    const jobs = (await queuedRuns(t)).map((r) => r.id);
    expect(runs.map((r) => [r.source_id, r.status, r.job_id])).toEqual([[signIn, 'failed', jobs[0]!], [badConfig, 'failed', jobs[1]!]]);
    expect(runs[0]!.error).toContain('the issuer refused the client app-refused');
    expect(runs[1]!.error).toContain('config invalid');
    await t.ctx.db.close();
  });
});

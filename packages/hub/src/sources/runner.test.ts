import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createRegistry, decodeKept, runConnectorOnce, type Connector, type FetchLike } from '@vantage/connectors';
import { testApp } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';
import { keptKey } from '../api/push.ts';

const kind: Connector<{ rg: string }> = {
  id: 'groups',
  configSchema: z.object({ rg: z.string() }).strict(),
  async *discover(ctx) {
    yield { source: 'x', observed: ctx.now().toISOString(), entities: [{ id: ctx.config.rg, type: 'resourcegroup', name: ctx.config.rg, facts: { resourceGroup: ctx.config.rg } }], relations: [] };
  },
};

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

describe('connector runner', () => {
  test('signs in as its client with a workload identity token, reads its settings, runs its kind, and pushes', async () => {
    const t = await testApp();
    const author = await t.bearer('author');
    const ws = ((await t.json('/api/v1/workspaces', { headers: author.headers })).body['workspaces'] as { slug: string }[])[0]!;
    const created = await t.json(`/api/v1/workspaces/${ws.slug}/connectors`, { method: 'POST', headers: { ...author.headers }, body: JSON.stringify({ name: 'Azure', slug: 'azure', connector: 'push', clientId: 'app-1' }) });
    const id = created.body['id'] as string;
    // The hub knows no kind 'groups'; the runner does. Store it as the kind the runner runs.
    await t.ctx.db.query("update sources set connector = 'groups', config = $2 where id = $1", [id, JSON.stringify({ rg: 'rg-app' })]);

    const dir = mkdtempSync(join(tmpdir(), 'vantage-runner-'));
    writeFileSync(join(dir, 'token'), 'kube-sa-token\n');
    const asked: URLSearchParams[] = [];
    const access = (await t.connector('app-1')).authorization!.slice(7);
    const fetchImpl: FetchLike = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://login.example/token')) {
        asked.push(new URLSearchParams(String(init?.body)));
        return new Response(JSON.stringify({ access_token: access }), { headers: { 'content-type': 'application/json' } });
      }
      return t.app.request(url.replace('https://hub.test', ''), init as RequestInit);
    };
    const out = await runConnectorOnce({ hub: 'https://hub.test', connector: id, tokenUrl: 'https://login.example/token', clientId: 'app-1', scope: 'api://hub/.default', assertionFile: join(dir, 'token'), registry: createRegistry([kind as Connector]), log: quiet, fetch: fetchImpl });
    expect(out).toMatchObject({ connector: 'azure', kind: 'groups', entities: 1 });
    expect(asked[0]!.get('grant_type')).toBe('client_credentials');
    expect(asked[0]!.get('client_assertion')).toBe('kube-sa-token');
    expect(asked[0]!.get('scope')).toBe('api://hub/.default');
    await createWorker(t.ctx).drain();
    const observed = await t.json(`/api/v1/workspaces/${ws.slug}/connectors/azure/observed?entities=true`, { headers: author.headers });
    expect(Object.keys((observed.body['model'] as { entities: Record<string, unknown> }).entities)).toEqual(['azure:rg-app']);

    // A kind the runner lacks fails, and the hub hears why.
    await t.ctx.db.query("update sources set connector = 'nope' where id = $1", [id]);
    await expect(runConnectorOnce({ hub: 'https://hub.test', connector: id, tokenUrl: 'https://login.example/token', clientId: 'app-1', scope: 'api://hub/.default', assertionFile: join(dir, 'token'), registry: createRegistry([kind as Connector]), log: quiet, fetch: fetchImpl })).rejects.toThrow('no connector kind nope');
    const last = (await t.json(`/api/v1/workspaces/${ws.slug}/connectors/azure`, { headers: author.headers })).body['lastRun'] as { status: string; error: string };
    expect(last.status).toBe('failed');
    expect(last.error).toContain('no connector kind nope');
    await t.ctx.db.close();
  });

  test('reads what the connector kept before a run, stores what it kept after, and stores nothing when nothing changed', async () => {
    const t = await testApp();
    const author = await t.bearer('author');
    const ws = ((await t.json('/api/v1/workspaces', { headers: author.headers })).body['workspaces'] as { slug: string }[])[0]!;
    const created = await t.json(`/api/v1/workspaces/${ws.slug}/connectors`, { method: 'POST', headers: { ...author.headers }, body: JSON.stringify({ name: 'Counter', slug: 'counter', connector: 'push', clientId: 'app-2' }) });
    const id = created.body['id'] as string;
    await t.ctx.db.query("update sources set connector = 'counter', config = '{}' where id = $1", [id]);
    // A kind that counts its runs in what it keeps, until it is told to stop counting.
    let counting = true;
    const seen: unknown[] = [];
    const counter: Connector<Record<string, never>> = {
      id: 'counter',
      configSchema: z.object({}).strict(),
      async *discover(ctx) {
        const n = ctx.kept?.get('runs');
        seen.push(n);
        if (counting) ctx.kept?.set('runs', (typeof n === 'number' ? n : 0) + 1);
        yield { source: 'x', observed: ctx.now().toISOString(), entities: [], relations: [] };
      },
    };
    const dir = mkdtempSync(join(tmpdir(), 'vantage-runner-'));
    writeFileSync(join(dir, 'token'), 'kube-sa-token\n');
    const access = (await t.connector('app-2')).authorization!.slice(7);
    const puts: number[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://login.example/token')) return new Response(JSON.stringify({ access_token: access }), { headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/kept') && init?.method === 'PUT') puts.push(1);
      return t.app.request(url.replace('https://hub.test', ''), init as RequestInit);
    };
    const run = () => runConnectorOnce({ hub: 'https://hub.test', connector: id, tokenUrl: 'https://login.example/token', clientId: 'app-2', scope: 'api://hub/.default', assertionFile: join(dir, 'token'), registry: createRegistry([counter as Connector]), log: quiet, fetch: fetchImpl });
    await run();
    await run();
    counting = false;
    await run();
    expect(seen).toEqual([undefined, 1, 2]);
    expect(puts).toHaveLength(2);
    const org = (await t.ctx.db.query<{ org_id: string }>('select org_id from sources where id = $1', [id]))[0]!.org_id;
    expect(decodeKept((await t.ctx.blob.get(keptKey(org, id)))!)).toEqual({ runs: 2 });

    // Another client may not read it, and it goes with its connector.
    const other = await t.connector('app-3');
    expect((await t.app.request(`/api/v1/connector/${id}/kept`, { headers: other })).status).toBe(404);
    expect((await t.app.request(`/api/v1/workspaces/${ws.slug}/connectors/counter`, { method: 'DELETE', headers: author.headers })).status).toBe(204);
    expect(await t.ctx.blob.get(keptKey(org, id))).toBeUndefined();
    await t.ctx.db.close();
  });

  test('names the status when the hub answers with a page that is not JSON, as a gateway does while the hub restarts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vantage-runner-'));
    writeFileSync(join(dir, 'token'), 'kube-sa-token\n');
    const fetchImpl: FetchLike = async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://login.example/token')) return new Response(JSON.stringify({ access_token: 'a' }), { headers: { 'content-type': 'application/json' } });
      return new Response('Bad Gateway', { status: 502, headers: { 'content-type': 'text/plain' } });
    };
    await expect(runConnectorOnce({ hub: 'https://hub.test', connector: 'c1', tokenUrl: 'https://login.example/token', clientId: 'app-1', scope: 'api://hub/.default', assertionFile: join(dir, 'token'), registry: createRegistry([kind as Connector]), log: quiet, fetch: fetchImpl })).rejects.toThrow('GET /connector/c1: 502 Bad Gateway');
  });
});

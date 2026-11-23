import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { convertBackstage, runConnector, type Connector } from '@vantage/connectors';
import { fakeFetch, testApp } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';

const FIXTURE = join(import.meta.dir, '..', '..', '..', 'connectors', 'src', 'fixtures', 'backstage-catalog.json');
const catalog = JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown;

/** A connector kind that yields the Backstage fixture; the runner side of the test runs it the way the runner does. */
const FixtureConfig = z.object({ label: z.string().optional() }).strict();
const fixtureConnector: Connector<z.output<typeof FixtureConfig>> = {
  id: 'fixture',
  configSchema: FixtureConfig,
  async *discover(ctx) {
    yield convertBackstage(catalog, 'fixture', ctx.now().toISOString()).batch;
  },
};

const BOUND_YAML = `title: Shop
nodes:
  - id: shop
    name: Shop
    type: system
    bind: catalog:system:default/shop
    children:
      - id: checkout
        name: Checkout
        type: service
        bind: catalog:component:default/checkout
        facts: ['lifecycle: staging']
      - id: ghost
        name: Ghost
        type: service
        bind: catalog:component:default/ghost
  - id: shoppers
    name: Shoppers
    type: users
relations:
  - { from: shoppers, to: checkout, label: buys, tags: [context] }
views:
  - id: context
    title: Context
    include: { tags: [context] }
`;

describe('connectors', () => {
  test('a workspace connector, run outside the hub, pushes as its own client; the workspace alone reads it; admins approve and stop it', async () => {
    const dispatch = fakeFetch([{ match: 'dispatch.example.test/v1/events', json: { queued: 1 } }]);
    const t = await testApp({ connectors: [fixtureConnector as Connector], fetch: dispatch.fetch, env: { EMBED_ORIGINS: 'https://docs.example.test', CONNECTOR_APPROVAL: 'true', DISPATCH_URL: 'https://dispatch.example.test', DISPATCH_TOKEN: 'vantage-token' } });
    const worker = createWorker(t.ctx);
    const admin = await t.bearer('admin', { admin: true });
    const author = await t.bearer('author');
    const stranger = await t.bearer('stranger');
    const client = await t.connector('client-catalog');

    const ws = ((await t.json('/api/v1/workspaces', { headers: author.headers })).body['workspaces'] as { slug: string; id: string }[])[0]!;
    const other = ((await t.json('/api/v1/workspaces', { headers: stranger.headers })).body['workspaces'] as { slug: string; id: string }[])[0]!;
    const base = `/api/v1/workspaces/${ws.slug}/connectors`;

    expect((await t.json(base, { method: 'POST', headers: author.headers, body: JSON.stringify({ name: 'Catalog', slug: 'catalog', connector: 'nope', clientId: 'client-catalog' }) })).status).toBe(400);
    expect((await t.json(base, { method: 'POST', headers: author.headers, body: JSON.stringify({ name: 'Catalog', slug: 'catalog', connector: 'fixture', config: { bogus: 1 }, clientId: 'client-catalog' }) })).status).toBe(400);
    expect((await t.json(base, { method: 'POST', headers: author.headers, body: JSON.stringify({ name: 'Catalog', slug: 'catalog', connector: 'fixture' }) })).status).toBe(400);
    expect((await t.json(`/api/v1/workspaces/${other.slug}/connectors`, { method: 'POST', headers: author.headers, body: JSON.stringify({ name: 'X', connector: 'push', clientId: 'c' }) })).status).toBe(404);
    const created = await t.json(base, { method: 'POST', headers: author.headers, body: JSON.stringify({ name: 'Catalog', slug: 'catalog', connector: 'fixture', config: { label: 'shop' }, clientId: 'client-catalog' }) });
    expect(created.status).toBe(201);
    expect(created.body['approval']).toBe('pending');
    expect(created.body['blocked']).toContain('waiting for an admin');
    expect(created.body['token']).toBeUndefined();
    const connectorId = created.body['id'] as string;

    // Readers of another workspace never see it; its readers do.
    expect((await t.json(`/api/v1/workspaces/${ws.slug}/connectors`, { headers: stranger.headers })).status).toBe(404);
    expect((await t.json(`/api/v1/workspaces/${other.slug}/connectors`, { headers: stranger.headers })).body['connectors']).toEqual([]);
    // The same slug may be taken again in another workspace, even by the same OAuth app.
    const twin = await t.json(`/api/v1/workspaces/${other.slug}/connectors`, { method: 'POST', headers: stranger.headers, body: JSON.stringify({ name: 'Catalog', slug: 'catalog', connector: 'push', clientId: 'client-catalog' }) });
    expect(twin.status).toBe(201);

    // The connector's own client reads its settings, and only its own.
    const me = await t.json('/api/v1/connector/me', { headers: client });
    expect((me.body['connectors'] as { id: string }[]).map((c) => c.id).sort()).toEqual([connectorId, twin.body['id'] as string].sort());
    expect((await t.json(`/api/v1/connector/${connectorId}`, { headers: client })).body['config']).toEqual({ label: 'shop' });
    expect((await t.json(`/api/v1/connector/${connectorId}`, { headers: await t.connector('someone-else') })).status).toBe(404);
    expect((await t.json(`/api/v1/connector/${connectorId}`, { headers: await t.connector('client-catalog', { roles: [] }) })).status).toBe(401);
    expect((await t.json(`/api/v1/connector/${connectorId}`, { headers: await t.connector('client-catalog', { idtyp: 'user', scp: 'access_as_user' }) })).status).toBe(401);
    expect((await t.json(`/api/v1/connector/${connectorId}`, { headers: author.headers })).status).toBe(403);
    expect((await t.json('/api/v1/workspaces', { headers: client })).status).toBe(403);

    const mapping = await t.json(`${base}/catalog/mappings`, { method: 'POST', headers: author.headers, body: JSON.stringify({ name: 'software', yaml: 'source: catalog\nprofile: software\ntypes:\n  component:service: service\n  system: system\n' }) });
    expect(mapping.status).toBe(201);
    expect((await t.json(`${base}/catalog/mappings`, { method: 'POST', headers: stranger.headers, body: JSON.stringify({ name: 'x', yaml: 'source: catalog\nprofile: software\n' }) })).status).toBe(404);

    await t.json(`/api/v1/workspaces/${ws.slug}`, { method: 'PATCH', headers: author.headers, body: JSON.stringify({ settings: { notifications: { to: [{ chain: 'platform-oncall' }] } } }) });
    const saved = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: author.headers, body: JSON.stringify({ yaml: BOUND_YAML }) });
    expect(saved.status).toBe(201);
    const doc = saved.body['document'] as { id: string; slug: string };
    const v1 = (saved.body['version'] as { id: string }).id;
    await worker.drain();
    const before = await t.json(`/api/v1/documents/${doc.id}/drift`, { headers: author.headers });
    expect(before.body['counts']).toEqual({ declaredNotObserved: 3, observedNotDeclared: 0, factMismatch: 0 });

    // The runner: reads its settings, runs the connector kind, pushes. Waiting for approval, the push is refused.
    const settings = (await t.json(`/api/v1/connector/${connectorId}`, { headers: client })).body;
    const run = await runConnector(fixtureConnector as Connector, { config: settings['config'], secrets: async () => '', log: { debug() {}, info() {}, warn() {}, error() {} }, now: () => new Date(), signal: new AbortController().signal, fetch }, 'catalog');
    const pushOnce = () => t.json(`/api/v1/connector/${connectorId}/batches`, { method: 'POST', headers: client, body: JSON.stringify(run.batch) });
    const waiting = await pushOnce();
    expect(waiting.status).toBe(403);
    expect(String(waiting.body['error'])).toContain('waiting for an admin');

    const listed = await t.json('/api/v1/admin/connectors', { headers: admin.headers });
    expect((listed.body['connectors'] as { id: string; workspace: string; clientId: string }[]).find((c) => c.id === connectorId)).toMatchObject({ workspace: ws.slug, clientId: 'client-catalog' });
    expect((await t.json('/api/v1/admin/connectors', { headers: author.headers })).status).toBe(403);
    expect((await t.json(`/api/v1/admin/connectors/${connectorId}/approve`, { method: 'POST', headers: admin.headers })).body['approval']).toBe('approved');

    expect((await pushOnce()).status).toBe(202);
    expect(await worker.drain()).toBeGreaterThanOrEqual(2);
    const runs = await t.json(`${base}/catalog/runs`, { headers: author.headers });
    const first = (runs.body['runs'] as { status: string; trigger: string; counts: Record<string, number>; warnings: string[] }[])[0]!;
    expect(first.status).toBe('ok');
    expect(first.trigger).toBe('push');
    expect(first.counts['entities']).toBeGreaterThan(5);
    expect(first.counts['documentsOverlaid']).toBe(1);
    expect(first.warnings.some((w) => w.includes('unknown type'))).toBe(true);
    const observed = await t.json(`${base}/catalog/observed?entities=true`, { headers: author.headers });
    expect((observed.body['model'] as { entities: Record<string, { type: string }> }).entities['catalog:component:default/checkout']?.type).toBe('service');
    expect((await t.json(`${base}/catalog/observed`, { headers: stranger.headers })).status).toBe(404);

    // The twin in the other workspace, same slug and same app, saw nothing of this push.
    expect((await t.json(`/api/v1/workspaces/${other.slug}/connectors/catalog/observed`, { headers: stranger.headers })).body['entities']).toBe(0);

    const art = await t.app.request(`/api/v1/workspaces/${ws.slug}/documents/${doc.slug}/artifacts/bundle`, { headers: author.headers });
    const bundleText = await art.text();
    expect(bundleText).toContain('payments');
    expect(bundleText).toContain('staging');
    const html = await (await t.app.request(`/api/v1/workspaces/${ws.slug}/documents/${doc.slug}/artifacts/html`, { headers: author.headers })).text();
    expect(html).toContain(v1);

    const after = await t.json(`/api/v1/documents/${doc.id}/drift`, { headers: author.headers });
    const counts = after.body['counts'] as { declaredNotObserved: number; observedNotDeclared: number; factMismatch: number };
    expect(counts.declaredNotObserved).toBe(1);
    expect(counts.factMismatch).toBe(1);
    expect(counts.observedNotDeclared).toBeGreaterThanOrEqual(3);
    const png = await t.app.request(`/api/v1/documents/${doc.id}/drift?format=png`, { headers: author.headers });
    expect(png.headers.get('content-type')).toBe('image/png');
    expect((await t.json(`/api/v1/documents/${doc.id}/drift`, { headers: stranger.headers })).status).toBe(404);
    expect((await t.json(`/api/v1/documents/${doc.id}/bundle`, { headers: client })).status).toBe(403);
    expect(dispatch.calls.length).toBe(1);
    const drift = JSON.parse(dispatch.calls[0]!.body!) as { kind: string; severity: string; labels: Record<string, string>; to: unknown[] };
    expect(drift).toMatchObject({ kind: 'vantage.drift', severity: 'warning', labels: { workspace: ws.slug }, to: [{ chain: 'platform-oncall' }] });
    expect(dispatch.calls[0]!.headers['authorization']).toBe('Bearer vantage-token');

    // A change to what it reads takes the approval back; an admin stop holds even after.
    const changed = await t.json(`${base}/catalog`, { method: 'PUT', headers: author.headers, body: JSON.stringify({ name: 'Catalog', connector: 'fixture', config: { label: 'all' }, clientId: 'client-catalog' }) });
    expect(changed.body['approval']).toBe('pending');
    expect((await pushOnce()).status).toBe(403);
    await t.json(`/api/v1/admin/connectors/${connectorId}/stop`, { method: 'POST', headers: admin.headers });
    expect(String((await pushOnce()).body['error'])).toContain('stopped');

    const failed = await t.json(`/api/v1/connector/${connectorId}/failures`, { method: 'POST', headers: client, body: JSON.stringify({ error: 'Azure said 403' }) });
    expect(failed.status).toBe(201);
    expect(((await t.json(`${base}/catalog`, { headers: author.headers })).body['lastRun'] as { status: string; error: string })).toMatchObject({ status: 'failed', error: 'Azure said 403' });

    const audits = (await t.ctx.db.query<{ what: string }>('select what from audit order by at')).map((a) => a.what);
    for (const w of ['connector.create', 'mapping.create', 'connector.approve', 'source.run', 'connector.update', 'connector.stop']) expect(audits).toContain(w);

    const url = new URL('http://hub.test/mcp?tools=all');
    const fetchViaApp = (input: string | URL, init?: RequestInit): Promise<Response> => Promise.resolve(t.app.request(String(input), init));
    const mcp = new Client({ name: 'test', version: '0' });
    await mcp.connect(new StreamableHTTPClientTransport(url, { fetch: fetchViaApp, requestInit: { headers: author.headers } }));
    const tools = (await mcp.listTools()).tools.map((x) => x.name);
    for (const name of ['vantage_sources', 'vantage_connector_save', 'vantage_connector_run', 'vantage_drift', 'vantage_publications', 'vantage_publish', 'vantage_connectors']) expect(tools).toContain(name);
    expect(tools).not.toContain('vantage_source_run');
    const sources = (await mcp.callTool({ name: 'vantage_sources', arguments: { workspace: ws.slug } })).content as { text: string }[];
    expect(sources[0]!.text).toContain('catalog: Catalog (fixture) client=client-catalog runs=own-runner approval=stopped');
    const hidden = (await mcp.callTool({ name: 'vantage_sources', arguments: { workspace: other.slug } })) as { isError?: boolean };
    expect(hidden.isError).toBe(true);
    const kinds = (await mcp.callTool({ name: 'vantage_connectors', arguments: {} })).content as { text: string }[];
    expect(kinds[0]!.text).toContain('Vantage.Connector');
    expect(kinds[0]!.text).toContain('fixture');

    // An agent adds a connector and changes only what it names; the same checks hold.
    const save = async (args: Record<string, unknown>) => ((await mcp.callTool({ name: 'vantage_connector_save', arguments: { workspace: ws.slug, ...args } })) as { content: { text: string }[]; isError?: boolean });
    const added = await save({ name: 'Pushed', slug: 'pushed', kind: 'push', clientId: 'c-agent' });
    expect(added.content[0]!.text).toContain('added pushed');
    expect((await save({ connector: 'pushed', every: 10 })).content[0]!.text).toContain('push connector has nothing to run');
    expect((await save({ connector: 'pushed', enabled: false })).content[0]!.text).toContain('changed pushed: push client=c-agent runs=own-runner approval=pending enabled=false');
    expect((await mcp.callTool({ name: 'vantage_sources', arguments: { workspace: ws.slug, connector: 'catalog' } })).content as { text: string }[]).toMatchObject([{ text: expect.stringContaining('config: {') }]);
    await mcp.close();

    expect((await t.json(`${base}/catalog`, { method: 'DELETE', headers: author.headers })).status).toBe(204);
    expect((await t.json(`/api/v1/connector/${connectorId}`, { headers: client })).status).toBe(404);
    await t.ctx.db.close();
  }, 60_000);

  test('a push connector takes batches and Backstage documents from its client, and is rate limited', async () => {
    const t = await testApp();
    const author = await t.bearer('author');
    const ws = ((await t.json('/api/v1/workspaces', { headers: author.headers })).body['workspaces'] as { slug: string }[])[0]!;
    const base = `/api/v1/workspaces/${ws.slug}/connectors`;
    expect((await t.json(base, { method: 'POST', headers: author.headers, body: JSON.stringify({ name: 'Pushed', connector: 'push', config: { a: 1 }, clientId: 'c-push' }) })).status).toBe(400);
    const created = await t.json(base, { method: 'POST', headers: author.headers, body: JSON.stringify({ name: 'Pushed', slug: 'pushed', connector: 'push', clientId: 'c-push' }) });
    expect(created.status).toBe(201);
    expect(created.body['blocked']).toBeNull();
    const id = created.body['id'] as string;
    const headers = await t.connector('c-push');

    const worker = createWorker(t.ctx);
    const push = async (body: string): Promise<{ status: number; shape: unknown; counts: Record<string, number> }> => {
      const r = await t.json(`/api/v1/connector/${id}/batches`, { method: 'POST', headers, body });
      expect(r.body['queued']).toBe(true);
      await worker.drain();
      const runs = await t.json(`${base}/pushed/runs?limit=1`, { headers: author.headers });
      return { status: r.status, shape: r.body['shape'], counts: (runs.body['runs'] as { counts: Record<string, number> }[])[0]!.counts };
    };
    const batch = await push(JSON.stringify({ entities: [{ id: 'a', type: 'service', name: 'A', facts: { replicas: 2 } }, { id: 'b', type: 'database', name: 'B' }], relations: [{ from: 'a', to: 'b', label: 'writes' }] }));
    expect(batch.status).toBe(202);
    expect(batch.shape).toBe('batch');
    expect(batch.counts).toMatchObject({ entities: 2, relations: 1, appeared: 2, vanished: 0 });
    const partial = await push(JSON.stringify({ partial: true, entities: [{ id: 'a', type: 'service', name: 'A', facts: { replicas: 3 } }] }));
    expect(partial.counts).toMatchObject({ entities: 1, appeared: 0, vanished: 0, factChanges: 1 });
    const full = await push(JSON.stringify({ entities: [{ id: 'a', type: 'service', name: 'A' }] }));
    expect(full.counts).toMatchObject({ vanished: 1 });
    const backstage = await push(readFileSync(FIXTURE, 'utf8'));
    expect(backstage.shape).toBe('backstage');
    expect(await t.ctx.blob.list('batches/')).toEqual([]);

    expect((await t.json(`/api/v1/connector/${id}/batches`, { method: 'POST', headers, body: JSON.stringify({ entities: [{ id: 'x' }] }) })).status).toBe(400);
    expect((await t.json(`/api/v1/connector/${id}/batches`, { method: 'POST', headers: author.headers, body: JSON.stringify({ entities: [] }) })).status).toBe(403);
    expect((await t.json(`/api/v1/connector/${id}/batches`, { method: 'POST', headers: { authorization: 'Bearer vst_nothing' }, body: JSON.stringify({ entities: [] }) })).status).toBe(401);
    expect((await t.json(`/api/v1/connector/${id}/batches`, { method: 'POST', headers: await t.connector('c-push', {}).then((h) => h), body: JSON.stringify({ partial: true, entities: [] }) })).status).toBe(202);

    let last = 202;
    for (let i = 0; i < 70 && last !== 429; i++) last = (await t.json(`/api/v1/connector/${id}/batches`, { method: 'POST', headers, body: JSON.stringify({ partial: true, entities: [] }) })).status;
    expect(last).toBe(429);
    await worker.drain();
    await t.ctx.db.close();
  });
});

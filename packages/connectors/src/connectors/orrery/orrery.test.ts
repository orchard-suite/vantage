import { describe, expect, test } from 'bun:test';
import { mergeBatches } from '../../batch.ts';
import { runConnector } from '../../run.ts';
import type { FetchLike } from '../../connector.ts';
import { keptStore } from '../../kept.ts';
import { drain, fixtureFetch, testContext } from '../../testing.ts';
import { alertSeverity, orreryConnector, OrreryConfigSchema } from './orrery.ts';

const dir = `${import.meta.dir}/fixtures`;

function hub(withAlerts = false, web: string | null = 'https://web.example.test/') {
  return fixtureFetch(dir, [
    ...(web !== null ? [{ match: '/v1/whoami', json: { identity: { kind: 'token', name: 'vantage' }, version: '1.136.0', web } }] : []),
    ...(withAlerts ? [{ match: '/v1/alerts', file: 'alerts.json' }] : []),
    { match: '/v1/blueprints', file: 'blueprints.json' },
    { match: 'blueprint=k8s-namespace', file: 'entities-k8s-namespace.json' },
    { match: /blueprint=k8s-deployment.*offset=0/, file: 'entities-k8s-deployment-0.json' },
    { match: /blueprint=k8s-deployment.*offset=2/, file: 'entities-k8s-deployment-2.json' },
    { match: 'blueprint=k8s-service', file: 'entities-k8s-service.json' },
  ]);
}

const config = OrreryConfigSchema.parse({
  url: 'https://hub.example.test',
  token: 'orrery-token',
  types: { 'k8s-deployment': 'workload', 'k8s-service': 'service', 'k8s-namespace': 'namespace' },
  parentRelation: 'namespace',
  pageSize: 2,
  relationKinds: { service: 'sync' },
});

describe('orrery connector', () => {
  test('keepFields widens a blueprint that lists its facts, and leaves one that keeps every field alone', () => {
    const config = OrreryConfigSchema.parse({ url: 'https://catalog.example.com', token: 'catalog-token', blueprints: ['program', 'team'], facts: { program: ['lifecycle'] } });
    const kept = orreryConnector.keepFields!(config, { program: ['facets', 'description', 'lifecycle'], team: ['description'] });
    expect(kept.facts).toEqual({ program: ['lifecycle', 'facets', 'description'] });
    expect(config.facts).toEqual({ program: ['lifecycle'] });
  });

  test('lists blueprints, pages entities, and sends the bearer token', async () => {
    const f = hub();
    const ctx = testContext(config, f.fetch, { 'orrery-token': 'secret-value' });
    const batches = await drain(orreryConnector.discover(ctx));
    expect(batches.map((b) => b.entities.length)).toEqual([1, 3, 1]);
    expect(f.calls.every((c) => c.headers.authorization === 'Bearer secret-value')).toBe(true);
    const deploymentCalls = f.calls.filter((c) => c.url.includes('blueprint=k8s-deployment'));
    expect(deploymentCalls.map((c) => new URL(c.url).searchParams.get('offset'))).toEqual(['0', '2']);
    expect(ctx.log.records.filter((r) => r.message === 'orrery page')).toHaveLength(4);
  });

  test('maps blueprint to type, parent from the named relation, facts from fields, and url to the entity page', async () => {
    const ctx = testContext(config, hub().fetch, { 'orrery-token': 't' });
    const all = mergeBatches(await drain(orreryConnector.discover(ctx)), '2026-10-28T10:00:00Z');
    const relay = all.entities.find((e) => e.id === 'k8s-deployment:relay/relay');
    expect(relay).toMatchObject({ type: 'workload', name: 'Relay', parent: 'k8s-namespace:relay', subtitle: 'relay/relay', tags: ['k8s-deployment'] });
    expect(relay?.facts).toEqual({ image: 'registry.example.test/relay:1.4.2', replicas: 2, ready: 2 });
    expect(relay?.url).toBe('https://web.example.test/entities/k8s-deployment/relay/relay');
  });

  test('links to the machine address when the hub names no web address', async () => {
    const ctx = testContext(config, hub(false, null).fetch, { 'orrery-token': 't' });
    const all = mergeBatches(await drain(orreryConnector.discover(ctx)), '2026-10-28T10:00:00Z');
    expect(all.entities.find((e) => e.id === 'k8s-deployment:relay/relay')?.url).toBe('https://hub.example.test/entities/k8s-deployment/relay/relay');
    expect(ctx.log.records.some((r) => r.message === 'orrery whoami unavailable')).toBe(true);
  });

  test('keeps only the configured fields as facts, in their order, and every field for a blueprint not listed', async () => {
    const ctx = testContext({ ...config, facts: { 'k8s-deployment': ['ready', 'image', 'absent'] } }, hub().fetch, { 'orrery-token': 't' });
    const all = mergeBatches(await drain(orreryConnector.discover(ctx)), '2026-10-28T10:00:00Z');
    const relay = all.entities.find((e) => e.id === 'k8s-deployment:relay/relay');
    expect(Object.entries(relay?.facts ?? {})).toEqual([['ready', 2], ['image', 'registry.example.test/relay:1.4.2']]);
    const service = all.entities.find((e) => e.id === 'k8s-service:relay/relay');
    expect(Object.keys(service?.facts ?? {}).length).toBeGreaterThan(0);
  });

  test('builds relations from outgoing refs, skipping restricted targets, and keeps the parent relation as a relation too', async () => {
    const ctx = testContext(config, hub().fetch, { 'orrery-token': 't' });
    const all = mergeBatches(await drain(orreryConnector.discover(ctx)), '2026-10-28T10:00:00Z');
    const serves = all.relations.filter((r) => r.label === 'service');
    expect(serves).toHaveLength(1);
    expect(serves[0]).toMatchObject({ from: 'k8s-deployment:relay/relay', to: 'k8s-service:relay/relay', kind: 'sync' });
    expect(all.relations.find((r) => r.label === 'namespace' && r.from === 'k8s-deployment:relay/relay')).toEqual({ from: 'k8s-deployment:relay/relay', to: 'k8s-namespace:relay', label: 'namespace', tags: ['namespace'] });
    expect(all.relations.some((r) => r.to.includes('secrets'))).toBe(false);
    const sealer = all.entities.find((e) => e.id === 'k8s-deployment:secrets/sealer');
    expect(sealer?.parent).toBeUndefined();
  });

  test('asks only for the fields kept as facts, every field for a blueprint not listed, and no incoming references', async () => {
    const f = hub();
    await drain(orreryConnector.discover(testContext({ ...config, facts: { 'k8s-deployment': ['ready', 'image'], 'k8s-namespace': [] } }, f.fetch, { 'orrery-token': 't' })));
    const asked = (bp: string) => f.calls.filter((c) => c.url.includes(`blueprint=${bp}`)).map((c) => new URL(c.url).searchParams);
    expect(asked('k8s-deployment').map((q) => q.get('fields'))).toEqual(['ready,image', 'ready,image']);
    expect(asked('k8s-namespace').map((q) => q.get('fields'))).toEqual(['']);
    expect(asked('k8s-service').map((q) => q.has('fields'))).toEqual([false]);
    expect(f.calls.some((c) => new URL(c.url).searchParams.has('incoming'))).toBe(false);
    expect(f.calls.some((c) => new URL(c.url).searchParams.has('relations'))).toBe(false);
  });

  test('reads every blueprint with the filter, and a blueprint with its own filter with that one instead', async () => {
    const f = hub();
    const program = { relation: 'program', target: 'program:42' };
    const held = { relation: '<-k8s-deployment:namespace', where: program };
    await drain(orreryConnector.discover(testContext({ ...config, filter: program, filters: { 'k8s-namespace': held } }, f.fetch, { 'orrery-token': 't' })));
    const asked = (bp: string) => f.calls.filter((c) => c.url.includes(`blueprint=${bp}`)).map((c) => JSON.parse(new URL(c.url).searchParams.get('filter') ?? 'null'));
    expect(asked('k8s-deployment')).toEqual([program, program]);
    expect(asked('k8s-service')).toEqual([program]);
    expect(asked('k8s-namespace')).toEqual([held]);
  });

  test('sends no filter when none is configured', async () => {
    const f = hub();
    await drain(orreryConnector.discover(testContext(config, f.fetch, { 'orrery-token': 't' })));
    expect(f.calls.some((c) => new URL(c.url).searchParams.has('filter'))).toBe(false);
  });

  test('sends the kept tag back, reuses the kept page on a 304, and keeps the new page a 200 brings', async () => {
    // A hub that tags each answer by its URL and a version, and answers 304 when the caller names the current tag.
    const f = hub();
    let version = 1;
    const asked: { url: string; tag: string | undefined }[] = [];
    const tagged: FetchLike = async (input, init) => {
      const url = String(input);
      const tag = `"${version}:${url}"`;
      const sent = (init?.headers as Record<string, string> | undefined)?.['if-none-match'];
      asked.push({ url, tag: sent });
      if (sent === tag) return new Response(null, { status: 304, headers: { etag: tag } });
      const res = await f.fetch(input, init);
      return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json', etag: tag } });
    };
    const kept = keptStore();
    const first = mergeBatches(await drain(orreryConnector.discover({ ...testContext(config, tagged, { 'orrery-token': 't' }), kept })), '2026-10-28T10:00:00Z');
    expect(asked.every((a) => a.tag === undefined)).toBe(true);
    const pages = Object.keys(kept.entries()).filter((u) => u.includes('/v1/entities'));
    expect(pages).toHaveLength(4);

    // Nothing moved: every page comes back 304 with an empty body, and the batch is the same.
    asked.length = 0;
    const again = keptStore(kept.entries());
    const ctx = { ...testContext(config, tagged, { 'orrery-token': 't' }), kept: again };
    const second = mergeBatches(await drain(orreryConnector.discover(ctx)), '2026-10-28T10:00:00Z');
    expect(asked.filter((a) => !/\/v1\/(alerts|whoami)$/.test(a.url)).every((a) => a.tag !== undefined)).toBe(true);
    expect(second).toEqual(first);
    expect(again.changed()).toBe(false);
    expect(ctx.log.records.filter((r) => r.message === 'orrery blueprint read').map((r) => r.fields['kept'])).toEqual([1, 2, 1]);

    // The hub moved: the 200 brings a new page and its tag, which replace the kept ones.
    version = 2;
    const moved = keptStore(again.entries());
    const deployment0 = pages.find((u) => u.includes('k8s-deployment') && u.includes('offset=0'))!;
    const bumped = { ...(moved.get(deployment0) as { body: { entities: { title: string }[] } }).body };
    bumped.entities = bumped.entities.map((e, i) => (i === 0 ? { ...e, title: 'Relay v2' } : e));
    const fresh: FetchLike = async (input, init) => {
      const res = await tagged(input, init);
      if (String(input) !== deployment0 || res.status !== 200) return res;
      return new Response(JSON.stringify(bumped), { status: 200, headers: { 'content-type': 'application/json', etag: res.headers.get('etag')! } });
    };
    const third = mergeBatches(await drain(orreryConnector.discover({ ...testContext(config, fresh, { 'orrery-token': 't' }), kept: moved })), '2026-10-28T10:00:00Z');
    expect(third.entities.find((e) => e.id === 'k8s-deployment:relay/relay')?.name).toBe('Relay v2');
    expect(moved.changed()).toBe(true);
    expect(moved.get(deployment0)).toMatchObject({ etag: `"2:${deployment0}"`, body: { entities: [{ title: 'Relay v2' }, {}] } });
  });

  test('tries a list of containment relations in order', async () => {
    const ctx = testContext({ ...config, parentRelation: { 'k8s-deployment': ['vm', 'namespace'] } }, hub().fetch, { 'orrery-token': 't' });
    const all = mergeBatches(await drain(orreryConnector.discover(ctx)), '2026-10-28T10:00:00Z');
    expect(all.entities.find((e) => e.id === 'k8s-deployment:relay/relay')?.parent).toBe('k8s-namespace:relay');
  });

  test('runConnector folds the slices into one full batch and logs start and end with counts', async () => {
    const ctx = testContext<unknown>({ ...config, blueprints: ['k8s-service'] }, hub().fetch, { 'orrery-token': 't' });
    const run = await runConnector(orreryConnector, ctx, 'catalog');
    expect(run.slices).toBe(1);
    expect(run.batch.source).toBe('catalog');
    expect(run.batch.partial).toBeUndefined();
    expect(run.batch.entities).toHaveLength(1);
    const end = ctx.log.records.find((r) => r.message === 'connector run end');
    expect(end?.fields).toMatchObject({ connector: 'orrery', entities: 1, relations: 1, slices: 1 });
    expect(ctx.log.records[0]?.message).toBe('connector run start');
  });

  test('rejects an invalid config before any request', async () => {
    const f = hub();
    const ctx = testContext<unknown>({ url: 'not a url' }, f.fetch);
    await expect(runConnector(orreryConnector, ctx, 'x')).rejects.toThrow('config invalid');
    expect(f.calls).toHaveLength(0);
  });

  test('reports firing alerts as open items on the entity each is attached to', async () => {
    const f = hub(true);
    const ctx = testContext(config, f.fetch, { 'orrery-token': 't' });
    const all = mergeBatches(await drain(orreryConnector.discover(ctx)), '2026-10-28T10:00:00Z');
    const relay = all.entities.find((e) => e.id === 'k8s-deployment:relay/relay');
    expect(relay?.items).toEqual([
      { id: 'a1f0c2', kind: 'alert', title: 'Relay has no ready replicas', url: 'https://runbooks.example.test/relay-down', severity: 'critical', status: 'firing', updated: '2026-10-28T09:55:00.000Z' },
    ]);
    const service = all.entities.find((e) => e.id === 'k8s-service:relay/relay');
    expect(service?.items).toEqual([
      { id: 'b2e1d3', kind: 'alert', title: 'RelayLatencyHigh', url: 'https://web.example.test/entities/k8s-service/relay/relay', severity: 'medium', status: 'firing', updated: '2026-10-28T09:50:00.000Z' },
    ]);
    expect(all.entities.filter((e) => e.items).length).toBe(2);
    expect(f.calls.filter((c) => c.url.endsWith('/v1/alerts'))).toHaveLength(1);
    expect(ctx.log.records.find((r) => r.message === 'orrery alerts read')?.fields).toMatchObject({ alerts: 4, attached: 2, entities: 2 });
  });

  test('reads no alerts when the config turns them off, and carries on when the hub has no alerts endpoint', async () => {
    const off = hub(true);
    await drain(orreryConnector.discover(testContext({ ...config, alerts: false }, off.fetch, { 'orrery-token': 't' })));
    expect(off.calls.some((c) => c.url.includes('/v1/alerts'))).toBe(false);
    const old = hub(false);
    const ctx = testContext(config, old.fetch, { 'orrery-token': 't' });
    const batches = await drain(orreryConnector.discover(ctx));
    expect(batches.flatMap((b) => b.entities).some((e) => e.items)).toBe(false);
    expect(ctx.log.records.some((r) => r.message === 'orrery alerts unavailable' && r.level === 'warn')).toBe(true);
  });

  test('reads alert severity labels the way the Orrery hub does', () => {
    expect(['critical', 'page', 'sev1', 'error', 'warning', 'info', 'whatever', undefined].map(alertSeverity)).toEqual(['critical', 'critical', 'critical', 'high', 'medium', 'info', 'low', 'low']);
  });

  describe('an estate with an edge blueprint', () => {
    const estate = () =>
      fixtureFetch(dir, [
        { match: '/v1/blueprints/azure_app_service', file: 'estate-blueprint-azure_app_service.json' },
        { match: '/v1/blueprints/sw_connection', file: 'estate-blueprint-sw_connection.json' },
        { match: /\/v1\/blueprints$/, file: 'estate-blueprints.json' },
        { match: 'blueprint=azure_app_service', file: 'estate-entities-azure_app_service.json' },
        { match: 'blueprint=azure_database', file: 'estate-entities-azure_database.json' },
        { match: 'blueprint=sw_connection', file: 'estate-entities-sw_connection.json' },
        { match: 'blueprint=service', json: { entities: [], total: 0, limit: 200, offset: 0 } },
      ]);
    const estateConfig = OrreryConfigSchema.parse({
      url: 'https://hub.example.test',
      token: 'orrery-token',
      alerts: false,
      parentRelation: 'resource_group',
      relationKinds: { sw_connection: 'data' },
      subtitle: { azure_app_service: 'app_name', azure_database: 'host' },
      facts: { azure_app_service: ['cost_last_month_cents', 'always_on'], sw_connection: ['evidence', 'setting_names', 'calls_7d'] },
      edges: { sw_connection: { from: ['app', 'gateway', 'service'], to: ['to_database', 'to_app'], label: 'kind', health: 'health', unresolved: 'host' } },
    });
    const read = async (f = estate()) => mergeBatches(await drain(orreryConnector.discover(testContext(estateConfig, f.fetch, { 'orrery-token': 't' }))), '2026-10-28T10:00:00Z');
    const auth = 'azure_app_service:/subscriptions/0000/resourcegroups/rg-shop-prod/providers/microsoft.web/sites/shop-auth-prod';

    test('draws an edge blueprint as folded arrows and unresolved stubs, never as boxes', async () => {
      const all = await read();
      expect(all.entities.some((e) => e.type === 'sw_connection')).toBe(false);
      expect(all.entities.filter((e) => e.type === 'unresolved').map((e) => e.name).sort()).toEqual(['kv-shop.vault.example.net', 'legacy.example.net']);
      const arrows = all.relations.filter((r) => r.tags?.includes('sw_connection'));
      expect(arrows).toHaveLength(4);
      expect(arrows.find((r) => r.from === auth)).toMatchObject({ label: 'sql', kind: 'data', description: 'Evidence: setting, telemetry. Setting names: SQL_CONNECTION. Calls in 7 days: 2,043.' });
    });

    test('shows the subtitle field instead of the key, and facts by the hub titles and formats', async () => {
      const all = await read();
      const app = all.entities.find((e) => e.id === auth);
      expect(app).toMatchObject({ subtitle: 'shop-auth-prod', facts: { cost_last_month_cents: 115207, always_on: true } });
      expect(app?.display).toEqual([
        { fact: 'cost_last_month_cents', label: 'Cost last month', value: '$1,152' },
        { fact: 'always_on', label: 'Always on', value: 'yes' },
      ]);
      const database = all.entities.find((e) => e.type === 'azure_database');
      expect(database?.subtitle).toBe('shop-sql.database.example.net');
      expect(database?.display).toEqual([{ fact: 'host', label: 'Host', value: 'shop-sql.database.example.net' }]);
    });

    test('asks for the subtitle and the fields an edge reads beside the kept facts, and each blueprint definition once', async () => {
      const f = estate();
      await read(f);
      const fields = (bp: string) => f.calls.filter((c) => c.url.includes(`blueprint=${bp}`)).map((c) => new URL(c.url).searchParams.get('fields'));
      expect(fields('azure_app_service')).toEqual(['cost_last_month_cents,always_on,app_name']);
      expect(fields('sw_connection')).toEqual(['evidence,setting_names,calls_7d,kind,health,host']);
      expect(fields('azure_database')).toEqual([null]);
      expect(f.calls.filter((c) => /\/v1\/blueprints\/[a-z_]+$/.test(c.url)).map((c) => c.url.split('/').pop())).toEqual(['azure_app_service', 'azure_database', 'service', 'sw_connection']);
    });

    test('keeps every field by its name in words when the hub does not describe the blueprint', async () => {
      const f = estate();
      const ctx = testContext(estateConfig, f.fetch, { 'orrery-token': 't' });
      const all = mergeBatches(await drain(orreryConnector.discover(ctx)), '2026-10-28T10:00:00Z');
      expect(all.entities.find((e) => e.type === 'azure_database')?.display).toEqual([{ fact: 'host', label: 'Host', value: 'shop-sql.database.example.net' }]);
      expect(ctx.log.records.filter((r) => r.message === 'orrery blueprint undescribed').map((r) => r.fields['blueprint'])).toEqual(['azure_database', 'service']);
      expect(ctx.log.records.find((r) => r.message === 'orrery edges folded')?.fields).toMatchObject({ blueprint: 'sw_connection', records: 7, arrows: 4, unresolved: 2, skipped: 2 });
    });
  });
});

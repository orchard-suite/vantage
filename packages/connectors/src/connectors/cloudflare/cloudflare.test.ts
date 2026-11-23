import { describe, expect, test } from 'bun:test';
import { mergeBatches } from '../../batch.ts';
import { drain, fixtureFetch, testContext } from '../../testing.ts';
import { cloudflareConnector, CloudflareConfigSchema } from './cloudflare.ts';

const dir = `${import.meta.dir}/fixtures`;
const ACCOUNT = '0123456789abcdef0123456789abcdef';

function api() {
  return fixtureFetch(dir, [
    { match: /\/zones\?/, file: 'zones.json' },
    { match: /z1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6\/dns_records\?page=1/, file: 'dns-records-1.json' },
    { match: /z1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6\/dns_records\?page=2/, file: 'dns-records-2.json' },
    { match: /z9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4\/dns_records/, file: 'dns-records-empty.json' },
    { match: '/cfd_tunnel', file: 'tunnels.json' },
    { match: '/access/apps', file: 'access-apps.json' },
  ]);
}

const config = CloudflareConfigSchema.parse({ token: 'cf-token', accountId: ACCOUNT, accountName: 'Home', pageSize: 2 });

describe('cloudflare connector', () => {
  test('authenticates with the token and pages through records', async () => {
    const f = api();
    const ctx = testContext(config, f.fetch, { 'cf-token': 'cf-secret' });
    const batches = await drain(cloudflareConnector.discover(ctx));
    expect(batches).toHaveLength(4);
    expect(f.calls.every((c) => c.headers.authorization === 'Bearer cf-secret')).toBe(true);
    const recordPages = f.calls.filter((c) => c.url.includes('z1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6/dns_records'));
    expect(recordPages.map((c) => new URL(c.url).searchParams.get('page'))).toEqual(['1', '2']);
    expect(new URL(f.calls[0]?.url ?? '').searchParams.get('account.id')).toBe(ACCOUNT);
  });

  test('produces account, zones, records, tunnels, and access apps with containment', async () => {
    const ctx = testContext(config, api().fetch, { 'cf-token': 't' });
    const all = mergeBatches(await drain(cloudflareConnector.discover(ctx)), '2026-10-28T10:00:00Z');
    const byId = new Map(all.entities.map((e) => [e.id, e]));
    expect(byId.get(`account:${ACCOUNT}`)?.name).toBe('Home');
    expect(byId.get('zone:z1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6')).toMatchObject({ type: 'zone', name: 'example.test', parent: `account:${ACCOUNT}`, facts: { status: 'active', plan: 'Free Website' } });
    expect(byId.get('dns-record:r0000000000000000000000000000001')).toMatchObject({ type: 'dns-record', parent: 'zone:z1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6', tags: ['dns-record', 'cname'], facts: { type: 'CNAME', proxied: true, comment: 'relay via tunnel' } });
    expect(byId.get('tunnel:7c9e6679-7425-40de-944b-e07fc1f90ae7')).toMatchObject({ type: 'tunnel', name: 'edge-ingress', facts: { status: 'healthy', connections: 2, colos: ['AMS'] } });
    expect(byId.get('access-app:a1000000-0000-4000-8000-000000000001')).toMatchObject({ type: 'access-application', subtitle: 'relay.example.test' });
    expect(all.entities.filter((e) => e.type === 'dns-record')).toHaveLength(3);
  });

  test('relates CNAME records to tunnels and access apps to the records they protect', async () => {
    const ctx = testContext(config, api().fetch, { 'cf-token': 't' });
    const all = mergeBatches(await drain(cloudflareConnector.discover(ctx)), '2026-10-28T10:00:00Z');
    expect(all.relations).toEqual([
      { from: 'dns-record:r0000000000000000000000000000001', to: 'tunnel:7c9e6679-7425-40de-944b-e07fc1f90ae7', label: 'points to', kind: 'sync', tags: ['tunnel'] },
      { from: 'access-app:a1000000-0000-4000-8000-000000000001', to: 'dns-record:r0000000000000000000000000000001', label: 'protects', kind: 'auth', tags: ['access'] },
    ]);
  });

  test('filters zones by name when configured', async () => {
    const f = api();
    const ctx = testContext({ ...config, zones: ['other.test'] }, f.fetch, { 'cf-token': 't' });
    const all = mergeBatches(await drain(cloudflareConnector.discover(ctx)), '2026-10-28T10:00:00Z');
    expect(all.entities.filter((e) => e.type === 'zone').map((e) => e.name)).toEqual(['other.test']);
    expect(f.calls.some((c) => c.url.includes('z1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6'))).toBe(false);
  });

  test('surfaces an API error envelope as a thrown error', async () => {
    const f = fixtureFetch(dir, [{ match: '/zones', file: 'error.json' }]);
    const ctx = testContext(config, f.fetch, { 'cf-token': 't' });
    await expect(drain(cloudflareConnector.discover(ctx))).rejects.toThrow('10000 Authentication error');
  });
});

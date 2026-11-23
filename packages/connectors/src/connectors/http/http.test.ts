import { describe, expect, test } from 'bun:test';
import { mergeBatches } from '../../batch.ts';
import { drain, fixtureFetch, testContext } from '../../testing.ts';
import { httpConnector, HttpConfigSchema, resolveHeaders, select } from './http.ts';

const dir = `${import.meta.dir}/fixtures`;

const catalog = HttpConfigSchema.parse({
  url: 'https://catalog.example.test/api/services',
  headers: { authorization: 'Bearer {{secret:catalog-token}}', 'x-tenant': 'home' },
  jsonPath: '$.data',
  paging: { next: '$.next' },
  entity: {
    id: 'service:{{id}}',
    type: '{{kind}}',
    name: '{{name}}',
    parent: 'team:{{team}}',
    subtitle: '{{runtime.language}} {{runtime.version}}',
    url: '{{links.docs}}',
    tags: ['{{team}}', '{{missing}}'],
    facts: { Language: 'runtime.language', Owner: '{{owner}}', Runtime: '{{runtime.language}} {{runtime.version}}', Deps: 'dependencies' },
  },
  relations: [{ items: '$.dependencies[*]', from: 'service:{{item.id}}', to: 'service:{{rel.id}}', label: 'calls', kind: 'sync' }],
});

describe('http connector', () => {
  test('resolves secret refs in headers, selects items by JSONPath, follows paging, and templates entities', async () => {
    const f = fixtureFetch(dir, [
      { match: 'page=2', file: 'services-2.json' },
      { match: '/api/services', file: 'services-1.json' },
    ]);
    const ctx = testContext(catalog, f.fetch, { 'catalog-token': 'tok-123' });
    const batches = await drain(httpConnector.discover(ctx));
    expect(f.calls.map((c) => c.url)).toEqual(['https://catalog.example.test/api/services', 'https://catalog.example.test/api/services?page=2']);
    expect(f.calls[0]?.headers).toMatchObject({ authorization: 'Bearer tok-123', 'x-tenant': 'home', accept: 'application/json' });
    expect(f.calls[0]?.method).toBe('GET');
    const all = mergeBatches(batches, '2026-10-28T10:00:00Z');
    expect(all.entities.map((e) => e.id)).toEqual(['service:svc-001', 'service:svc-002', 'service:svc-003']);
    const checkout = all.entities[0];
    expect(checkout).toMatchObject({ type: 'api', name: 'Checkout', parent: 'team:payments', subtitle: 'go 1.23', url: 'https://docs.example.test/checkout', tags: ['payments'] });
    expect(checkout?.facts).toEqual({ Language: 'go', Owner: 'team-payments', Runtime: 'go 1.23', Deps: [{ id: 'svc-002', via: 'grpc' }, { id: 'svc-003', via: 'http' }] });
    expect(all.entities[1]?.url).toBeUndefined();
    expect(ctx.log.records.filter((r) => r.message === 'http item skipped')).toHaveLength(1);
  });

  test('builds relations from sub items', async () => {
    const f = fixtureFetch(dir, [
      { match: 'page=2', file: 'services-2.json' },
      { match: '/api/services', file: 'services-1.json' },
    ]);
    const all = mergeBatches(await drain(httpConnector.discover(testContext(catalog, f.fetch, { 'catalog-token': 't' }))), '2026-10-28T10:00:00Z');
    expect(all.relations).toEqual([
      { from: 'service:svc-001', to: 'service:svc-002', label: 'calls', kind: 'sync' },
      { from: 'service:svc-001', to: 'service:svc-003', label: 'calls', kind: 'sync' },
      { from: 'service:svc-003', to: 'service:svc-002', label: 'calls', kind: 'sync' },
    ]);
  });

  test('posts a GraphQL query and reads items from the data path', async () => {
    const f = fixtureFetch(dir, [{ match: '/graphql', file: 'graphql.json' }]);
    const config = HttpConfigSchema.parse({
      url: 'https://git.example.test/graphql',
      headers: { authorization: 'token {{secret:git}}' },
      graphql: { query: 'query($org: String!) { organization(login: $org) { repositories(first: 100) { nodes { name url primaryLanguage { name } isArchived stargazerCount } } } }', variables: { org: 'org' }, path: '$.data.organization.repositories.nodes' },
      entity: { id: 'repo:{{name}}', type: 'repository', name: '{{name}}', url: '{{url}}', facts: { Language: 'primaryLanguage.name', Archived: 'isArchived', Stars: 'stargazerCount' } },
    });
    const all = mergeBatches(await drain(httpConnector.discover(testContext(config, f.fetch, { git: 'g' }))), '2026-10-28T10:00:00Z');
    expect(f.calls[0]?.method).toBe('POST');
    const body = JSON.parse(f.calls[0]?.body ?? '{}') as { query: string; variables: Record<string, string> };
    expect(body.variables).toEqual({ org: 'org' });
    expect(body.query).toContain('repositories');
    expect(all.entities).toHaveLength(2);
    expect(all.entities[0]?.facts).toEqual({ Language: 'TypeScript', Archived: false, Stars: 12 });
    expect(all.entities[1]?.facts).toEqual({ Archived: true, Stars: 0 });
  });

  test('without a path a top-level array is the item list and an object is one item', () => {
    expect(select([1, 2], undefined)).toEqual([1, 2]);
    expect(select({ a: 1 }, undefined)).toEqual([{ a: 1 }]);
    expect(select({ data: [{ x: 1 }] }, '$.data')).toEqual([{ x: 1 }]);
    expect(select({ data: [{ x: 1 }, { x: 2 }] }, '$.data[*].x')).toEqual([1, 2]);
  });

  test('resolveHeaders leaves plain values alone and resolves each ref once', async () => {
    const asked: string[] = [];
    const out = await resolveHeaders({ a: 'Bearer {{secret:one}}', b: '{{secret:one}}-{{ secret:two }}', c: 'plain' }, async (ref) => {
      asked.push(ref);
      return `v-${ref}`;
    });
    expect(out).toEqual({ a: 'Bearer v-one', b: 'v-one-v-two', c: 'plain' });
    expect(asked.sort()).toEqual(['one', 'two']);
  });
});

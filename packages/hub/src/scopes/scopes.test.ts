/** A workspace names its owner scope, and the hub keeps the scope tree: kept in the hub, or read from the catalog (VAN-3017). */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { memoryLogger, orreryConnector, OrreryConfigSchema, type Batch, type FetchLike } from '@vantage/connectors';
import { testApp, type TestApp } from '../testing.ts';
import { agent, type Agent } from '../mcp/testing.ts';
import { ingestBatch } from '../sources/ingest.ts';
import { connectorIn } from '../sources/repo.ts';
import { workspaceBySlug } from '../authz.ts';

const TREE = `source: hub
scopes:
  - id: acme
    name: Acme
    kind: organization
  - id: payments
    name: Payments
    kind: department
    parent: acme
    steward: ada@example.com
    facets: [moves-money]
  - id: checkout
    name: Checkout
    kind: team
    parent: payments
workspaces: {}
`;

describe('scopes kept in the hub', () => {
  let t: TestApp;
  let admin: Agent;
  let author: Agent;
  beforeAll(async () => {
    t = await testApp();
    admin = await agent(t, (await t.bearer('ada', { admin: true })).headers);
    author = await agent(t, (await t.bearer('bob')).headers);
    await author.call('vantage_tool', { tool: 'vantage_workspaces', arguments: { action: 'create', name: 'Beacon' } });
  });
  afterAll(async () => {
    await t.ctx.db.close();
  });

  test('a workspace with no scope belongs to the whole estate, and an empty tree is kept in the hub', async () => {
    expect(await author.call('vantage_outline', { address: 'beacon' })).toContain('scope: none, so the whole estate');
    const tree = await author.call('vantage_read', { addresses: ['scopes'] });
    expect(tree).toContain('source: hub');
    expect(tree).toContain('scopes: []');
    expect(await author.call('vantage_outline', { address: 'scopes' })).toContain('scopes: 0 scopes, kept in the hub');
  });

  test('an admin writes the tree; an author may not', async () => {
    expect((await author.attempt('vantage_write', { writes: [{ address: 'scopes', text: TREE }] })).text).toContain('only an admin changes the scope tree');
    expect(await admin.call('vantage_write', { writes: [{ address: 'scopes', text: TREE }] })).toContain('scopes: 3 added, 0 changed, 0 removed');
    const outline = await author.call('vantage_outline', { address: 'scopes' });
    expect(outline).toContain('\n  acme  Acme  organization');
    expect(outline).toContain('\n    payments  Payments  department  steward ada@example.com; facets moves-money');
    expect(outline).toContain('\n      checkout  Checkout  team');
    expect(await author.call('vantage_read', { addresses: ['scopes#scopes.payments'] })).toContain('steward: ada@example.com');
  });

  test('a tree that does not hold together is refused', async () => {
    expect((await admin.attempt('vantage_patch', { edits: [{ address: 'scopes', old: '    parent: acme', new: '    parent: nowhere' }] })).text).toContain('scope payments names parent nowhere, which is not in the tree');
    expect((await admin.attempt('vantage_patch', { edits: [{ address: 'scopes', old: 'kind: organization', new: 'kind: organization\n    parent: checkout' }] })).text).toContain('is its own ancestor');
  });

  test("the workspace's owner sets its scope with a patch, and its outline names the scopes above it", async () => {
    expect(await author.call('vantage_patch', { edits: [{ address: 'scopes', old: 'workspaces: {}', new: 'workspaces:\n  beacon: checkout' }] })).toContain('beacon belongs to checkout');
    expect(await author.call('vantage_outline', { address: 'beacon' })).toContain('scope: checkout (team) < payments (department) < acme (organization)');
    expect(await author.call('vantage_outline', { address: 'scopes' })).toContain('checkout  Checkout  team  workspaces beacon');
    const outsider = await agent(t, (await t.bearer('cy')).headers);
    expect((await outsider.attempt('vantage_patch', { edits: [{ address: 'scopes', old: 'workspaces: {}', new: 'workspaces:\n  beacon: acme' }] })).text).toContain('workspace not found');
  });

  test('a removed scope leaves its workspace to the whole estate', async () => {
    const text = TREE.replace(/  - id: checkout[\s\S]*?parent: payments\n/, '');
    expect(await admin.call('vantage_write', { writes: [{ address: 'scopes', text }] })).toContain('1 removed');
    expect(await author.call('vantage_outline', { address: 'beacon' })).toContain('scope: none, so the whole estate');
  });

  test('REST reads the tree and sets one workspace', async () => {
    const author = await t.bearer('bob');
    expect((await t.json('/api/v1/workspaces/beacon/scope', { method: 'PUT', headers: author.headers, body: JSON.stringify({ scope: 'payments' }) })).body['status']).toBe('saved');
    const got = await t.json('/api/v1/scopes', { headers: author.headers });
    expect(got.body).toMatchObject({ source: 'hub', workspaces: { beacon: 'payments' } });
    expect((got.body['scopes'] as { id: string }[]).map((s) => s.id)).toEqual(['acme', 'payments']);
  });
});

/** A catalog hub as the Orrery connector reads it: the core kinds, one service that is not a scope, and who leads each. */
function catalog(teamTitle: string): FetchLike {
  const ref = (blueprint: string, key: string) => [{ blueprint, key }];
  const entities: Record<string, unknown[]> = {
    organization: [{ blueprint: 'organization', key: 'acme', title: 'Acme', state: 'ok', fields: {}, relations: {} }],
    department: [{ blueprint: 'department', key: 'payments', title: 'Payments', state: 'ok', fields: { facets: ['moves-money'] }, relations: { organization: ref('organization', 'acme'), head: ref('person', 'ada@example.com') } }],
    team: [{ blueprint: 'team', key: 'checkout', title: teamTitle, state: 'ok', fields: {}, relations: { department: ref('department', 'payments'), lead: ref('person', 'bob@example.com') } }],
    program: [{ blueprint: 'program', key: 'beacon', title: 'Beacon', state: 'ok', fields: {}, relations: { team: ref('team', 'checkout') } }],
    sw_service: [{ blueprint: 'sw_service', key: 'beacon-api', title: 'Beacon API', state: 'ok', fields: {}, relations: { program: ref('program', 'beacon') } }],
  };
  return async (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/v1/whoami') return json({ web: 'https://catalog.example.com' });
    if (url.pathname.startsWith('/v1/blueprints/')) return json({ fields: {} });
    const list = entities[url.searchParams.get('blueprint') ?? ''] ?? [];
    return json({ entities: list, total: list.length, limit: 200, offset: 0 });
  };
}

const CONFIG = OrreryConfigSchema.parse({
  url: 'https://catalog.example.com',
  token: 'catalog-token',
  blueprints: ['organization', 'department', 'team', 'program', 'sw_service'],
  parentRelation: { department: 'organization', team: ['parent', 'department'], program: ['parent', 'team'], sw_service: 'program' },
  alerts: false,
});

const SETTING = `source: catalog
catalog:
  connector: platform/catalog
  steward: { department: head, team: lead, program: team }
`;

describe('scopes read from the catalog', () => {
  let t: TestApp;
  let admin: Agent;
  let org = '';
  const read = async (teamTitle: string): Promise<Batch[]> => {
    const out: Batch[] = [];
    const ctx = { config: CONFIG, secrets: async () => 'test-token', log: memoryLogger(), now: () => new Date('2026-11-01T00:00:00Z'), signal: new AbortController().signal, fetch: catalog(teamTitle) };
    for await (const b of orreryConnector.discover(ctx)) out.push(b);
    return out;
  };
  const ingest = async (teamTitle: string): Promise<void> => {
    const ws = (await workspaceBySlug(t.ctx.db, org, 'platform'))!;
    const source = (await connectorIn(t.ctx.db, ws.id, 'catalog'))!;
    for (const batch of await read(teamTitle)) await ingestBatch(t.ctx, { source, batch, trigger: 'push', startedAt: new Date(), jobId: null, who: 'test' });
  };
  beforeAll(async () => {
    t = await testApp();
    const me = await t.bearer('ada', { admin: true });
    org = me.principal.orgId;
    admin = await agent(t, me.headers);
    await admin.call('vantage_tool', { tool: 'vantage_workspaces', arguments: { action: 'create', name: 'Platform' } });
    await admin.call('vantage_tool', { tool: 'vantage_workspaces', arguments: { action: 'create', name: 'Beacon' } });
    expect((await t.json('/api/v1/workspaces/platform/connectors', { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'Catalog', slug: 'catalog', connector: 'push', clientId: 'client-catalog' }) })).status).toBe(201);
  });
  afterAll(async () => {
    await t.ctx.db.close();
  });

  test('naming the catalog fills the tree from the core kinds, with parents, stewards, and facets', async () => {
    await ingest('Checkout');
    expect(await admin.call('vantage_write', { writes: [{ address: 'scopes', text: SETTING }] })).toContain('the tree now comes from platform/catalog: 4 scopes');
    const outline = await admin.call('vantage_outline', { address: 'scopes' });
    expect(outline).toContain('scopes: 4 scopes, read from the catalog (platform/catalog); edits to the tree are refused');
    expect(outline).toContain('\n  organization:acme  Acme  organization');
    expect(outline).toContain('\n    department:payments  Payments  department  steward person:ada@example.com; facets moves-money');
    expect(outline).toContain('\n      team:checkout  Checkout  team  steward person:bob@example.com');
    expect(outline).toContain('\n        program:beacon  Beacon  program  steward team:checkout');
    expect(outline).not.toContain('sw_service');
    expect(await admin.call('vantage_read', { addresses: ['scopes#scopes.team:checkout'] })).toContain('url: https://catalog.example.com/entities/team/checkout');
  });

  test('the hub refuses an edit to the copy, and still takes a workspace scope', async () => {
    expect((await admin.attempt('vantage_patch', { edits: [{ address: 'scopes', old: 'name: Checkout', new: 'name: Tills' }] })).text).toContain('the hub refuses edits to its copy');
    expect(await admin.call('vantage_patch', { edits: [{ address: 'scopes', op: 'set', path: 'workspaces.beacon', value: 'program:beacon' }] })).toContain('beacon belongs to program:beacon');
    expect(await admin.call('vantage_outline', { address: 'beacon' })).toContain('scope: program:beacon (program) < team:checkout (team) < department:payments (department) < organization:acme (organization)');
  });

  test("the connector's next run moves the copy with the catalog", async () => {
    await ingest('Tills');
    expect(await admin.call('vantage_outline', { address: 'scopes' })).toContain('team:checkout  Tills  team');
    expect(await admin.call('vantage_outline', { address: 'beacon' })).toContain('scope: program:beacon');
  });

  test('leaving the catalog keeps its copy for authors to keep', async () => {
    expect((await admin.attempt('vantage_patch', { edits: [{ address: 'scopes', old: 'source: catalog', new: 'source: hub' }] })).text).toContain('catalog: is for source: catalog');
    const text = (await admin.call('vantage_read', { addresses: ['scopes'] })).replace(/^=== .*\n/, '').replace(/catalog:\n(  .*\n)+/, '').replace('source: catalog', 'source: hub');
    expect(await admin.call('vantage_write', { writes: [{ address: 'scopes', text }] })).toContain('the tree is kept in the hub now');
    expect(await admin.call('vantage_patch', { edits: [{ address: 'scopes', old: 'name: Tills', new: 'name: Checkout' }] })).toContain('1 changed');
  });
});

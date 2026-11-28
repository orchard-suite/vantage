/** A scope carries its profile, kept in the hub or read from the catalog, and an empty field shows its nearest ancestor's (VAN-3017). */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { memoryLogger, orreryConnector, OrreryConfigSchema, type FetchLike } from '@vantage/connectors';
import { testApp, type TestApp } from '../testing.ts';
import { agent, type Agent } from '../mcp/testing.ts';
import { ingestBatch } from '../sources/ingest.ts';
import { connectorIn } from '../sources/repo.ts';
import { workspaceBySlug } from '../authz.ts';

const TREE = `source: hub
profile: [description, mission]
scopes:
  - id: acme
    name: Acme
    kind: organization
    profile:
      description: Acme sells tools.
      mission: Every tool works the first time.
  - id: payments
    name: Payments
    kind: department
    parent: acme
    profile:
      description: Payments moves money in and out.
  - id: checkout
    name: Checkout
    kind: team
    parent: payments
workspaces:
  beacon: checkout
`;

describe('a profile kept in the hub', () => {
  let t: TestApp;
  let admin: Agent;
  let author: Agent;
  let headers: Record<string, string> = {};
  beforeAll(async () => {
    t = await testApp();
    const me = await t.bearer('ada', { admin: true });
    headers = me.headers;
    admin = await agent(t, me.headers);
    author = await agent(t, (await t.bearer('bob')).headers);
    await admin.call('vantage_tool', { tool: 'vantage_workspaces', arguments: { action: 'create', name: 'Beacon' } });
    expect(await admin.call('vantage_write', { writes: [{ address: 'scopes', text: TREE }] })).toContain('profile fields: description, mission');
  }, 30_000);
  afterAll(async () => {
    await t.ctx.db.close();
  });

  test('a scope reads its own fields, and an empty one shows the nearest ancestor that states it', async () => {
    const checkout = await admin.call('vantage_read', { addresses: ['scopes/checkout'] });
    expect(checkout).toContain('scope: checkout\nname: Checkout\nkind: team\nabove:\n  - payments\n  - acme\n');
    expect(checkout).toContain('workspaces:\n  - beacon\n');
    expect(checkout).toContain('## Description\n\nPayments moves money in and out.\n\nInherited from payments.\n');
    expect(checkout).toContain('## Mission\n\nEvery tool works the first time.\n\nInherited from acme.\n');
    const payments = await author.call('vantage_read', { addresses: ['scopes/payments#description'] });
    expect(payments).toContain('Payments moves money in and out.');
    expect(payments).not.toContain('Inherited');
    expect(await author.call('vantage_outline', { address: 'scopes/checkout' })).toContain('profile: description (from payments, 32 chars), mission (from acme, 32 chars)');
  });

  test("the workspace's outline and page show its scope's profile", async () => {
    expect(await admin.call('vantage_outline', { address: 'beacon' })).toContain('profile: description (from payments, 32 chars), mission (from acme, 32 chars); vantage_read scopes/checkout');
    const page = await t.app.request('/w/beacon', { headers });
    const html = await page.text();
    expect(html).toContain('Belongs to <b>Checkout</b>, a team in Payments, in Acme');
    expect(html).toContain('<dt>Mission</dt><dd>Every tool works the first time.<span class="inherited">Inherited from Acme</span></dd>');
  });

  test('a field the estate does not name is refused, only an admin names the fields, and a scope address is read-only', async () => {
    expect((await admin.attempt('vantage_patch', { edits: [{ address: 'scopes', old: '      description: Payments moves money in and out.', new: '      description: Payments moves money in and out.\n      north_star: Paid on time.' }] })).text).toContain('scope payments states profile field north_star, which the estate does not name');
    expect((await author.attempt('vantage_patch', { edits: [{ address: 'scopes', old: '  - mission', new: '  - mission\n  - north_star' }] })).text).toContain('only an admin changes the profile fields a scope carries');
    expect((await admin.attempt('vantage_write', { writes: [{ address: 'scopes/checkout', text: '---\nscope: checkout\n---\n' }] })).text).toContain('scopes/checkout is read-only');
  });

  test('a scope that states a field gives up the inherited one', async () => {
    await admin.call('vantage_patch', { edits: [{ address: 'scopes', old: '    parent: payments\n', new: '    parent: payments\n    profile:\n      mission: Every basket checks out.\n' }] });
    const checkout = await author.call('vantage_read', { addresses: ['scopes/checkout'] });
    expect(checkout).toContain('## Mission\n\nEvery basket checks out.\n');
    expect(checkout).not.toContain('Inherited from acme');
  });
});

/** A catalog whose organization states a mission, whose department states a description, and whose team states neither. */
const catalog: FetchLike = async (input) => {
  const ref = (blueprint: string, key: string) => [{ blueprint, key }];
  const entities: Record<string, unknown[]> = {
    organization: [{ blueprint: 'organization', key: 'acme', title: 'Acme', state: 'ok', fields: { mission: 'Every tool works the first time.' }, relations: {} }],
    department: [{ blueprint: 'department', key: 'payments', title: 'Payments', state: 'ok', fields: { description: 'Payments moves money in and out.' }, relations: { organization: ref('organization', 'acme') } }],
    team: [{ blueprint: 'team', key: 'checkout', title: 'Checkout', state: 'ok', fields: {}, relations: { department: ref('department', 'payments') } }],
  };
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/v1/whoami') return json({ web: 'https://catalog.example.com' });
  if (url.pathname.startsWith('/v1/blueprints/')) return json({ fields: {} });
  const list = entities[url.searchParams.get('blueprint') ?? ''] ?? [];
  return json({ entities: list, total: list.length, limit: 200, offset: 0 });
};

const CONFIG = OrreryConfigSchema.parse({ url: 'https://catalog.example.com', token: 'catalog-token', blueprints: ['organization', 'department', 'team'], parentRelation: { department: 'organization', team: 'department' }, alerts: false });

describe('a profile read from the catalog', () => {
  let t: TestApp;
  let admin: Agent;
  beforeAll(async () => {
    t = await testApp();
    const me = await t.bearer('ada', { admin: true });
    admin = await agent(t, me.headers);
    await admin.call('vantage_tool', { tool: 'vantage_workspaces', arguments: { action: 'create', name: 'Platform' } });
    expect((await t.json('/api/v1/workspaces/platform/connectors', { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'Catalog', slug: 'catalog', connector: 'push', clientId: 'client-catalog' }) })).status).toBe(201);
    const source = (await connectorIn(t.ctx.db, (await workspaceBySlug(t.ctx.db, me.principal.orgId, 'platform'))!.id, 'catalog'))!;
    const ctx = { config: CONFIG, secrets: async () => 'test-token', log: memoryLogger(), now: () => new Date('2026-11-01T00:00:00Z'), signal: new AbortController().signal, fetch: catalog };
    for await (const batch of orreryConnector.discover(ctx)) await ingestBatch(t.ctx, { source, batch, trigger: 'push', startedAt: new Date(), jobId: null, who: 'test' });
  }, 30_000);
  afterAll(async () => {
    await t.ctx.db.close();
  });

  test('the copy keeps the fields the setting names; a field no entry has is left out; an edit to a value is refused', async () => {
    expect(await admin.call('vantage_write', { writes: [{ address: 'scopes', text: 'source: catalog\nprofile: [description, mission, north_star]\ncatalog:\n  connector: platform/catalog\n' }] })).toContain('the tree now comes from platform/catalog: 3 scopes');
    const team = await admin.call('vantage_read', { addresses: ['scopes/team:checkout'] });
    expect(team).toContain('## Description\n\nPayments moves money in and out.\n\nInherited from department:payments.');
    expect(team).toContain('## Mission\n\nEvery tool works the first time.\n\nInherited from organization:acme.');
    expect(team).not.toContain('North star');
    expect(await admin.call('vantage_read', { addresses: ['scopes#scopes.department:payments'] })).toContain('profile:\n      description: Payments moves money in and out.');
    expect((await admin.attempt('vantage_patch', { edits: [{ address: 'scopes', old: 'description: Payments moves money in and out.', new: 'description: Money.' }] })).text).toContain('the hub refuses edits to its copy');
  });

  test('a field the setting drops leaves the copy when it is read again', async () => {
    expect(await admin.call('vantage_patch', { edits: [{ address: 'scopes', old: '  - mission\n', new: '' }] })).toContain('read again from platform/catalog: 3 scopes');
    const team = await admin.call('vantage_read', { addresses: ['scopes/team:checkout'] });
    expect(team).toContain('## Description');
    expect(team).not.toContain('Mission');
  });
});

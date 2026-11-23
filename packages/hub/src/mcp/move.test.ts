import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { testApp } from '../testing.ts';

const PLAN = 'title: Shop roadmap\nkind: { prefix: PLAN, name: Shop roadmap, base: roadmap-item }\nviews: []\n';
const RECORD = '---\ntitle: Orders go through one API\nstatus: accepted\ncategory: 2\ndecided: 2026-11-01\ndeciders: [A Person]\n---\n\n## Context\n\nTwo writers drift.\n\n## Decision\n\nOne API writes orders.\n\n## Consequences\n\n### Benefits\n\nOne writer.\n\n### Costs\n\nOne hop.\n\n## Alternatives considered\n\n### Shared database\n\nTwo writers drift.\n';

describe('a program moves into a workspace of its own', () => {
  test('an agent makes the workspace, then moves the roadmap with its items and the registry with its records; the old address sends it on', async () => {
    const t = await testApp();
    const me = await t.bearer('author');
    const home = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!.slug;
    const client = new Client({ name: 'test', version: '0' });
    const fetchViaApp = (input: string | URL, init?: RequestInit): Promise<Response> => Promise.resolve(t.app.request(String(input), init));
    await client.connect(new StreamableHTTPClientTransport(new URL('http://hub.test/mcp'), { fetch: fetchViaApp, requestInit: { headers: me.headers } }));
    const call = async (name: string, args: Record<string, unknown>): Promise<string> => ((await client.callTool({ name, arguments: args })) as { content: { text: string }[] }).content[0]!.text;

    expect(await call('vantage_workspaces', { action: 'create', name: 'Shop' })).toBe('made workspace shop (Shop); you are its author');
    expect(await call('vantage_workspaces', {})).toContain('shop  Shop  (team, author)');

    await call('vantage_write', { writes: [{ address: `${home}/shop-roadmap`, text: PLAN }] });
    expect(await call('vantage_write', { writes: [{ address: 'PLAN', text: '---\ntitle: Prices answer from a cache\nlabels:\n  horizon: now\n---\n\nFast prices.\n' }] })).toContain('created PLAN-1');
    expect(await call('vantage_registries', { action: 'create', workspace: home, prefix: 'SHOP', name: 'Shop' })).toContain('created SHOP');
    expect(await call('vantage_write', { writes: [{ address: 'SHOP', text: RECORD }] })).toContain('SHOP-2001');

    expect(await call('vantage_move', { address: `${home}/shop-roadmap`, to: 'shop' })).toBe(`moved ${home}/shop-roadmap to shop/shop-roadmap; ${home}/shop-roadmap now sends people and tools there\nkind PLAN and its 1 items went with it`);
    const shop = (await t.ctx.db.query<{ id: string }>("select id from workspaces where slug = 'shop'"))[0]!.id;
    expect((await t.ctx.db.query<{ workspace_id: string }>("select workspace_id from item_kinds where prefix = 'PLAN'"))[0]!.workspace_id).toBe(shop);
    expect((await t.ctx.db.query<{ workspace_id: string }>("select workspace_id from items where key = 'PLAN-1'"))[0]!.workspace_id).toBe(shop);
    expect(await call('vantage_read', { addresses: [`${home}/shop-roadmap`] })).toContain(`moved to shop/shop-roadmap`);
    const page = await t.app.request(`/w/${home}/shop-roadmap`, { headers: me.headers });
    expect(page.status).toBe(301);
    expect(page.headers.get('location')).toBe('/w/shop/shop-roadmap');

    expect(await call('vantage_move', { address: 'SHOP', to: 'shop' })).toBe(`moved registry SHOP (1 records) from ${home} to shop; its citations are unchanged`);
    expect((await t.ctx.db.query<{ workspace_id: string }>("select workspace_id from decision_registries where prefix = 'SHOP'"))[0]!.workspace_id).toBe(shop);
    expect(await call('vantage_read', { addresses: ['SHOP-2001#decision'] })).toContain('One API writes orders.');
    const record = await t.app.request(`/w/${home}/decisions/SHOP-2001`, { headers: me.headers });
    expect(record.headers.get('location')).toBe('/w/shop/decisions/SHOP-2001');

    await client.close();
    await t.ctx.db.close();
  });

  test('a document takes a new slug in its own workspace or with a move; the old address names the new one, a rename back reclaims it, and a taken slug is refused', async () => {
    const t = await testApp();
    const me = await t.bearer('author');
    const home = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!.slug;
    const client = new Client({ name: 'test', version: '0' });
    const fetchViaApp = (input: string | URL, init?: RequestInit): Promise<Response> => Promise.resolve(t.app.request(String(input), init));
    await client.connect(new StreamableHTTPClientTransport(new URL('http://hub.test/mcp'), { fetch: fetchViaApp, requestInit: { headers: me.headers } }));
    const result = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    const call = async (name: string, args: Record<string, unknown>): Promise<string> => (await result(name, args)).content[0]!.text;
    await call('vantage_workspaces', { action: 'create', name: 'Shop' });
    await call('vantage_write', { writes: [{ address: `${home}/shop-roadmap`, text: PLAN }, { address: 'shop/billing', text: 'title: Billing\nviews: []\n' }] });

    expect(await call('vantage_move', { address: `${home}/shop-roadmap` })).toContain('name the workspace it goes to (to), a new slug (slug), or both');
    expect(await call('vantage_move', { address: `${home}/shop-roadmap`, slug: 'Shop Plan' })).toContain('Shop Plan is not a slug');

    expect(await call('vantage_move', { address: `${home}/shop-roadmap`, slug: 'shop-plan' })).toBe(`renamed ${home}/shop-roadmap to ${home}/shop-plan; ${home}/shop-roadmap now sends people and tools there`);
    expect(await call('vantage_read', { addresses: [`${home}/shop-roadmap`] })).toContain(`moved to ${home}/shop-plan`);
    expect(await call('vantage_move', { address: `${home}/shop-plan`, slug: 'shop-roadmap' })).toBe(`renamed ${home}/shop-plan to ${home}/shop-roadmap; ${home}/shop-plan now sends people and tools there`);
    expect(await call('vantage_read', { addresses: [`${home}/shop-roadmap`] })).toContain('Shop roadmap');

    expect(await call('vantage_move', { address: `${home}/shop-roadmap`, to: 'shop', slug: 'roadmap' })).toBe(`moved ${home}/shop-roadmap to shop/roadmap; ${home}/shop-roadmap now sends people and tools there\nkind PLAN and its 0 items went with it`);
    expect(await call('vantage_read', { addresses: [`${home}/shop-plan`] })).toContain('moved to shop/roadmap');
    const page = await t.app.request(`/w/${home}/shop-roadmap`, { headers: me.headers });
    expect(page.headers.get('location')).toBe('/w/shop/roadmap');

    const taken = await result('vantage_move', { address: 'shop/roadmap', slug: 'billing' });
    expect(taken.isError).toBe(true);
    expect(taken.content[0]!.text).toContain('Shop already has a diagram at billing');
    expect(await call('vantage_move', { address: 'SHOP', slug: 'x' })).toContain('to is required to move a registry');

    await client.close();
    await t.ctx.db.close();
  });
});

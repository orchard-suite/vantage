/** An agent acts as itself for a person (VAN-2009): its sign-in names it, its events record it, and its person can end it. */
import { describe, expect, test } from 'bun:test';
import { testApp, type TestApp } from '../testing.ts';
import { sealSession } from './session.ts';
import { agent } from '../mcp/testing.ts';

const WORK = `title: Shop work
kind: { prefix: SW, name: Shop work, base: work-item }
views: []
`;

/** Signs a device in through the flow the bridge uses, approved in the person's browser. */
async function deviceToken(t: TestApp, userId: string, ask: Record<string, string>): Promise<string> {
  const start = await t.json('/auth/device', { method: 'POST', body: JSON.stringify(ask) });
  const cookie = `vantage_session=${await sealSession(t.ctx.config.SESSION_SECRET, userId)}`;
  expect((await t.app.request('/auth/device/approve', { method: 'POST', headers: { cookie, origin: 'http://hub.test', 'content-type': 'application/x-www-form-urlencoded' }, body: `code=${start.body['user_code'] as string}` })).status).toBe(200);
  return (await t.json('/auth/device/token', { method: 'POST', body: JSON.stringify({ device_code: start.body['device_code'] }) })).body['access_token'] as string;
}

describe('agents act for a person', () => {
  test('a device-flow token names its agent, and the principal carries it', async () => {
    const t = await testApp();
    const ada = await t.bearer('ada');
    const token = await deviceToken(t, ada.principal.userId, { name: 'vantage on laptop-1', client: 'vantage', host: 'laptop-1' });
    const me = await t.json('/api/v1/me', { headers: { authorization: `Bearer ${token}` } });
    expect(me.body['userId']).toBe(ada.principal.userId);
    expect(me.body['agent']).toMatchObject({ label: 'vantage on laptop-1' });
    const listed = (await t.json('/api/v1/agents', { headers: ada.headers })).body['agents'] as { label: string; client: string; host: string }[];
    expect(listed).toMatchObject([{ label: 'vantage on laptop-1', client: 'vantage', host: 'laptop-1' }]);
    // A person's own token names no agent.
    expect((await t.json('/api/v1/me', { headers: ada.headers })).body['agent']).toBeNull();
  });

  test("an agent's event records the agent beside the person, and history reads it as the agent for the person", async () => {
    const t = await testApp();
    const ada = await t.bearer('ada');
    const ws = ((await t.json('/api/v1/workspaces', { headers: ada.headers })).body['workspaces'] as { slug: string }[])[0]!;
    expect((await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: ada.headers, body: JSON.stringify({ yaml: WORK }) })).status).toBe(201);
    const token = await deviceToken(t, ada.principal.userId, { name: 'claude-code', client: 'claude-code', host: 'laptop-1' });
    const hub = await agent(t, { authorization: `Bearer ${token}` });
    await hub.call('vantage_write', { writes: [{ address: 'SW', text: '---\ntitle: Cache the prices\n---\n\nDone when prices answer from the cache.\n' }] });
    await hub.call('vantage_tool', { tool: 'vantage_item', arguments: { actions: [{ item: 'SW-1', note: 'Started on the cache.' }] } });
    const events = await t.ctx.db.query<{ actor_id: string; agent_id: string | null; actor_kind: string }>("select actor_id, agent_id, actor_kind from item_events order by position");
    expect(events.every((e) => e.actor_id === ada.principal.userId && e.agent_id !== null && e.actor_kind === 'agent')).toBe(true);
    const history = await hub.call('vantage_read', { addresses: ['SW-1#history'] });
    expect(history).toContain('claude-code on laptop-1 for ada@example.com: noted');
    const feed = (await t.json('/api/v1/changes', { headers: ada.headers })).body['changes'] as { actor: string; agent?: string }[];
    expect(feed[0]).toMatchObject({ actor: 'ada@example.com', agent: 'claude-code on laptop-1' });
    // The person's own act records no agent.
    await t.json('/api/v1/items/SW-1/notes', { method: 'POST', headers: { ...ada.headers, 'idempotency-key': 'own' }, body: JSON.stringify({ text: 'Mine.' }) });
    const own = await t.ctx.db.query<{ agent_id: string | null; actor_kind: string }>('select agent_id, actor_kind from item_events order by position desc limit 1');
    expect(own[0]).toEqual({ agent_id: null, actor_kind: 'person' });
  });

  test('disconnecting an agent on the Account page ends its token at once', async () => {
    const t = await testApp();
    const ada = await t.bearer('ada');
    const token = await deviceToken(t, ada.principal.userId, { name: 'vantage on laptop-1', client: 'vantage', host: 'laptop-1' });
    const cookie = `vantage_session=${await sealSession(t.ctx.config.SESSION_SECRET, ada.principal.userId)}`;
    const page = await (await t.app.request('/account', { headers: { cookie } })).text();
    expect(page).toContain('vantage on laptop-1');
    expect(page).toContain('data-what="agents"');
    const [listed] = (await t.json('/api/v1/agents', { headers: ada.headers })).body['agents'] as { id: string }[];
    expect((await t.app.request(`/api/v1/agents/${listed!.id}`, { method: 'DELETE', headers: ada.headers })).status).toBe(204);
    expect((await t.json('/api/v1/me', { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await t.json('/api/v1/agents', { headers: ada.headers })).body['agents']).toEqual([]);
    // Another person cannot end it.
    const bob = await t.bearer('bob');
    const second = await deviceToken(t, ada.principal.userId, { name: 'second' });
    const [other] = (await t.json('/api/v1/agents', { headers: ada.headers })).body['agents'] as { id: string }[];
    expect((await t.app.request(`/api/v1/agents/${other!.id}`, { method: 'DELETE', headers: bob.headers })).status).toBe(404);
    expect((await t.json('/api/v1/me', { headers: { authorization: `Bearer ${second}` } })).status).toBe(200);
  });
});

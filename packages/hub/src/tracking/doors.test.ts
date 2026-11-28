import { describe, expect, test } from 'bun:test';
import { agent } from '../mcp/testing.ts';
import { testApp } from '../testing.ts';

const KIND = `title: Shop work
kind:
  prefix: SW
  name: Shop work
  base: work-item
  labels:
    - { name: area, type: choice, choices: [api, web] }
  parts: [SW]
views: []
`;

async function seeded() {
  const t = await testApp();
  const me = await t.bearer('author');
  const hub = await agent(t, me.headers);
  const saved = await hub.call('vantage_write', { writes: [{ address: '~/shop-work', text: KIND }] });
  expect(saved).toContain('saved');
  return { t, me, hub };
}

const ITEM = `---
title: Cache the price list
labels:
  area: api
---

## Done when

The price list answers from the cache.
`;

describe('items through the doors', () => {
  test('an agent makes an item by writing at a kind, reads its card, patches its body, and lists the kind', async () => {
    const { hub } = await seeded();
    expect(await hub.call('vantage_write', { writes: [{ address: 'SW', text: ITEM }] })).toContain('created SW-1: Cache the price list (Open)');
    const card = await hub.call('vantage_read', { addresses: ['SW-1'] });
    expect(card).toContain('state: open (Open, not started');
    expect(card).toContain('start → doing');
    expect(card).toContain('The price list answers from the cache.');
    expect(await hub.call('vantage_patch', { edits: [{ address: 'SW-1', old: 'answers from the cache', new: 'answers from the cache in under 50 ms' }] })).toBe('saved SW-1 (body)');
    const refused = (await hub.attempt('vantage_patch', { edits: [{ address: 'SW-1', old: 'state: open (Open', new: 'state: done (Open' }] })).text;
    expect(refused).toContain('a state changes by a move');
    const outline = await hub.call('vantage_outline', { address: 'SW' });
    expect(outline).toContain('SW: Shop work  1 item');
    expect(outline).toContain('open (not-started) 1');
    expect(outline).toContain('SW-1  open  Cache the price list');
    expect(await hub.call('vantage_find', { query: '50 ms', in: 'SW' })).toContain('SW-1:');
  });

  test('vantage_item moves, holds, and notes in one call, each landing alone', async () => {
    const { hub } = await seeded();
    await hub.call('vantage_write', { writes: [{ address: 'SW', text: ITEM }] });
    const r = await hub.call('vantage_tool', { tool: 'vantage_item', arguments: { actions: [{ item: 'SW-1', move: 'doing' }, { item: 'SW-1', hold: 'me' }, { item: 'SW-1', move: 'done' }, { item: 'SW-1', note: 'Cached behind the API.' }] } });
    expect(r.split('\n')).toEqual(['SW-1 moved open → doing (start)', 'SW-1 is held by you', 'SW-1 moved doing → done (finish)', 'noted on SW-1']);
    const refusal = (await hub.attempt('vantage_tool', { tool: 'vantage_item', arguments: { actions: [{ item: 'SW-1', move: 'review' }] } })).text;
    expect(refusal).toContain('draws no move from done to review');
    expect(refusal).toContain('reopen → doing (needs note)');
    expect(await hub.call('vantage_read', { addresses: ['SW-1#history'] })).toContain('moved doing → done');
  });

  test('over HTTP a write needs a key, a put by the owner\'s own key lands once, and the feed carries on from a bookmark', async () => {
    const { t, me } = await seeded();
    const h = { ...me.headers };
    const noKey = await t.json('/api/v1/items', { method: 'PUT', headers: h, body: JSON.stringify({ kind: 'SW', ref: 'forms/1842', title: 'From a module' }) });
    expect(noKey.status).toBe(400);
    const first = await t.json('/api/v1/items', { method: 'PUT', headers: { ...h, 'idempotency-key': 'a1' }, body: JSON.stringify({ kind: 'SW', ref: 'forms/1842', title: 'From a module' }) });
    expect(first.status).toBe(201);
    expect(first.body['key']).toBe('SW-1');
    const again = await t.json('/api/v1/items', { method: 'PUT', headers: { ...h, 'idempotency-key': 'a1' }, body: JSON.stringify({ kind: 'SW', ref: 'forms/1842', title: 'From a module' }) });
    expect(again.body).toEqual({ status: 'repeat', key: 'SW-1', line: first.body['line'] });
    const byOwnKey = await t.json(`/api/v1/items/${encodeURIComponent('SW:forms/1842')}`, { headers: h });
    expect((byOwnKey.body['card'] as { key: string }).key).toBe('SW-1');
    const moved = await t.json(`/api/v1/items/SW-1/move`, { method: 'POST', headers: { ...h, 'idempotency-key': 'a2' }, body: JSON.stringify({ to: 'done' }) });
    expect(moved.status).toBe(409);
    const batch = await t.json('/api/v1/items/batch', { method: 'POST', headers: h, body: JSON.stringify({ actions: [{ verb: 'move', item: 'SW-1', to: 'doing', key: 'b1' }, { verb: 'note', item: 'SW-1', text: 'on it', key: 'b2' }, { verb: 'move', item: 'SW-1', to: 'nowhere', key: 'b3' }] }) });
    expect((batch.body['results'] as { status: string }[]).map((r) => r.status)).toEqual(['done', 'done', 'refused']);
    const feed = await t.json('/api/v1/changes?limit=2', { headers: h });
    expect((feed.body['changes'] as { type: string }[]).map((c) => c.type)).toEqual(['created', 'moved']);
    const rest = await t.json(`/api/v1/changes?after=${feed.body['next']}`, { headers: h });
    expect((rest.body['changes'] as { type: string }[]).map((c) => c.type)).toEqual(['noted']);
    const counts = await t.json('/api/v1/items?count=state', { headers: h });
    expect(counts.body['counts']).toEqual({ doing: 1 });
  });

  test('over HTTP the nine verbs carry the agent work: claim and renew are holds, ask is a move, finish is a release, the queue is a find, a roadmap is a put', async () => {
    const { t, me } = await seeded();
    const send = (path: string, method: string, key: string, body: unknown) => t.json(path, { method, headers: { ...me.headers, 'idempotency-key': key }, body: JSON.stringify(body) });
    await send('/api/v1/items', 'PUT', 'p1', { kind: 'SW', title: 'Cache the price list', owner: 'me', delegate: true });
    await send('/api/v1/items', 'PUT', 'p2', { kind: 'SW', title: 'Kept by its owner', owner: 'me' });
    expect((await t.json('/api/v1/items?list=queue', { headers: me.headers })).body['cards']).toEqual([expect.objectContaining({ key: 'SW-1' })]);
    expect((await send('/api/v1/items/SW-1/hold', 'POST', 'c1', { claim: 30 })).body['line']).toBe('SW-1 is claimed by you for 30 minutes; any call you make on it renews the claim');
    expect((await send('/api/v1/items/SW-1/hold', 'POST', 'c2', { renew: true })).body['line']).toBe('SW-1 is claimed by you for 20 more minutes');
    await send('/api/v1/items/SW-1/move', 'POST', 'm1', { to: 'doing' });
    expect((await send('/api/v1/items/SW-1/move', 'POST', 'a1', { ask: 'Which region holds the cache?' })).body['line']).toBe('SW-1 waits in waiting for an answer');
    await send('/api/v1/items/SW-1/move', 'POST', 'm2', { to: 'doing', note: 'Central US.' });
    const done = await send('/api/v1/items/SW-1/release', 'POST', 'f1', { move: 'done', run: { summary: 'Cached it.', proof: ['commit abc1234'], handoff: 'Watch the miss rate.' } });
    expect(done.body['line']).toBe('SW-1 run recorded, moved doing → done, and released');
    const roadmap = await t.app.request('/api/v1/items/roadmap?kind=SW&dryRun=true', { method: 'PUT', headers: { ...me.headers, 'content-type': 'text/markdown' }, body: '## Now\n\n- Warm the cache on deploy\n' });
    expect(((await roadmap.json()) as { lines: string[] }).lines.join('\n')).toContain('Warm the cache on deploy');
  });

  test('get and find answer only the fields asked for, and get answers an item the caller holds as unchanged', async () => {
    const { t, me } = await seeded();
    await t.json('/api/v1/items', { method: 'PUT', headers: { ...me.headers, 'idempotency-key': 'p1' }, body: JSON.stringify({ kind: 'SW', title: 'Cache the price list', labels: { area: 'api' } }) });
    expect((await t.json('/api/v1/items/SW-1?fields=title,state', { headers: me.headers })).body).toEqual({ card: { key: 'SW-1', title: 'Cache the price list', state: 'open' } });
    expect((await t.json('/api/v1/items?kind=SW&fields=state', { headers: me.headers })).body['rows']).toEqual([{ key: 'SW-1', state: 'open' }]);
    const many = await t.json('/api/v1/items?keys=SW-1&fields=labels', { headers: me.headers });
    expect(many.body['items']).toEqual([{ card: { key: 'SW-1', labels: { area: 'api' } } }]);
    const version = ((await t.json('/api/v1/items/SW-1', { headers: me.headers })).body['card'] as { version: number }).version;
    expect((await t.json(`/api/v1/items?keys=SW-1&held=SW-1@${version}`, { headers: me.headers })).body['items']).toEqual([{ key: 'SW-1', unchanged: version }]);
    const bad = await t.json('/api/v1/items?kind=SW&fields=colour', { headers: me.headers });
    expect(bad.status).toBe(400);
  });

  test('put changes a body by edits, never the whole body, and an edit that does not match once saves nothing', async () => {
    const { t, me, hub } = await seeded();
    await hub.call('vantage_write', { writes: [{ address: 'SW', text: ITEM }] });
    const put = (key: string, body: unknown) => t.json('/api/v1/items', { method: 'PUT', headers: { ...me.headers, 'idempotency-key': key }, body: JSON.stringify(body) });
    expect((await put('e1', { item: 'SW-1', edits: [{ old: 'from the cache', new: 'from the cache in under 50 ms' }] })).body['line']).toBe('saved SW-1 (body)');
    expect((await t.json('/api/v1/items/SW-1?fields=body', { headers: me.headers })).body['body']).toContain('The price list answers from the cache in under 50 ms.');
    expect((await put('e2', { item: 'SW-1', edits: [{ old: 'not in the body', new: 'x' }] })).status).toBe(400);
    expect((await put('e3', { item: 'SW-1', body: 'whole', edits: [{ old: 'The', new: 'A' }] })).status).toBe(400);
  });

  test('the Work tab lists a kind by state, and an item page offers only the moves open to the reader', async () => {
    const { t, me, hub } = await seeded();
    await hub.call('vantage_write', { writes: [{ address: 'SW', text: ITEM }] });
    const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!.slug;
    const tab = await (await t.app.request(`/w/${ws}?tab=work`, { headers: me.headers })).text();
    expect(tab).toContain('SW-1');
    expect(tab).toContain('Cache the price list');
    expect(tab).toMatch(/Open<span class="n">1</);
    const page = await t.app.request(`/w/${ws}/work/SW-1`, { headers: me.headers });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('start → Doing');
    expect(html).toContain('drop → Dropped');
    expect(html).not.toContain('finish → Done');
    expect(html).toContain('The price list answers from the cache.');
    const stranger = await t.bearer('stranger');
    expect((await t.app.request(`/w/${ws}/work/SW-1`, { headers: stranger.headers })).status).toBe(404);
  });
});

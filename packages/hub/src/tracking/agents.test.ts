/** Agents on items (VAN-3010): the queue, claims that expire, run records, handoff notes, and questions. */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agent, laptop } from '../mcp/testing.ts';
import { testApp } from '../testing.ts';
import { HttpError } from '../http.ts';
import { findItem } from './access.ts';
import { get } from './read.ts';
import { queue } from './queue.ts';
import { ask, claim, finish, hold, move, note, put } from './write.ts';

const WORK = `title: Shop work
kind: { prefix: SW, name: Shop work, base: work-item }
views: []
`;

async function seeded() {
  const t = await testApp();
  const me = await t.bearer('author');
  const other = await t.bearer('other-agent');
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string; id?: string }[])[0]!;
  expect((await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: WORK }) })).status).toBe(201);
  // The other agent writes the same workspace.
  await t.ctx.db.query("insert into grants (id, org_id, workspace_id, subject_kind, subject_id, role) select 'g1', org_id, id, 'user', $1, 'author' from workspaces where slug = $2", [other.principal.userId, ws.slug]);
  for (const [i, title] of ['Cache the prices', 'Read through the cache', 'Retire the old reports'].entries()) await put(t.ctx, me.principal, { kind: 'SW', title }, `p${i}`);
  return { t, me, other, ws };
}

const BUILDS = `title: Builds
kind:
  prefix: BLD
  name: Builds
  roles:
    builder: [builder@example.com]
  lifecycle: flow
views:
  - id: flow
    kind: lifecycle
    title: How a build moves
    states:
      - { id: open, text: Open, class: not-started }
      - { id: doing, text: Doing, class: in-progress }
      - { id: done, text: Done, class: done }
    moves:
      - { from: open, to: doing, label: start, who: [builder] }
      - { from: doing, to: done, label: finish, who: [holder] }
`;

const refusal = (run: Promise<unknown>): Promise<HttpError> => run.then(() => { throw new Error('not refused'); }, (e: unknown) => e as HttpError);
const lapse = (t: Awaited<ReturnType<typeof seeded>>['t'], key: string) => t.ctx.db.query("update items set claim_until = now() - interval '1 minute' where key = $1", [key]);

describe('agents on items', () => {
  test('one claim holds an item; the queue passes it over, and offers it again when the claim runs out', async () => {
    const { t, me, other } = await seeded();
    expect((await queue(t.ctx, other.principal)).cards.map((c) => c.key)).toEqual(['SW-1', 'SW-2', 'SW-3']);
    expect((await claim(t.ctx, me.principal, 'SW-1', undefined, 'c1')).line).toBe('SW-1 is claimed by you for 20 minutes; any call you make on it renews the claim');
    expect((await refusal(claim(t.ctx, other.principal, 'SW-1', undefined, 'c2'))).message).toContain('is claimed until');
    expect((await queue(t.ctx, other.principal)).cards.map((c) => c.key)).toEqual(['SW-2', 'SW-3']);
    await lapse(t, 'SW-1');
    expect((await queue(t.ctx, other.principal)).cards.map((c) => c.key)).toContain('SW-1');
    await claim(t.ctx, other.principal, 'SW-1', undefined, 'c3');
    const item = (await findItem(t.ctx, other.principal, 'SW-1')).item;
    expect(item.holders).toEqual([other.principal.userId]);
    expect(item.claim?.userId).toBe(other.principal.userId);
  });

  test('a claimant\'s own call renews a claim past its half, with no heartbeat from the model', async () => {
    const { t, me } = await seeded();
    await claim(t.ctx, me.principal, 'SW-1', undefined, 'c1');
    await t.ctx.db.query("update items set claim_until = now() + interval '5 minutes' where key = 'SW-1'");
    expect((await note(t.ctx, me.principal, 'SW-1', 'halfway', 'n1')).line).toBe('noted on SW-1');
    const after = (await findItem(t.ctx, me.principal, 'SW-1')).item.claim!;
    expect(Date.parse(after.until) - Date.now()).toBeGreaterThan(15 * 60_000);
    const types = await t.ctx.db.query<{ type: string }>("select e.type from item_events e join items i on i.id = e.item_id where i.key = 'SW-1' order by e.position");
    expect(types.map((r) => r.type)).toEqual(['created', 'claimed', 'noted', 'renewed']);
  });

  test('finishing is one call: a run record, a move, and the release, and the next run reads the handoff in the queue', async () => {
    const { t, me, other } = await seeded();
    await claim(t.ctx, me.principal, 'SW-1', undefined, 'c1');
    await move(t.ctx, me.principal, 'SW-1', { to: 'doing' }, 'm1');
    const done = await finish(t.ctx, me.principal, 'SW-1', { move: 'review', run: { summary: 'Cached the price list behind the API.', proof: ['commit abc1234'], handoff: 'The cache warms on deploy; check the miss rate.', seconds: 640, cost: { amount: 0.42, currency: 'USD', tokens: 81000 } } }, 'f1');
    expect(done.line).toBe('SW-1 run recorded, moved doing → review, and released');
    const item = (await findItem(t.ctx, me.principal, 'SW-1')).item;
    expect(item.state).toBe('review');
    expect(item.holders).toEqual([]);
    expect(item.claim).toBeNull();
    const [card] = await get(t.ctx, me.principal, ['SW-1']);
    expect(card && 'card' in card && card.card.runs).toBe(1);
    const next = (await queue(t.ctx, other.principal)).cards.find((c) => c.key === 'SW-1');
    expect(next?.handoff).toBe('The cache warms on deploy; check the miss rate.');
  });

  test('a question makes the item wait for a person, out of the queue, until the answer moves it on', async () => {
    const { t, me, other } = await seeded();
    await claim(t.ctx, other.principal, 'SW-2', undefined, 'c1');
    await move(t.ctx, other.principal, 'SW-2', { to: 'doing' }, 'm1');
    expect((await ask(t.ctx, other.principal, 'SW-2', 'Which region holds the cache?', 'a1')).line).toBe('SW-2 waits in waiting for an answer');
    expect((await queue(t.ctx, me.principal)).cards.map((c) => c.key)).not.toContain('SW-2');
    await move(t.ctx, me.principal, 'SW-2', { to: 'doing', note: 'Central US.' }, 'm2');
    // Answered, it is back with the run that asked, which still holds its claim.
    expect((await queue(t.ctx, other.principal)).cards.map((c) => c.key)).toContain('SW-2');
    expect((await queue(t.ctx, me.principal)).cards.map((c) => c.key)).not.toContain('SW-2');
  });

  test('an agent takes an item, reads it, and finishes it in a fixed number of calls through the door', async () => {
    const { t, me } = await seeded();
    const hub = await agent(t, me.headers);
    const q = await hub.call('vantage_tool', { tool: 'vantage_queue', arguments: { limit: 1 } });
    expect(q).toContain('SW-1  open  Cache the prices');
    await hub.call('vantage_tool', { tool: 'vantage_item', arguments: { actions: [{ item: 'SW-1', claim: true }, { item: 'SW-1', move: 'doing' }] } });
    await hub.call('vantage_read', { addresses: ['SW-1'] });
    const end = await hub.call('vantage_tool', { tool: 'vantage_item', arguments: { actions: [{ item: 'SW-1', finish: { move: 'done', summary: 'Cached it.', proof: ['commit abc1234'] } }] } });
    expect(end).toBe('SW-1 run recorded, moved doing → done, and released');
    expect(hub.cost.calls).toBe(4);
  });

  test('a person a role names takes the item the queue offers, works it, and finishes it, with no grant on its workspace', async () => {
    const { t, me, ws } = await seeded();
    expect((await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: BUILDS }) })).status).toBe(201);
    const builder = await t.bearer('builder');
    await put(t.ctx, me.principal, { kind: 'BLD', title: 'Build the price cache' }, 'b1');
    expect((await queue(t.ctx, builder.principal)).cards.map((c) => c.key)).toEqual(['BLD-1']);
    expect((await claim(t.ctx, builder.principal, 'BLD-1', undefined, 'c1')).line).toContain('BLD-1 is claimed by you');
    await move(t.ctx, builder.principal, 'BLD-1', { to: 'doing' }, 'm1');
    expect((await finish(t.ctx, builder.principal, 'BLD-1', { move: 'done', run: { summary: 'Built it.', proof: [] } }, 'f1')).line).toBe('BLD-1 run recorded, moved doing → done, and released');
  });

  test('a person a role names who first signs in after the item was made is offered it, and so is a team made later', async () => {
    const { t, me, ws } = await seeded();
    const yaml = BUILDS.replace('builder: [builder@example.com]', 'builder: [builder@example.com, team:night-shift]');
    expect((await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml }) })).status).toBe(201);
    await put(t.ctx, me.principal, { kind: 'BLD', title: 'Build the price cache' }, 'b1');
    const builder = await t.bearer('builder');
    expect((await queue(t.ctx, builder.principal)).cards.map((c) => c.key)).toEqual(['BLD-1']);
    const night = await t.bearer('night-owl', { groups: ['night-shift'] });
    expect((await queue(t.ctx, night.principal)).cards.map((c) => c.key)).toEqual(['BLD-1']);
  });

  test('a kind saved with another roster names its open items again', async () => {
    const { t, me, ws } = await seeded();
    expect((await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: BUILDS }) })).status).toBe(201);
    const builder = await t.bearer('builder');
    const second = await t.bearer('second-builder');
    await put(t.ctx, me.principal, { kind: 'BLD', title: 'Build the price cache' }, 'b1');
    expect((await queue(t.ctx, second.principal)).cards).toEqual([]);
    const hub = await agent(t, me.headers);
    expect(await hub.call('vantage_patch', { edits: [{ address: `${ws.slug}/builds`, old: 'builder: [builder@example.com]', new: 'builder: [second-builder@example.com]' }] })).toContain('saved');
    expect((await queue(t.ctx, second.principal)).cards.map((c) => c.key)).toEqual(['BLD-1']);
    expect((await queue(t.ctx, builder.principal)).cards).toEqual([]);
  });

  test('a person named only as a holder makes their moves, but neither claims the item nor writes its runs', async () => {
    const { t, me } = await seeded();
    const helper = await t.bearer('helper');
    await hold(t.ctx, me.principal, 'SW-1', 'helper@example.com', 'h1');
    expect((await refusal(finish(t.ctx, helper.principal, 'SW-1', { run: { summary: 'I did it.', proof: [] } }, 'f1'))).status).toBe(403);
    expect((await refusal(claim(t.ctx, helper.principal, 'SW-1', undefined, 'c1'))).status).toBe(403);
    expect(Number((await t.ctx.db.query<{ n: number }>("select count(*)::int as n from item_events e join items i on i.id = e.item_id where i.key = 'SW-1' and e.type = 'ran'"))[0]!.n)).toBe(0);
  });

  test('the bridge keeps a claim alive while its session lives, and stops when it ends', async () => {
    const { t, me } = await seeded();
    const lap = await laptop(t, { url: 'http://hub.test', token: me.token }, { renewEveryMs: 150 });
    expect(await lap.call('vantage_item', { actions: [{ item: 'SW-3', claim: true }] })).toContain('is claimed by you');
    await new Promise((r) => setTimeout(r, 500));
    const renewals = async () => Number((await t.ctx.db.query<{ n: number }>("select count(*)::int as n from item_events e join items i on i.id = e.item_id where i.key = 'SW-3' and e.type = 'renewed'"))[0]!.n);
    const alive = await renewals();
    expect(alive).toBeGreaterThan(0);
    await lap.client.close();
    await new Promise((r) => setTimeout(r, 300));
    const stopped = await renewals();
    await new Promise((r) => setTimeout(r, 400));
    expect(await renewals()).toBe(stopped);
  });

  test('an agent with a disk checks a kind out as files, edits one, makes one, and syncs both', async () => {
    const { t, me } = await seeded();
    const lap = await laptop(t, { url: 'http://hub.test', token: me.token });
    const dir = mkdtempSync(join(tmpdir(), 'vantage-work-'));
    expect(await lap.call('vantage_checkout', { address: 'SW', dir })).toContain('3');
    const file = readdirSync(join(dir, 'work', 'SW')).find((f) => f.startsWith('SW-1-'))!;
    const path = join(dir, 'work', 'SW', file);
    writeFileSync(path, `${readFileSync(path, 'utf8').trimEnd()}\n\n## Done when\n\nPrices answer from the cache.\n`);
    writeFileSync(join(dir, 'work', 'SW', 'new.md'), '---\ntitle: Watch the cache\n---\n\nAlert on the miss rate.\n');
    const synced = await lap.call('vantage_sync', { dir });
    expect(synced).toContain('saved SW-1 (body)');
    expect(synced).toContain('created SW-4: Watch the cache');
    expect(readdirSync(join(dir, 'work', 'SW')).some((f) => f.startsWith('SW-4-'))).toBe(true);
  });
});

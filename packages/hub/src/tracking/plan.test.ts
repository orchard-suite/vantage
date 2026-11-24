import { describe, expect, test } from 'bun:test';
import { testApp } from '../testing.ts';
import { DEFAULT_ORG } from '../auth/authenticate.ts';
import { agent } from '../mcp/testing.ts';
import { silentLogger } from '../log.ts';
import { HttpError } from '../http.ts';
import { findItem } from './access.ts';
import { find, get } from './read.ts';
import { hold, link, move, put } from './write.ts';
import { rankBetween } from './rank.ts';
import { relayKinds } from './kinds.ts';
import { itemOutline, kindOutline } from '../text/items.ts';

const ROADMAP = `title: Shop roadmap
kind: { prefix: RM, name: Shop roadmap, base: roadmap-item, parts: [RM, SW] }
views: []
`;
const WORK = `title: Shop work
kind: { prefix: SW, name: Shop work, base: work-item }
views: []
`;
const MILESTONES = `title: Shop milestones
kind: { prefix: RMM, name: Shop milestones, base: milestone }
views: []
`;

async function seeded() {
  const t = await testApp();
  const me = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
  for (const yaml of [ROADMAP, WORK, MILESTONES]) expect((await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml }) })).status).toBe(201);
  return { t, me, p: me.principal, ws };
}

const refused = async (run: Promise<unknown>): Promise<HttpError> => {
  try {
    await run;
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
  throw new Error('it was not refused');
};

const keys = async (s: Awaited<ReturnType<typeof seeded>>, kind: string): Promise<string[]> => (await find(s.t.ctx, s.p, { kinds: [kind], limit: 100 })).rows.map((r) => r.key);
const card = async (s: Awaited<ReturnType<typeof seeded>>, key: string) => {
  const [c] = await get(s.t.ctx, s.p, [key]);
  if (!c || !('card' in c)) throw new Error(`no card for ${key}`);
  return c.card;
};

describe('a rank fits between any two', () => {
  test('a hundred places at the front, the back, and one gap stay in order', () => {
    let ranks = [rankBetween('', null)];
    for (let i = 0; i < 100; i++) ranks = [rankBetween('', ranks[0]!), ...ranks, rankBetween(ranks[ranks.length - 1]!, null)];
    let lo = ranks[0]!, hi = ranks[1]!;
    for (let i = 0; i < 100; i++) {
      const mid = rankBetween(lo, hi);
      expect(lo < mid && mid < hi).toBe(true);
      hi = mid;
    }
    expect([...ranks].sort()).toEqual(ranks);
    expect(ranks.every((r) => !r.endsWith('0'))).toBe(true);
  });
});

describe('items keep an order inside a horizon', () => {
  test('a place rewrites one row, and every list of the kind shows horizon, then place, then newest', async () => {
    const s = await seeded();
    const { t, p } = s;
    for (const [i, h] of (['now', 'now', 'now', 'next'] as const).entries()) await put(t.ctx, p, { kind: 'RM', title: `Outcome ${i + 1}`, labels: { horizon: h } }, `r${i}`);
    expect(await keys(s, 'RM')).toEqual(['RM-3', 'RM-2', 'RM-1', 'RM-4']);
    expect((await put(t.ctx, p, { item: 'RM-1', place: 'first' }, 'p1')).line).toBe('saved RM-1 (placed first in now)');
    expect(await keys(s, 'RM')).toEqual(['RM-1', 'RM-3', 'RM-2', 'RM-4']);
    await put(t.ctx, p, { item: 'RM-2', place: { after: 'RM-1' } }, 'p2');
    expect(await keys(s, 'RM')).toEqual(['RM-1', 'RM-2', 'RM-3', 'RM-4']);
    const placed = async (): Promise<number> => Number((await t.ctx.db.query<{ n: number }>("select count(*)::int as n from item_events where type = 'placed'"))[0]!.n);
    const before = await placed();
    await put(t.ctx, p, { item: 'RM-3', place: { before: 'RM-2' } }, 'p3');
    expect(await placed()).toBe(before + 1);
    expect(await keys(s, 'RM')).toEqual(['RM-1', 'RM-3', 'RM-2', 'RM-4']);
    const outline = await kindOutline(t.ctx, p, 'RM', undefined);
    expect(outline).toContain('items, by horizon, then in their place, then newest first (4):');
    expect(outline.indexOf('RM-3  planned')).toBeLessThan(outline.indexOf('RM-2  planned'));
    expect(await kindOutline(t.ctx, p, 'SW', undefined)).toContain('items, in their place, then newest first (0):');
  });

  test('a place beside an item in another horizon is refused, and with the horizon in the same put it moves there', async () => {
    const s = await seeded();
    const { t, p } = s;
    await put(t.ctx, p, { kind: 'RM', title: 'Now', labels: { horizon: 'now' } }, 'r1');
    await put(t.ctx, p, { kind: 'RM', title: 'Next', labels: { horizon: 'next' } }, 'r2');
    expect((await refused(put(t.ctx, p, { item: 'RM-2', place: { before: 'RM-1' } }, 'p1'))).message).toContain('set horizon in the same put');
    expect((await refused(put(t.ctx, p, { item: 'RM-2', place: { before: 'RM-2' } }, 'p2'))).message).toContain('beside itself');
    expect((await put(t.ctx, p, { item: 'RM-2', labels: { horizon: 'now' }, place: { before: 'RM-1' } }, 'p3')).line).toBe('saved RM-2 (labels, placed before RM-1)');
    expect(await keys(s, 'RM')).toEqual(['RM-2', 'RM-1']);
    // A horizon set alone puts the item after the ranked ones there, until it is placed.
    await put(t.ctx, p, { item: 'RM-2', labels: { horizon: 'next' } }, 'p4');
    expect((await findItem(t.ctx, p, 'RM-2')).item.rank).toBeNull();
  });

  test('vantage_item places an item as an event, over HTTP a put takes a place, and a reader who may not edit is refused', async () => {
    const s = await seeded();
    const { t, p, me, ws } = s;
    await put(t.ctx, p, { kind: 'RM', title: 'One', labels: { horizon: 'now' } }, 'r1');
    await put(t.ctx, p, { kind: 'RM', title: 'Two', labels: { horizon: 'now' } }, 'r2');
    const hub = await agent(t, me.headers);
    expect(await hub.call('vantage_tool', { tool: 'vantage_item', arguments: { actions: [{ item: 'RM-1', place: 'first' }] } })).toBe('saved RM-1 (placed first in now)');
    expect(await hub.call('vantage_read', { addresses: ['RM-1#history'] })).toContain(': placed');
    const http = await t.json('/api/v1/items', { method: 'PUT', headers: { ...me.headers, 'idempotency-key': 'h1' }, body: JSON.stringify({ item: 'RM-2', place: { before: 'RM-1' } }) });
    expect(http.body['line']).toBe('saved RM-2 (placed before RM-1)');
    expect(await keys(s, 'RM')).toEqual(['RM-2', 'RM-1']);
    const viewer = await t.bearer('viewer');
    const wsId = (await t.ctx.db.query<{ id: string }>('select id from workspaces where slug = $1', [ws.slug]))[0]!.id;
    await t.ctx.db.query("insert into grants (id, org_id, workspace_id, role, subject_kind, subject_id) values ('g1', $1, $2, 'viewer', 'user', $3)", [DEFAULT_ORG, wsId, viewer.principal.userId]);
    expect((await refused(put(t.ctx, viewer.principal, { item: 'RM-1', place: 'first' }, 'v1'))).status).toBe(403);
    const seen = await (await t.app.request(`/w/${ws.slug}?tab=work&kind=RM`, { headers: viewer.headers })).text();
    expect(seen).not.toContain('draggable="true"');
    const mine = await (await t.app.request(`/w/${ws.slug}?tab=work&kind=RM`, { headers: me.headers })).text();
    expect(mine).toContain('<div class="work-board" data-api="/api/v1/items">');
    expect(mine).toContain('data-key="RM-2" draggable="true"');
    expect(mine).toContain('aria-label="Move RM-1 down" disabled');
    expect(mine.indexOf('data-key="RM-2"')).toBeLessThan(mine.indexOf('data-key="RM-1"'));
  });
});

describe('an item has a start and an end', () => {
  test('an end before its start is refused, whether it comes with the item or later', async () => {
    const s = await seeded();
    const { t, p } = s;
    expect((await refused(put(t.ctx, p, { kind: 'RM', title: 'Backwards', labels: { start: '2026-03-01', end: '2026-02-01' } }, 'r1'))).message).toBe('end 2026-02-01 is before start 2026-03-01; an item ends on or after the day it starts');
    await put(t.ctx, p, { kind: 'RM', title: 'Forwards', labels: { start: '2026-03-01', end: '2026-03-01' } }, 'r2');
    expect((await refused(put(t.ctx, p, { item: 'RM-1', labels: { end: '2026-02-28' } }, 'r3'))).message).toContain('is before start 2026-03-01');
  });

  test('a parent spans its parts, earliest start to latest end, and its own labels stay its own', async () => {
    const s = await seeded();
    const { t, p, ws, me } = s;
    await put(t.ctx, p, { kind: 'RM', title: 'The cache ships' }, 'r1');
    await put(t.ctx, p, { kind: 'RM', title: 'Build it', parent: 'RM-1', labels: { start: '2026-01-05', end: '2026-02-01' } }, 'r2');
    await put(t.ctx, p, { kind: 'RM', title: 'Roll it out', parent: 'RM-1', labels: { start: '2026-01-20', end: '2026-02-20' } }, 'r3');
    await put(t.ctx, p, { kind: 'RM', title: 'Tune it', parent: 'RM-3', labels: { end: '2026-03-01' } }, 'r4');
    await put(t.ctx, p, { kind: 'RM', title: 'Promised alone', labels: { promised: '2026-02-10' } }, 'r5');
    const c = await card(s, 'RM-1');
    expect(c.span).toEqual({ start: '2026-01-05', end: '2026-03-01', parts: 3 });
    expect(c.labels).toEqual({});
    expect(await itemOutline(t.ctx, p, 'RM-1')).toContain('span: 2026-01-05 to 2026-03-01, from 3 parts');
    expect(await kindOutline(t.ctx, p, 'RM', undefined)).toContain('span 2026-01-05..2026-03-01');
    const hub = await agent(t, me.headers);
    const text = await hub.call('vantage_read', { addresses: ['RM-1'] });
    expect(text).toContain('span: 2026-01-05 to 2026-03-01, from 3 parts');
    // The text read back writes nothing: the span is the hub's, not a field the item holds.
    expect(await hub.call('vantage_write', { writes: [{ address: 'RM-1', text: text.slice(text.indexOf('---')) }] })).toContain('unchanged');
    const tl = await (await t.app.request(`/w/${ws.slug}?tab=work&kind=RM&look=timeline`, { headers: me.headers })).text();
    expect(tl).toContain('class="work-bar parts"');
    expect(tl).toContain('2026-01-05 to 2026-03-01, from its parts');
    expect(tl).toContain('2026-01-05 to 2026-02-01</time>');
    expect(tl).toMatch(/<span class="work-pt" style="--at:[\d.]+%"><\/span><\/span><span class="pill ">Planned<\/span><time>2026-02-10<\/time>/);
  });

  test('a kind registered before its base gained start and end is laid over the base again after the migrations', async () => {
    const s = await seeded();
    const { t } = s;
    await t.ctx.db.query("update item_kinds set definition = jsonb_set(definition, '{labels}', (select jsonb_agg(l) from jsonb_array_elements(definition -> 'labels') l where l ->> 'name' not in ('start', 'end'))) where prefix = 'RM'");
    expect(await relayKinds(t.ctx.db, silentLogger)).toBe(1);
    const def = (await t.ctx.db.query<{ definition: { labels: { name: string }[] } }>("select definition from item_kinds where prefix = 'RM'"))[0]!.definition;
    expect(def.labels.map((l) => l.name)).toEqual(['horizon', 'promised', 'start', 'end']);
    expect(await relayKinds(t.ctx.db, silentLogger)).toBe(0);
  });
});

describe('a milestone gathers items to one date', () => {
  test('toward names only a milestone, and the milestone rolls up its items with the ones at risk', async () => {
    const s = await seeded();
    const { t, p } = s;
    await put(t.ctx, p, { kind: 'RMM', title: 'Checkout is live', labels: { date: '2026-03-01' } }, 'm1');
    await put(t.ctx, p, { kind: 'RM', title: 'On time', labels: { end: '2026-02-15' } }, 'r1');
    await put(t.ctx, p, { kind: 'RM', title: 'Late', labels: { end: '2026-03-10' } }, 'r2');
    await put(t.ctx, p, { kind: 'RM', title: 'Waits on the late one', labels: { end: '2026-02-20' } }, 'r3');
    await put(t.ctx, p, { kind: 'SW', title: 'No end' }, 'w1');
    expect((await refused(link(t.ctx, p, 'RM-2', { rel: 'toward', target: 'RM-1' }, 'x1'))).message).toContain('RM-1 is not a milestone');
    for (const [i, k] of ['RM-1', 'RM-2', 'RM-3', 'SW-1'].entries()) expect((await link(t.ctx, p, k, { rel: 'toward', target: 'RMM-1' }, `l${i}`)).line).toStartWith(`${k} toward RMM-1`);
    await link(t.ctx, p, 'RM-3', { rel: 'waits-on', target: 'RM-2' }, 'w2');
    const c = await card(s, 'RMM-1');
    expect(c.milestone?.status).toBe('at risk');
    expect(c.milestone?.counts).toEqual({ 'not-started': 4, 'in-progress': 0, done: 0, parked: 0 });
    expect(c.milestone?.atRisk).toEqual([
      { key: 'RM-2', why: 'it ends 2026-03-10, after 2026-03-01' },
      { key: 'RM-3', why: 'it waits on RM-2, which ends 2026-03-10' },
      { key: 'SW-1', why: 'it has no end date' },
    ]);
    expect(await itemOutline(t.ctx, p, 'RMM-1')).toContain('milestone: at risk: 4 items toward it (4 not started), due 2026-03-01; at risk: RM-2 (it ends 2026-03-10, after 2026-03-01)');
    await put(t.ctx, p, { item: 'RM-2', labels: { end: '2026-02-25' } }, 'e1');
    await put(t.ctx, p, { item: 'SW-1', title: 'No end' }, 'e2');
    await link(t.ctx, p, 'SW-1', { rel: 'toward', target: 'RMM-1', remove: true }, 'u1');
    expect((await card(s, 'RMM-1')).milestone?.status).toBe('on track');
  });

  test('a milestone ships when every item toward it has shipped, and the timeline marks it at its date', async () => {
    const s = await seeded();
    const { t, p, ws, me } = s;
    await put(t.ctx, p, { kind: 'RMM', title: 'Checkout is live', labels: { date: '2026-03-01' } }, 'm1');
    await put(t.ctx, p, { kind: 'SW', title: 'Pay page' }, 'w1');
    await put(t.ctx, p, { kind: 'SW', title: 'Receipts' }, 'w2');
    for (const k of ['SW-1', 'SW-2']) await link(t.ctx, p, k, { rel: 'toward', target: 'RMM-1' }, `l-${k}`);
    const state = async (): Promise<string> => (await findItem(t.ctx, p, 'RMM-1')).item.state;
    expect((await move(t.ctx, p, 'SW-1', { to: 'doing' }, 'a1')).line).toContain('by its proof, RMM-1 moved');
    expect(await state()).toBe('building');
    for (const k of ['SW-1', 'SW-2']) {
      if (k === 'SW-2') await move(t.ctx, p, k, { to: 'doing' }, 'a2');
      await hold(t.ctx, p, k, 'me', `h-${k}`);
      await move(t.ctx, p, k, { to: 'done' }, `d-${k}`);
    }
    expect(await state()).toBe('shipped');
    expect((await card(s, 'RMM-1')).milestone?.status).toBe('done');
    await put(t.ctx, p, { kind: 'RM', title: 'Checkout outcome', labels: { start: '2026-01-10', end: '2026-02-20' } }, 'r1');
    await link(t.ctx, p, 'RM-1', { rel: 'toward', target: 'RMM-1' }, 'l3');
    const tl = await (await t.app.request(`/w/${ws.slug}?tab=work&kind=RM&look=timeline`, { headers: me.headers })).text();
    expect(tl).toContain('title="RMM-1 Checkout is live, due 2026-03-01"');
    expect(tl).toContain('class="work-ms-line" style="--at:100.00%"');
  });
});

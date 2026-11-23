import { describe, expect, test } from 'bun:test';
import { testApp } from '../testing.ts';
import { HttpError } from '../http.ts';
import { findItem } from './access.ts';
import { get } from './read.ts';
import { hold, link, move, put } from './write.ts';
import { reworkDocument, reworkSource } from './worked.ts';
import { importRoadmap, parseRoadmap } from './import.ts';

const WORK = `title: Shop work
kind: { prefix: SW, name: Shop work, base: work-item }
views: []
`;
const PLAN = `title: Platform roadmap
kind: { prefix: PLAN, name: Platform roadmap, base: roadmap-item, parts: [SW] }
views: []
`;
const SYSTEM = `title: Shop
nodes:
  - { id: cache, name: Price cache, type: database, bind: "kubectl:deployment:shop/cache" }
  - { id: api, name: Shop API, type: api }
relations:
  - { from: api, to: cache, label: reads }
views:
  - { id: context, title: Context, include: { tags: [] } }
`;

async function seeded() {
  const t = await testApp();
  const me = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
  for (const yaml of [WORK, PLAN, SYSTEM]) expect((await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml }) })).status).toBe(201);
  return { t, p: me.principal, ws };
}

const stateOf = async (t: Awaited<ReturnType<typeof seeded>>, key: string): Promise<string> => (await findItem(t.t.ctx, t.p, key)).item.state;

describe('roadmap items work out their state from proof', () => {
  test('parts move a roadmap item through building to shipped and back, as events the hub makes', async () => {
    const s = await seeded();
    const { t, p } = s;
    await put(t.ctx, p, { kind: 'PLAN', title: 'Prices answer from a cache', labels: { horizon: 'now' } }, 'r1');
    await put(t.ctx, p, { kind: 'SW', title: 'Cache the price list', parent: 'PLAN-1' }, 'w1');
    await put(t.ctx, p, { kind: 'SW', title: 'Read prices through the cache', parent: 'PLAN-1' }, 'w2');
    expect(await stateOf(s, 'PLAN-1')).toBe('planned');
    const started = await move(t.ctx, p, 'SW-1', { to: 'doing' }, 'm1');
    expect(started.line).toBe('SW-1 moved open → doing (start); by its proof, PLAN-1 moved');
    expect(await stateOf(s, 'PLAN-1')).toBe('building');
    for (const [k, i] of [['SW-1', 2], ['SW-2', 3]] as const) {
      if (k === 'SW-2') await move(t.ctx, p, k, { to: 'doing' }, `m${i}a`);
      await hold(t.ctx, p, k, 'me', `h${i}`);
      await move(t.ctx, p, k, { to: 'done' }, `m${i}`);
    }
    expect(await stateOf(s, 'PLAN-1')).toBe('shipped');
    await move(t.ctx, p, 'SW-2', { to: 'doing', note: 'the cache misses' }, 'm4');
    // Reopening needs no holder: it is for an author.
    expect(await stateOf(s, 'PLAN-1')).toBe('building');
    const events = await t.ctx.db.query<{ actor_kind: string; data: { to: string } }>("select e.actor_kind, e.data from item_events e join items i on i.id = e.item_id where i.key = 'PLAN-1' and e.type = 'moved' order by e.position");
    expect(events.map((e) => `${e.actor_kind}:${e.data.to}`)).toEqual(['system:building', 'system:shipped', 'system:building']);
    const [card] = await get(t.ctx, p, ['PLAN-1']);
    if (!card || !('card' in card)) throw new Error('no card');
    expect(card.card.proof).toMatch(/^2 items \(1 done, 1 under way\); newest \d{4}-\d{2}-\d{2}$/);
  });

  test('no person types a roadmap item\'s status; without machine proof it can only be reported done', async () => {
    const s = await seeded();
    const { t, p } = s;
    await put(t.ctx, p, { kind: 'PLAN', title: 'Nothing tracks this yet' }, 'r1');
    const err = await move(t.ctx, p, 'PLAN-1', { to: 'building' }, 'm1').then(() => undefined, (e: unknown) => e as HttpError);
    expect(err?.message).toContain('is for proof');
    expect(err?.message).toContain('report done → reported (needs note)');
    await move(t.ctx, p, 'PLAN-1', { to: 'reported', note: 'shipped by hand on Friday' }, 'm2');
    expect(await stateOf(s, 'PLAN-1')).toBe('reported');
    // Proof that lands later moves it on.
    await put(t.ctx, p, { kind: 'SW', title: 'The work after all' }, 'w1');
    await link(t.ctx, p, 'PLAN-1', { rel: 'proof', target: 'SW-1' }, 'l1');
    await move(t.ctx, p, 'SW-1', { to: 'doing' }, 'm3');
    expect(await stateOf(s, 'PLAN-1')).toBe('reported');
    await hold(t.ctx, p, 'SW-1', 'me', 'h1');
    await move(t.ctx, p, 'SW-1', { to: 'done' }, 'm4');
    expect(await stateOf(s, 'PLAN-1')).toBe('shipped');
  });

  test('a box named as proof ships the item when a connector sees its real thing, and a box bound to nothing is never proof', async () => {
    const s = await seeded();
    const { t, p, ws } = s;
    await put(t.ctx, p, { kind: 'PLAN', title: 'The price cache runs' }, 'r1');
    await link(t.ctx, p, 'PLAN-1', { rel: 'proof', target: `${ws.slug}/shop#cache` }, 'l1');
    const doc = (await t.ctx.db.query<{ id: string; org_id: string }>("select id, org_id from documents where slug = 'shop'"))[0]!;
    const report = async (items: unknown[]) => {
      await t.ctx.db.query("insert into drift_reports (org_id, document_id, version_id, report, counts) select $1, $2, head_version_id, $3, '{}' from documents where id = $2 on conflict (document_id) do update set report = excluded.report, updated_at = now()", [doc.org_id, doc.id, JSON.stringify({ items, counts: {} })]);
      return reworkDocument(t.ctx.db, doc.org_id, doc.id);
    };
    expect(await report([{ kind: 'declared-not-observed', nodeId: 'cache', bind: 'kubectl:deployment:shop/cache' }])).toEqual([]);
    expect(await stateOf(s, 'PLAN-1')).toBe('planned');
    expect(await report([])).toEqual(['PLAN-1']);
    expect(await stateOf(s, 'PLAN-1')).toBe('shipped');
    await put(t.ctx, p, { kind: 'PLAN', title: 'The API is declared only' }, 'r2');
    await link(t.ctx, p, 'PLAN-2', { rel: 'proof', target: `${ws.slug}/shop#api` }, 'l2');
    await report([]);
    expect(await stateOf(s, 'PLAN-2')).toBe('planned');
    const [card] = await get(t.ctx, p, ['PLAN-2']);
    if (!card || !('card' in card)) throw new Error('no card');
    expect(card.card.proof).toContain('bound to nothing a connector reads');
  });

  test('a Markdown roadmap comes in once, a done row comes in reported, and the Work tab shows it as a board', async () => {
    const s = await seeded();
    const { t, p, ws } = s;
    const md = ['# Platform roadmap', '', '| Outcome | Horizon | Owner | Status |', '|---|---|---|---|', '| Prices answer from a cache | Now | platform | in progress |', '| One sign-in for every tool | Next | identity | |', '| Old reports retired | Later | data | Done |'].join('\n');
    expect((await importRoadmap(t.ctx, p, 'PLAN', md, true))[0]).toBe('would make PLAN item: Prices answer from a cache (now)');
    const lines = await importRoadmap(t.ctx, p, 'PLAN', md, false);
    expect(lines[0]).toBe('created PLAN-1: Prices answer from a cache (Planned)');
    expect(lines[2]).toContain('PLAN-3 moved planned → reported (report done)');
    expect((await importRoadmap(t.ctx, p, 'PLAN', md, false)).every((l) => l.startsWith('created') || l.includes('moved'))).toBe(true);
    expect(Number((await t.ctx.db.query<{ n: number }>("select count(*)::int as n from items i join item_kinds k on k.id = i.kind_id where k.prefix = 'PLAN'"))[0]!.n)).toBe(3);
    const bullets = parseRoadmap('## Now\n\n- [x] Ship the cache\n- Read through it\n\n## Later\n\n- Retire the old API');
    expect(bullets.map((r) => `${r.horizon}:${r.done}:${r.title}`)).toEqual(['now:true:Ship the cache', 'now:false:Read through it', 'later:false:Retire the old API']);
    const me = await t.bearer('author');
    const board = await (await t.app.request(`/w/${ws.slug}?tab=work&kind=PLAN`, { headers: me.headers })).text();
    expect(board).toContain('class="work-board"');
    expect(board).toMatch(/Now<span class="n">1<\/span>/);
    expect(board).toContain('Reported done');
  });

  test('a document\'s plan lists the items a reader may see that add, change, or retire its boxes, and a lifecycle view counts its states', async () => {
    const s = await seeded();
    const { t, p, ws } = s;
    await put(t.ctx, p, { kind: 'PLAN', title: 'Add the cache', labels: { horizon: 'next' } }, 'r1');
    await link(t.ctx, p, 'PLAN-1', { rel: 'adds', target: `${ws.slug}/shop#cache` }, 'l1');
    await link(t.ctx, p, 'PLAN-1', { rel: 'changes', target: `${ws.slug}/shop#api` }, 'l2');
    const me = await t.bearer('author');
    const shop = (await t.ctx.db.query<{ id: string }>("select id from documents where slug = 'shop'"))[0]!.id;
    const plan = (await t.json(`/api/v1/documents/${shop}/plan`, { headers: me.headers })).body as { items: { key: string; horizon: string; effects: { rel: string; id: string }[] }[]; lifecycle?: unknown };
    expect(plan.items).toEqual([expect.objectContaining({ key: 'PLAN-1', horizon: 'next', effects: [{ rel: 'adds', id: 'cache' }, { rel: 'changes', id: 'api' }] })]);
    expect(plan.lifecycle).toBeUndefined();
    const stranger = await t.bearer('stranger');
    expect((await t.json(`/api/v1/documents/${shop}/plan`, { headers: stranger.headers })).status).toBe(404);
    const roadmapDoc = (await t.ctx.db.query<{ id: string }>("select document_id as id from item_kinds where prefix = 'PLAN'"))[0]!.id;
    expect(((await t.json(`/api/v1/documents/${roadmapDoc}/plan`, { headers: me.headers })).body as { lifecycle?: unknown }).lifecycle).toBeUndefined();
  });

  test('a ticket an outside tracker holds is proof: open while the connector reports it, done once it drops out', async () => {
    const s = await seeded();
    const { t, p, ws } = s;
    const wsId = (await t.ctx.db.query<{ id: string; org_id: string }>('select id, org_id from workspaces where slug = $1', [ws.slug]))[0]!;
    await t.ctx.db.query("insert into sources (id, org_id, name, connector, workspace_id, slug, client_id) values ('src1', $1, 'Jira', 'jira', $2, 'jira', 'jira-client')", [wsId.org_id, wsId.id]);
    await t.ctx.db.query("insert into observed_items (source_id, key, data, observed) values ('src1', 'jira:OPS-12@key:cache', $1, '2026-11-21T10:00:00Z')", [JSON.stringify({ id: 'OPS-12', status: 'In Progress' })]);
    await put(t.ctx, p, { kind: 'PLAN', title: 'Tracked in Jira' }, 'r1');
    expect((await link(t.ctx, p, 'PLAN-1', { rel: 'proof', target: `ticket:${ws.slug}/jira#OPS-12` }, 'l1')).line).toContain('by its proof, PLAN-1 moved');
    expect(await stateOf(s, 'PLAN-1')).toBe('building');
    expect((await link(t.ctx, p, 'PLAN-1', { rel: 'proof', target: `ticket:${ws.slug}/jira#OPS-99` }, 'l2').catch((e: Error) => e))).toBeInstanceOf(Error);
    await t.ctx.db.query("delete from observed_items where source_id = 'src1'");
    expect(await reworkSource(t.ctx.db, wsId.org_id, 'src1')).toEqual(['PLAN-1']);
    expect(await stateOf(s, 'PLAN-1')).toBe('shipped');
  });
});

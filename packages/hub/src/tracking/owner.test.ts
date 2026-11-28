/** A work item has one owner who answers for it and delegates it to agents, sits in a scope, and is reviewed by someone who did not work it (VAN-3024). */
import { describe, expect, test } from 'bun:test';
import { testApp } from '../testing.ts';
import { HttpError } from '../http.ts';
import { replaceScopes, setWorkspaceScope } from '../scopes/repo.ts';
import { createAgent } from '../auth/agents.ts';
import { board } from '../web/work-views.ts';
import { kindByPrefix } from './kinds.ts';
import { find, get } from './read.ts';
import { queue } from './queue.ts';
import { rebuild } from './store.ts';
import { hold, move, put } from './write.ts';
import { claim } from './work.ts';
import { findItem } from './access.ts';

const WORK = `title: Shop work
kind: { prefix: SW, name: Shop work, base: work-item }
views: []
`;

const scope = (id: string, parent?: string, steward?: string) => ({ id, name: id, kind: 'team', ...(parent ? { parent } : {}), ...(steward ? { steward } : {}), facets: [], profile: {} });

async function seeded() {
  const t = await testApp();
  const ada = await t.bearer('ada');
  const bob = await t.bearer('bob');
  const ws = ((await t.json('/api/v1/workspaces', { headers: ada.headers })).body['workspaces'] as { slug: string }[])[0]!;
  expect((await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: ada.headers, body: JSON.stringify({ yaml: WORK }) })).status).toBe(201);
  const wsId = (await t.ctx.db.query<{ id: string }>('select id from workspaces where slug = $1', [ws.slug]))[0]!.id;
  // Bob writes the workspace too.
  await t.ctx.db.query("insert into grants (id, org_id, workspace_id, subject_kind, subject_id, role) values ('g1', $1, $2, 'user', $3, 'author')", [ada.principal.orgId, wsId, bob.principal.userId]);
  await replaceScopes(t.ctx.db, ada.principal.orgId, 'hub', [scope('payments', undefined, 'bob@example.com'), scope('checkout', 'payments', 'person:ada@example.com'), scope('ledger')]);
  return { t, ada, bob, ws, wsId };
}

const refusal = (run: Promise<unknown>): Promise<HttpError> => run.then(() => { throw new Error('not refused'); }, (e: unknown) => e as HttpError);
const card = async (t: Awaited<ReturnType<typeof seeded>>['t'], p: Awaited<ReturnType<typeof seeded>>['ada']['principal'], key: string) => {
  const [c] = await get(t.ctx, p, [key]);
  if (!c || !('card' in c)) throw new Error(`no card for ${key}`);
  return c.card;
};

describe('owner, delegation, and scope', () => {
  test("a new item serves its workspace's scope and takes the scope's steward as owner; one it names is checked against the tree", async () => {
    const { t, ada, bob, wsId } = await seeded();
    await setWorkspaceScope(t.ctx.db, ada.principal.orgId, wsId, 'payments');
    await put(t.ctx, ada.principal, { kind: 'SW', title: 'Settle the payouts' }, 'p1');
    expect(await card(t, ada.principal, 'SW-1')).toMatchObject({ scope: 'payments', owner: 'bob@example.com' });
    await put(t.ctx, ada.principal, { kind: 'SW', title: 'Price the basket', scope: 'checkout' }, 'p2');
    expect(await card(t, ada.principal, 'SW-2')).toMatchObject({ scope: 'checkout', owner: 'ada@example.com' });
    await put(t.ctx, ada.principal, { kind: 'SW', title: 'Mine anyway', scope: 'checkout', owner: 'bob@example.com' }, 'p3');
    expect((await card(t, ada.principal, 'SW-3')).owner).toBe('bob@example.com');
    expect((await refusal(put(t.ctx, ada.principal, { kind: 'SW', title: 'Nowhere', scope: 'marketing' }, 'p4'))).message).toContain('no scope marketing in the scope tree');
    expect((await refusal(put(t.ctx, ada.principal, { item: 'SW-1', scope: 'marketing' }, 'p5'))).status).toBe(400);
    expect((await put(t.ctx, ada.principal, { item: 'SW-1', scope: 'ledger' }, 'p6')).line).toBe('saved SW-1 (scope)');
    void bob;
  });

  test('assigning sets the owner and delegating hands the item to agents, each an event the rebuild folds the same', async () => {
    const { t, ada, bob } = await seeded();
    await put(t.ctx, ada.principal, { kind: 'SW', title: 'Cache the prices' }, 'p1');
    expect((await card(t, ada.principal, 'SW-1')).owner).toBeNull();
    expect((await refusal(put(t.ctx, ada.principal, { item: 'SW-1', delegate: true }, 'd0'))).message).toContain('has no owner');
    expect((await put(t.ctx, ada.principal, { item: 'SW-1', owner: 'bob@example.com' }, 'a1')).line).toBe('saved SW-1 (owner)');
    // Only the owner delegates.
    expect((await refusal(put(t.ctx, ada.principal, { item: 'SW-1', delegate: true }, 'd1'))).status).toBe(403);
    expect((await put(t.ctx, bob.principal, { item: 'SW-1', delegate: true }, 'd2')).line).toBe('saved SW-1 (delegated)');
    expect((await card(t, ada.principal, 'SW-1')).delegated).toBe('to agents of bob@example.com, by bob@example.com');
    // A new owner ends the old owner's delegation.
    expect((await put(t.ctx, ada.principal, { item: 'SW-1', owner: 'me' }, 'a2')).line).toBe('saved SW-1 (owner, delegation taken back)');
    const laptop = await createAgent(t.ctx.db, { orgId: ada.principal.orgId, userId: ada.principal.userId, name: 'claude-code', client: 'claude-code', host: 'laptop-1' });
    expect((await put(t.ctx, ada.principal, { item: 'SW-1', delegate: 'claude-code on laptop-1' }, 'd3')).line).toBe('saved SW-1 (delegated)');
    expect((await card(t, ada.principal, 'SW-1')).delegated).toBe('to claude-code on laptop-1 for ada@example.com, by ada@example.com');
    const history = await t.ctx.db.query<{ type: string }>("select e.type from item_events e join items i on i.id = e.item_id where i.key = 'SW-1' order by e.position");
    expect(history.map((h) => h.type)).toEqual(['created', 'assigned', 'delegated', 'assigned', 'delegated', 'delegated']);
    const { folded, stored } = await rebuild(t.ctx.db, (await findItem(t.ctx, ada.principal, 'SW-1')).item.id);
    expect(folded).toEqual(stored);
    expect(stored?.delegate).toEqual({ agentId: laptop.id, userId: ada.principal.userId, by: ada.principal.userId });
  });

  test("the queue offers only what an owner delegated: to the owner's agents, or to the one agent named", async () => {
    const { t, ada } = await seeded();
    const one = await createAgent(t.ctx.db, { orgId: ada.principal.orgId, userId: ada.principal.userId, name: 'one', client: 'vantage' });
    const two = await createAgent(t.ctx.db, { orgId: ada.principal.orgId, userId: ada.principal.userId, name: 'two', client: 'vantage' });
    const asOne = { ...ada.principal, agent: { id: one.id, label: 'one' } };
    const asTwo = { ...ada.principal, agent: { id: two.id, label: 'two' } };
    await put(t.ctx, ada.principal, { kind: 'SW', title: 'Kept', owner: 'me' }, 'p1');
    await put(t.ctx, ada.principal, { kind: 'SW', title: 'For any of mine', owner: 'me', delegate: true }, 'p2');
    await put(t.ctx, ada.principal, { kind: 'SW', title: 'For one alone', owner: 'me', delegate: one.id }, 'p3');
    expect((await queue(t.ctx, asOne)).cards.map((c) => c.key)).toEqual(['SW-2', 'SW-3']);
    expect((await queue(t.ctx, asTwo)).cards.map((c) => c.key)).toEqual(['SW-2']);
    await put(t.ctx, ada.principal, { item: 'SW-2', delegate: false }, 'd1');
    expect((await queue(t.ctx, asTwo)).cards).toEqual([]);
  });

  test('the list verbs read by owner, by scope and the scopes under it, and by delegated', async () => {
    const { t, ada, bob } = await seeded();
    await put(t.ctx, ada.principal, { kind: 'SW', title: 'Payments work', scope: 'payments' }, 'p1');
    await put(t.ctx, ada.principal, { kind: 'SW', title: 'Checkout work', scope: 'checkout', owner: 'me', delegate: true }, 'p2');
    await put(t.ctx, ada.principal, { kind: 'SW', title: 'Ledger work', scope: 'ledger', owner: 'me' }, 'p3');
    const keys = async (q: Parameters<typeof find>[2]) => (await find(t.ctx, ada.principal, { kinds: ['SW'], ...q })).rows.map((r) => r.key).sort();
    expect(await keys({ owner: 'bob@example.com' })).toEqual(['SW-1']);
    expect(await keys({ owner: 'me' })).toEqual(['SW-2', 'SW-3']);
    expect(await keys({ scope: 'payments' })).toEqual(['SW-1', 'SW-2']);
    expect(await keys({ scope: 'checkout' })).toEqual(['SW-2']);
    expect(await keys({ delegated: true })).toEqual(['SW-2']);
    expect(await keys({ delegated: false })).toEqual(['SW-1', 'SW-3']);
    const http = await t.json('/api/v1/items?kind=SW&scope=payments&delegated=true', { headers: bob.headers });
    expect((http.body['rows'] as { key: string; owner?: string }[]).map((r) => [r.key, r.owner])).toEqual([['SW-2', 'ada@example.com']]);
    expect((await t.json('/api/v1/items?kind=SW&scope=marketing', { headers: bob.headers })).status).toBe(400);
  });

  test('the card and the board show the owner, the delegation, and the live run', async () => {
    const { t, ada, ws } = await seeded();
    await put(t.ctx, ada.principal, { kind: 'SW', title: 'Cache the prices', owner: 'me', delegate: true }, 'p1');
    const laptop = await createAgent(t.ctx.db, { orgId: ada.principal.orgId, userId: ada.principal.userId, name: 'claude-code', client: 'claude-code', host: 'laptop-1' });
    await claim(t.ctx, { ...ada.principal, agent: { id: laptop.id, label: 'claude-code on laptop-1' } }, 'SW-1', undefined, 'c1');
    const c = await card(t, ada.principal, 'SW-1');
    expect(c.owner).toBe('ada@example.com');
    expect(c.delegated).toBe('to agents of ada@example.com, by ada@example.com');
    expect(c.claim).toMatch(/^claude-code on laptop-1 for ada@example.com until /);
    const rows = (await find(t.ctx, ada.principal, { kinds: ['SW'] })).rows;
    expect(rows[0]).toMatchObject({ owner: 'ada@example.com' });
    expect(rows[0]!.run).toMatch(/^claude-code on laptop-1 for ada@example.com until /);
    const kind = (await kindByPrefix(t.ctx.db, ada.principal.orgId, 'SW'))!;
    const html = board({ slug: ws.slug } as Parameters<typeof board>[0], kind, rows, new Map(), false);
    expect(html).toContain('owner ada@example.com');
    expect(html).toContain('Live run');
    const page = await (await t.app.request(`/w/${ws.slug}/work/SW-1`, { headers: ada.headers })).text();
    expect(page).toContain('Delegated');
    expect(page).toContain('Working now');
  });

  test('review is by someone other than the worker: the shipped approve refuses whoever held the item, and agents acting for them', async () => {
    const { t, ada, bob } = await seeded();
    await put(t.ctx, bob.principal, { kind: 'SW', title: 'Cache the prices' }, 'p1');
    await move(t.ctx, ada.principal, 'SW-1', { to: 'doing' }, 'm1');
    await hold(t.ctx, ada.principal, 'SW-1', 'me', 'h1');
    await move(t.ctx, ada.principal, 'SW-1', { to: 'review', note: 'Ready.' }, 'm2');
    const asAgent = { ...ada.principal, agent: { id: 'agt_x', label: 'claude-code' } };
    for (const who of [ada.principal, asAgent]) expect((await refusal(move(t.ctx, who, 'SW-1', { to: 'done' }, `x${who === ada.principal ? 1 : 2}`))).message).toContain('a review by someone other than the worker');
    // Bob asked for it, and approval never goes to the asker; a third author who did not work it approves.
    const cy = await t.bearer('cy');
    await t.ctx.db.query("insert into grants (id, org_id, workspace_id, subject_kind, subject_id, role) select 'g2', org_id, workspace_id, 'user', $1, 'author' from grants where id = 'g1'", [cy.principal.userId]);
    expect((await move(t.ctx, cy.principal, 'SW-1', { to: 'done' }, 'm3')).line).toBe('SW-1 moved review → done (approve)');
  });
});

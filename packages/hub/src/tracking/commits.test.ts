import { describe, expect, test } from 'bun:test';
import { testApp } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';
import { findItem } from './access.ts';
import { get } from './read.ts';
import { hold, link, move, put } from './write.ts';

const WORK = `title: Shop work
kind: { prefix: SW, name: Shop work, base: work-item }
views: []
`;
const PLAN = `title: Platform roadmap
kind: { prefix: PLAN, name: Platform roadmap, base: roadmap-item, parts: [SW] }
views: []
`;

const sha = (c: string): string => c.repeat(40);
const commit = (c: string, at: string, work: string[]) => ({ sha: sha(c), at, title: `change ${c}`, files: [{ path: `src/${c}.ts` }], work });

async function seeded() {
  const t = await testApp();
  const me = await t.bearer('author', { admin: true });
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
  for (const yaml of [WORK, PLAN]) expect((await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml }) })).status).toBe(201);
  const created = await t.json(`/api/v1/workspaces/${ws.slug}/connectors`, { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'Shop code', slug: 'shop-code', connector: 'push', clientId: 'c-git' }) });
  const sourceId = created.body['id'] as string;
  const push = async (commits: unknown[]): Promise<void> => {
    const res = await t.json(`/api/v1/connector/${sourceId}/batches`, { method: 'POST', headers: await t.connector('c-git'), body: JSON.stringify({ partial: true, entities: [], changes: [{ repository: 'gitlab.example.com/acme/platform/shop', branch: 'main', head: (commits.at(-1) as { sha: string }).sha, commits }] }) });
    expect(res.status).toBe(202);
    await createWorker(t.ctx).drain();
  };
  return { t, p: me.principal, push, sourceId };
}

describe('a commit names its item, and the hub links it as proof', () => {
  test('a Work trailer links the commit once, with its repository, hash, and time, and puts a roadmap item under way', async () => {
    const { t, p, push } = await seeded();
    await put(t.ctx, p, { kind: 'PLAN', title: 'Prices answer from a cache' }, 'r1');
    const first = commit('a', '2026-11-01T10:00:00Z', ['PLAN-1']);
    await push([first]);
    let plan = (await findItem(t.ctx, p, 'PLAN-1')).item;
    expect(plan.state).toBe('building');
    expect(plan.links.filter((l) => l.rel === 'proof').map((l) => l.target)).toEqual([`commit:gitlab.example.com/acme/platform/shop@${sha('a')}@2026-11-01T10:00:00Z`]);
    const [card] = await get(t.ctx, p, ['PLAN-1']);
    if (!card || !('card' in card)) throw new Error('no card');
    expect(card.card.proof).toBe('1 commit landed; newest 2026-11-01');

    // The connector reads the same commit again on its next run, beside a new one: only the new one is linked.
    await push([first, commit('b', '2026-11-02T10:00:00Z', ['PLAN-1'])]);
    plan = (await findItem(t.ctx, p, 'PLAN-1')).item;
    expect(plan.links.filter((l) => l.rel === 'proof')).toHaveLength(2);
    const linked = await t.ctx.db.query<{ actor_kind: string }>("select e.actor_kind from item_events e join items i on i.id = e.item_id where i.key = 'PLAN-1' and e.type = 'linked'");
    expect(linked.map((e) => e.actor_kind)).toEqual(['system', 'system']);
    await t.ctx.db.close();
  });

  test('a key no item has is reported on the run, never guessed', async () => {
    const { t, push, sourceId } = await seeded();
    await push([commit('c', '2026-11-03T10:00:00Z', ['PLAN-9'])]);
    const runs = await t.ctx.db.query<{ warnings: string[] }>('select warnings from source_runs where source_id = $1', [sourceId]);
    expect(runs.flatMap((r) => r.warnings)).toContain(`commit gitlab.example.com/acme/platform/shop@${sha('c').slice(0, 8)} names PLAN-9, which no item has`);
    expect(Number((await t.ctx.db.query<{ n: number }>("select count(*)::int as n from item_events where type = 'linked'"))[0]!.n)).toBe(0);
    await t.ctx.db.close();
  });

  test('a parent reads its parts: a part with a commit puts it under way, and commits never hold back a finished roadmap item', async () => {
    const { t, p, push } = await seeded();
    await put(t.ctx, p, { kind: 'PLAN', title: 'Prices answer from a cache' }, 'r1');
    await put(t.ctx, p, { kind: 'SW', title: 'Cache the price list', parent: 'PLAN-1' }, 'w1');
    await push([commit('d', '2026-11-04T10:00:00Z', ['SW-1'])]);
    expect((await findItem(t.ctx, p, 'SW-1')).item.state).toBe('open');
    expect((await findItem(t.ctx, p, 'PLAN-1')).item.state).toBe('building');

    await move(t.ctx, p, 'SW-1', { to: 'doing' }, 'm1');
    await hold(t.ctx, p, 'SW-1', 'me', 'h1');
    await move(t.ctx, p, 'SW-1', { to: 'done' }, 'm2');
    expect((await findItem(t.ctx, p, 'PLAN-1')).item.state).toBe('shipped');
    await t.ctx.db.close();
  });

  test('a commit is never named by hand', async () => {
    const { t, p } = await seeded();
    await put(t.ctx, p, { kind: 'PLAN', title: 'Prices answer from a cache' }, 'r1');
    await expect(link(t.ctx, p, 'PLAN-1', { rel: 'proof', target: `commit:github.com/acme/shop@${sha('e')}@2026-11-01T00:00:00Z` }, 'l1')).rejects.toThrow('Work: <KEY> trailer');
    await t.ctx.db.close();
  });
});

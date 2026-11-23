/**
 * The proofs the tracking records name in their Verification sections:
 * docs/decisions 2004, 3005, 3006, 3007, 3008, and 5001.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agent } from '../mcp/testing.ts';
import { testApp, testContext, testUser } from '../testing.ts';
import { apiRoutes } from '../api/index.ts';
import { connectPostgres } from '../db/postgres.ts';
import { migrate } from '../db/migrate.ts';
import { silentLogger } from '../log.ts';
import { saveDocument } from '../documents/save.ts';
import { personalWorkspace } from '../text/things.ts';
import { HttpError } from '../http.ts';
import { changes, get } from './read.ts';
import { claim, move, note, put } from './write.ts';

const REQUESTS = `title: Requests
kind:
  prefix: REQ
  name: Requests
  roles:
    approver: [boss@example.com]
  lifecycle: flow
views:
  - id: flow
    kind: lifecycle
    title: How a request moves
    states:
      - { id: asked, text: Asked, class: not-started }
      - { id: approved, text: Approved, class: in-progress }
      - { id: done, text: Done, class: done }
      - { id: declined, text: Declined, class: parked }
    moves:
      - { from: asked, to: approved, label: approve, who: [approver], approval: true }
      - { from: asked, to: declined, label: decline, who: [approver], needs: [note] }
      - { from: approved, to: done, label: finish, who: [holder] }
`;

async function seeded() {
  const t = await testApp();
  const me = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
  expect((await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: REQUESTS }) })).status).toBe(201);
  const boss = await t.bearer('boss');
  const stranger = await t.bearer('stranger');
  return { t, me, boss, stranger, ws };
}

const CONTRACT = join(import.meta.dir, 'contract.json');

describe('the proofs the tracking records name', () => {
  test('5001: a released verb keeps its request shape; a change fails here until the contract is moved on purpose', async () => {
    const t = await testApp();
    const shape = apiRoutes(t.ctx)
      .routes.filter((r) => r.tag === 'items')
      .map((r) => ({ method: r.method, path: r.path, params: r.params ?? [], query: r.query ?? [], body: Object.keys(r.body ?? {}) }));
    if (process.env['VANTAGE_WRITE_CONTRACT'] === '1') writeFileSync(CONTRACT, `${JSON.stringify(shape, null, 2)}\n`);
    expect(shape).toEqual(JSON.parse(readFileSync(CONTRACT, 'utf8')));
  });

  test('3007: every write route sent twice with one key writes one event and answers the same', async () => {
    const { t, me } = await seeded();
    const h = me.headers;
    const twice = async (key: string, path: string, method: string, body: unknown, raw?: Uint8Array) => {
      const send = () => t.app.request(path, { method, headers: { ...h, 'idempotency-key': key, ...(raw ? { 'content-type': 'text/plain' } : { 'content-type': 'application/json' }) }, body: raw ? Buffer.from(raw) : JSON.stringify(body) });
      const a = await (await send()).json();
      const b = await (await send()).json();
      expect(b.line).toBe(a.line);
      expect(b.status).toBe('repeat');
    };
    await twice('w1', '/api/v1/items', 'PUT', { kind: 'REQ', title: 'Once' });
    await twice('w2', '/api/v1/items', 'PUT', { item: 'REQ-1', title: 'Once, renamed' });
    await twice('w3', '/api/v1/items/REQ-1/hold', 'POST', { person: 'me' });
    await twice('w4', '/api/v1/items/REQ-1/release', 'POST', {});
    await twice('w5', '/api/v1/items/REQ-1/notes', 'POST', { text: 'a note' });
    await twice('w6', '/api/v1/items/REQ-1/files?name=proof.txt', 'POST', undefined, new TextEncoder().encode('proof'));
    await twice('w7', '/api/v1/items', 'PUT', { kind: 'REQ', title: 'Another' });
    await twice('w8', '/api/v1/items/REQ-2/links', 'POST', { rel: 'came-from', target: 'REQ-1' });
    const boss = await t.bearer('boss');
    const moveTwice = async () => (await t.app.request('/api/v1/items/REQ-2/move', { method: 'POST', headers: { ...boss.headers, 'idempotency-key': 'w9', 'content-type': 'application/json' }, body: JSON.stringify({ to: 'approved' }) })).json();
    expect((await moveTwice()).status).toBe('done');
    expect((await moveTwice()).status).toBe('repeat');
    const events = await t.ctx.db.query<{ n: number }>('select count(*)::int as n from item_events');
    // created, changed, held, released, noted, attached, created, linked, moved
    expect(Number(events[0]!.n)).toBe(9);
  });

  test('2004: on every read path a named person sees their item and nothing else, and a person named nowhere sees nothing', async () => {
    const { t, me, boss, stranger } = await seeded();
    await put(t.ctx, me.principal, { kind: 'REQ', title: 'Waits for the boss: disk' }, 'k1');
    await put(t.ctx, me.principal, { kind: 'REQ', title: 'Moved past the boss: memory' }, 'k2');
    await move(t.ctx, boss.principal, 'REQ-2', { to: 'approved' }, 'm1');
    const paths = async (who: typeof boss) => {
      const list = (await t.json('/api/v1/items?kind=REQ', { headers: who.headers })).body as { rows: { key: string }[]; total: number };
      const search = (await t.json('/api/v1/items?q=disk', { headers: who.headers })).body as { rows: { key: string }[] };
      const count = (await t.json('/api/v1/items?count=kind', { headers: who.headers })).body as { counts: Record<string, number> };
      const feed = (await t.json('/api/v1/changes', { headers: who.headers })).body as { changes: { item: string }[] };
      const got = await Promise.all(['REQ-1', 'REQ-2'].map(async (k) => (await t.app.request(`/api/v1/items/${k}`, { headers: who.headers })).status));
      const tool = await (await agent(t, who.headers)).attempt('vantage_read', { addresses: ['REQ-1', 'REQ-2'] });
      const outline = await (await agent(t, who.headers)).attempt('vantage_outline', { address: 'REQ' });
      const page = await t.app.request('/w/x/work/REQ-2', { headers: who.headers });
      return { list: list.rows.map((r) => r.key), total: list.total, search: search.rows.map((r) => r.key), count: count.counts, feed: [...new Set(feed.changes.map((c) => c.item))], got, tool: tool.text, outline: outline.text, page: page.status };
    };
    const b = await paths(boss);
    expect(b.list).toEqual(['REQ-1']);
    expect(b.total).toBe(1);
    expect(b.search).toEqual(['REQ-1']);
    expect(b.count).toEqual({ REQ: 1 });
    expect(b.feed).toEqual(['REQ-1']);
    expect(b.got).toEqual([200, 404]);
    expect(b.tool).toContain('=== REQ-1');
    expect(b.tool).toContain('no item REQ-2');
    expect(b.outline).toContain('REQ-1');
    expect(b.outline).not.toContain('REQ-2');
    expect(b.page).toBe(404);
    const s = await paths(stranger);
    expect(s.list).toEqual([]);
    expect(s.search).toEqual([]);
    expect(s.count).toEqual({});
    expect(s.feed).toEqual([]);
    expect(s.got).toEqual([404, 404]);
    expect(s.tool).not.toContain('Waits for the boss');
    expect(s.page).toBe(404);
  });

  test('3005: an item with a thousand events reads as a card the size of one with one', async () => {
    const { t, me } = await seeded();
    await put(t.ctx, me.principal, { kind: 'REQ', title: 'Quiet' }, 'q');
    await put(t.ctx, me.principal, { kind: 'REQ', title: 'Loud' }, 'l');
    for (let i = 0; i < 999; i++) await note(t.ctx, me.principal, 'REQ-2', `note ${i}`, `n${i}`);
    const [quiet, loud] = await get(t.ctx, me.principal, ['REQ-1', 'REQ-2']);
    if (!quiet || !loud || !('card' in quiet) || !('card' in loud)) throw new Error('no cards');
    expect(loud.card.counts.events).toBe(1000);
    // Only the digits of the counts and the version differ.
    expect(Math.abs(JSON.stringify(loud.card).length - JSON.stringify(quiet.card).length)).toBeLessThan(16);
  }, 120_000);

  test('3008: the gate refuses every move the lifecycle does not draw, and one of the moves a refusal names goes through', async () => {
    const { t, me, boss } = await seeded();
    // The boss writes the workspace too, so an item the boss moved stays in sight.
    await t.ctx.db.query("insert into grants (id, org_id, workspace_id, subject_kind, subject_id, role) select 'g1', org_id, id, 'user', $1, 'author' from workspaces where owner_user_id = $2", [boss.principal.userId, me.principal.userId]);
    const states = ['asked', 'approved', 'done', 'declined'];
    const drawn = new Set(['asked>approved', 'asked>declined', 'approved>done']);
    let n = 0;
    for (const from of states) {
      for (const to of states) {
        if (from === to || drawn.has(`${from}>${to}`)) continue;
        n++;
        const key = `REQ-${n}`;
        await put(t.ctx, me.principal, { kind: 'REQ', title: `From ${from}` }, `p${n}`);
        if (from !== 'asked') await move(t.ctx, boss.principal, key, { to: from === 'done' ? 'approved' : from, note: 'set up' }, `s${n}`);
        if (from === 'done') {
          await t.ctx.db.query("update items set holders = $2 where key = $1", [key, JSON.stringify([boss.principal.userId])]);
          await move(t.ctx, boss.principal, key, { to: 'done' }, `d${n}`);
        }
        const err = await move(t.ctx, boss.principal, key, { to, note: 'try' }, `t${n}`).then(() => undefined, (e: unknown) => e);
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).message).toContain(`draws no move from ${from} to ${to}`);
      }
    }
    expect(n).toBe(9);
    await put(t.ctx, me.principal, { kind: 'REQ', title: 'Decline me' }, 'x');
    const refused = await move(t.ctx, boss.principal, 'REQ-10', { to: 'done' }, 'x1').then(() => undefined, (e: unknown) => e as HttpError);
    const open = (refused!.details!['open'] as { to: string; needs: string[] }[]).find((o) => o.needs.includes('note'))!;
    expect((await move(t.ctx, boss.principal, 'REQ-10', { to: open.to, note: 'not this quarter' }, 'x2')).line).toBe('REQ-10 moved asked → declined (decline)');
  });
});

const url = process.env['VANTAGE_TEST_DATABASE_URL'];

describe.if(Boolean(url))('3006 on a real Postgres', () => {
  test('with writers on several connections, a feed reader that carries on from its bookmark never skips an event', async () => {
    const base = await testContext();
    const db = connectPostgres(url!, silentLogger, { max: 12 });
    await db.exec('drop schema public cascade; create schema public;');
    await migrate(db, silentLogger);
    const ctx = { ...base, db, dbRead: db };
    const me = (await testUser(ctx, 'author')).principal;
    const ws = await personalWorkspace(ctx, me, 'author');
    await saveDocument(ctx, { orgId: me.orgId, workspaceId: ws.id, yaml: REQUESTS, authorUserId: me.userId, who: me.userId, surface: 'api' });
    const writers = 8;
    for (let w = 0; w < writers; w++) await put(ctx, me, { kind: 'REQ', title: `Writer ${w}` }, `c${w}`);
    const seen: number[] = [];
    let bookmark = 0;
    let writing = true;
    const reader = (async () => {
      while (writing || seen.length < writers * 26) {
        const r = await changes(ctx, me, { after: bookmark, limit: 7 });
        for (const c of r.changes) seen.push(c.position);
        bookmark = r.next;
        if (!writing && !r.changes.length) break;
      }
    })();
    await Promise.all(Array.from({ length: writers }, async (_, w) => {
      for (let i = 0; i < 25; i++) await note(ctx, me, `REQ-${w + 1}`, `note ${i}`, `w${w}-${i}`);
    }));
    writing = false;
    await reader;
    const all = (await db.query<{ position: string }>('select position from item_events order by position')).map((r) => Number(r.position));
    expect(seen).toEqual(all);
    await db.close();
  }, 120_000);

  test('3010: agents on separate connections race for one item, and exactly one claim holds', async () => {
    const base = await testContext();
    const db = connectPostgres(url!, silentLogger, { max: 12 });
    await db.exec('drop schema public cascade; create schema public;');
    await migrate(db, silentLogger);
    const ctx = { ...base, db, dbRead: db };
    const me = (await testUser(ctx, 'author')).principal;
    const ws = await personalWorkspace(ctx, me, 'author');
    await saveDocument(ctx, { orgId: me.orgId, workspaceId: ws.id, yaml: REQUESTS, authorUserId: me.userId, who: me.userId, surface: 'api' });
    await put(ctx, me, { kind: 'REQ', title: 'Wanted by everyone' }, 'k');
    const agents = await Promise.all(Array.from({ length: 8 }, async (_, i) => {
      const a = (await testUser(ctx, `agent-${i}`)).principal;
      await db.query("insert into grants (id, org_id, workspace_id, subject_kind, subject_id, role) values ($1, $2, $3, 'user', $4, 'author')", [`g${i}`, me.orgId, ws.id, a.userId]);
      return a;
    }));
    const results = await Promise.allSettled(agents.map((a, i) => claim(ctx, a, 'REQ-1', undefined, `race-${i}`)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const claims = await db.query<{ n: number }>("select count(*)::int as n from item_events where type = 'claimed'");
    expect(Number(claims[0]!.n)).toBe(1);
    await db.close();
  }, 120_000);
});

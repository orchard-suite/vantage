import { describe, expect, test } from 'bun:test';
import { testApp, testUser } from '../testing.ts';
import type { Principal } from '../auth/principal.ts';
import { HttpError } from '../http.ts';
import { findItem } from './access.ts';
import { changes, find, get } from './read.ts';
import { rebuild } from './store.ts';
import { hold, link, move, note, put } from './write.ts';

const REQUESTS = `title: Requests
kind:
  prefix: REQ
  name: Requests
  labels:
    - { name: area, type: choice, choices: [api, web] }
    - { name: points, type: number }
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
  const saved = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: REQUESTS }) });
  expect(saved.status).toBe(201);
  const boss = (await testUser(t.ctx, 'boss')).principal;
  const stranger = (await testUser(t.ctx, 'stranger')).principal;
  return { t, me: me.principal, ws, boss, stranger, headers: me.headers };
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

describe('tracked items', () => {
  test('saving a document with a kind block makes the kind, and its prefix is one no registry may take', async () => {
    const { t, ws, headers } = await seeded();
    const reg = await t.json(`/api/v1/workspaces/${ws.slug}/registries`, { method: 'POST', headers, body: JSON.stringify({ prefix: 'REQ', name: 'Clash' }) });
    expect(reg.status).toBe(409);
    const clash = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers, body: JSON.stringify({ yaml: REQUESTS.replace('title: Requests', 'title: Again') }) });
    expect(clash.status).toBe(400);
    expect(JSON.stringify(clash.body)).toContain('taken');
  });

  test('put makes an item that starts where its lifecycle starts, and a write sent twice answers once', async () => {
    const { t, me } = await seeded();
    const a = await put(t.ctx, me, { kind: 'REQ', title: 'A new api key', labels: { area: 'api', points: 3 } }, 'k1');
    expect(a.line).toBe('created REQ-1: A new api key (Asked)');
    const again = await put(t.ctx, me, { kind: 'REQ', title: 'A new api key', labels: { area: 'api', points: 3 } }, 'k1');
    expect(again).toEqual({ status: 'repeat', line: a.line, key: 'REQ-1' });
    expect((await find(t.ctx, me, { kinds: ['REQ'] })).total).toBe(1);
    expect((await refused(put(t.ctx, me, { kind: 'REQ', title: 'Bad', labels: { area: 'mobile' } }, 'k2'))).message).toContain('one of api, web');
    expect((await refused(put(t.ctx, me, { kind: 'REQ', title: 'Bad', labels: { nested: 'x' } }, 'k3'))).message).toContain('no label nested');
    const changed = await put(t.ctx, me, { item: 'REQ-1', labels: { points: 5 } }, 'k4');
    expect(changed.line).toBe('saved REQ-1 (labels)');
    expect((await put(t.ctx, me, { item: 'REQ-1', labels: { points: 5 } }, 'k5')).status).toBe('unchanged');
  });

  test('the gate refuses every move the lifecycle does not draw, and names the moves that are open', async () => {
    const { t, me, boss } = await seeded();
    await put(t.ctx, me, { kind: 'REQ', title: 'More disk' }, 'k1');
    const notDrawn = await refused(move(t.ctx, me, 'REQ-1', { to: 'done' }, 'm1'));
    expect(notDrawn.status).toBe(409);
    expect(notDrawn.message).toContain('draws no move from asked to done');
    const own = await refused(move(t.ctx, me, 'REQ-1', { to: 'approved' }, 'm2'));
    expect(own.message).toContain('never approves');
    const coauthor = (await testUser(t.ctx, 'coauthor')).principal;
    await t.ctx.db.query("insert into grants (id, org_id, workspace_id, subject_kind, subject_id, role) values ('g2', $1, $2, 'user', $3, 'author')", [me.orgId, (await findItem(t.ctx, me, 'REQ-1')).item.workspaceId, coauthor.userId]);
    const notYours = await refused(move(t.ctx, coauthor, 'REQ-1', { to: 'approved' }, 'm5'));
    expect(notYours.message).toContain('is for approver');
    const needsNote = await refused(move(t.ctx, boss, 'REQ-1', { to: 'declined' }, 'm3'));
    expect(needsNote.message).toContain('needs a note');
    expect(needsNote.message).toContain('approve → approved');
    expect((await move(t.ctx, boss, 'REQ-1', { to: 'approved' }, 'm4')).line).toBe('REQ-1 moved asked → approved (approve)');
  });

  test('the person who asked never approves, even when a role names them', async () => {
    const { t, boss, ws, headers } = await seeded();
    // The boss writes the workspace too, so the boss may ask.
    await t.ctx.db.query("insert into grants (id, org_id, workspace_id, subject_kind, subject_id, role) select 'g1', org_id, id, 'user', $2, 'author' from workspaces where slug = $1", [ws.slug, boss.userId]);
    expect(headers).toBeDefined();
    await put(t.ctx, boss, { kind: 'REQ', title: 'My own raise' }, 'k1');
    const own = await refused(move(t.ctx, boss, 'REQ-1', { to: 'approved' }, 'm1'));
    expect(own.message).toContain('never approves');
  });

  test('a person named on an item sees that item and nothing else; a person named nowhere sees nothing', async () => {
    const { t, me, boss, stranger } = await seeded();
    await put(t.ctx, me, { kind: 'REQ', title: 'Waits for the boss' }, 'k1');
    await put(t.ctx, me, { kind: 'REQ', title: 'Also waits' }, 'k2');
    await move(t.ctx, boss, 'REQ-2', { to: 'approved' }, 'm1');
    // REQ-1 waits on a move the boss's role makes, so it names the boss; REQ-2 has moved past it.
    expect((await find(t.ctx, boss, { kinds: ['REQ'] })).rows.map((r) => r.key)).toEqual(['REQ-1']);
    expect((await findItem(t.ctx, boss, 'REQ-1')).caller.role).toBeUndefined();
    expect((await refused(findItem(t.ctx, boss, 'REQ-2'))).status).toBe(404);
    expect((await find(t.ctx, stranger, { kinds: ['REQ'] })).total).toBe(0);
    expect((await refused(findItem(t.ctx, stranger, 'REQ-1'))).status).toBe(404);
    expect((await changes(t.ctx, stranger, {})).changes).toHaveLength(0);
    // Being named grants moves and no other write.
    expect((await refused(note(t.ctx, boss, 'REQ-1', 'a word', 'n1'))).status).toBe(403);
  });

  test('the state table folds from the events, and the feed only moves forward', async () => {
    const { t, me, boss } = await seeded();
    await put(t.ctx, me, { kind: 'REQ', title: 'Parent work', labels: { area: 'web' } }, 'k1');
    await move(t.ctx, boss, 'REQ-1', { to: 'approved' }, 'm1');
    await hold(t.ctx, me, 'REQ-1', 'me', 'h1');
    await note(t.ctx, me, 'REQ-1', 'Started on the web side.', 'n1');
    await put(t.ctx, me, { item: 'REQ-1', title: 'Parent work, renamed', labels: { points: 8 } }, 'k2');
    await move(t.ctx, me, 'REQ-1', { to: 'done' }, 'm2');
    const id = (await findItem(t.ctx, me, 'REQ-1')).item.id;
    const { folded, stored } = await rebuild(t.ctx.db, id);
    expect(folded).toEqual(stored!);
    expect(stored!.state).toBe('done');
    expect(stored!.notes).toBe(1);
    const feed = await changes(t.ctx, me, { limit: 3 });
    expect(feed.changes.map((c) => c.type)).toEqual(['created', 'moved', 'held']);
    const rest = await changes(t.ctx, me, { after: feed.next });
    expect(rest.changes.map((c) => c.type)).toEqual(['noted', 'changed', 'moved']);
    const positions = [...feed.changes, ...rest.changes].map((c) => c.position);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test('a card has a fixed size, names the moves open to the reader, and answers an item it holds as unchanged', async () => {
    const { t, me, boss } = await seeded();
    await put(t.ctx, me, { kind: 'REQ', title: 'Card' }, 'k1');
    for (let i = 0; i < 30; i++) await note(t.ctx, me, 'REQ-1', `note ${i} `.repeat(40), `n${i}`);
    const [first] = await get(t.ctx, boss, ['REQ-1']);
    if (!first || !('card' in first)) throw new Error('no card');
    expect(first.card.moves).toEqual(['approve → approved', 'decline → declined (needs note)']);
    expect(first.card.counts.notes).toBe(30);
    expect(JSON.stringify(first.card).length).toBeLessThan(1200);
    const [again] = await get(t.ctx, boss, ['REQ-1'], { 'REQ-1': first.card.version });
    expect(again).toEqual({ key: 'REQ-1', unchanged: first.card.version });
    const counts = await find(t.ctx, me, { countBy: 'state' });
    expect(counts.counts).toEqual({ asked: 1 });
  });

  test('a kind with items keeps its prefix and every state an item is in', async () => {
    const { t, me, ws, headers } = await seeded();
    await put(t.ctx, me, { kind: 'REQ', title: 'Pinned' }, 'k1');
    const doc = ((await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { headers })).body['documents'] as { slug: string }[])[0]!;
    const renamed = await t.json(`/api/v1/workspaces/${ws.slug}/documents/${doc.slug}`, { method: 'PUT', headers, body: JSON.stringify({ yaml: REQUESTS.replace('prefix: REQ', 'prefix: ASK') }) });
    expect(renamed.status).toBe(400);
    expect(JSON.stringify(renamed.body)).toContain('never changes');
    const withoutAsked = REQUESTS.replace('      - { id: asked, text: Asked, class: not-started }\n', '')
      .replace('      - { from: asked, to: approved, label: approve, who: [approver], approval: true }\n', '')
      .replace('from: asked, to: declined', 'from: approved, to: declined');
    const dropped = await t.json(`/api/v1/workspaces/${ws.slug}/documents/${doc.slug}`, { method: 'PUT', headers, body: JSON.stringify({ yaml: withoutAsked }) });
    expect(dropped.status).toBe(400);
    expect(JSON.stringify(dropped.body)).toContain('are in state asked');
  });

  test('links name items, and an item is part of another only when its kind lists the part', async () => {
    const { t, me } = await seeded();
    await put(t.ctx, me, { kind: 'REQ', title: 'One' }, 'k1');
    await put(t.ctx, me, { kind: 'REQ', title: 'Two' }, 'k2');
    expect((await link(t.ctx, me, 'REQ-2', { rel: 'came-from', target: 'REQ-1' }, 'l1')).line).toBe('REQ-2 came-from REQ-1');
    expect((await refused(link(t.ctx, me, 'REQ-2', { rel: 'part-of', target: 'REQ-1' }, 'l2'))).message).toContain('lists no kinds as its parts');
    expect((await link(t.ctx, me, 'REQ-2', { rel: 'waits-on', target: 'REQ-1' }, 'l3')).line).toBe('REQ-2 waits-on REQ-1');
    expect((await refused(link(t.ctx, me, 'REQ-2', { rel: 'waits-on', target: 'REQ-2' }, 'l4'))).message).toContain('cannot link to itself');
  });

  test('a kind that draws its own lifecycle sends each state\'s live count, counting only what the reader may see', async () => {
    const { t, me, headers, stranger } = await seeded();
    await put(t.ctx, me, { kind: 'REQ', title: 'One' }, 'k1');
    await put(t.ctx, me, { kind: 'REQ', title: 'Two' }, 'k2');
    const doc = (await t.ctx.db.query<{ id: string }>("select document_id as id from item_kinds where prefix = 'REQ'"))[0]!.id;
    const plan = (await t.json(`/api/v1/documents/${doc}/plan`, { headers })).body as { lifecycle: { view: string; prefix: string; counts: Record<string, number> } };
    expect(plan.lifecycle).toEqual({ view: 'flow', prefix: 'REQ', counts: { asked: 2 } });
    expect(stranger).toBeDefined();
  });
});

export type { Principal };
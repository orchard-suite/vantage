/** Modules through a port (VAN-2005, VAN-5001, VAN-3006): an app scoped to its kinds, a person acting through it, a kinds file from a pipeline, and a hard delete. */
import { describe, expect, test } from 'bun:test';
import { testApp, TEST_MODULE_ROLE } from '../testing.ts';
import { findItem } from './access.ts';
import { history } from './read.ts';
import { rebuild } from './store.ts';

const FORMS = `title: Forms
kind:
  prefix: FRM
  name: Form submissions
  owner: forms
  labels:
    - { name: job, type: text }
    - { name: amount, type: money }
  lifecycle: flow
views:
  - id: flow
    kind: lifecycle
    title: How a submission moves
    states:
      - { id: draft, text: Draft, class: not-started }
      - { id: submitted, text: Submitted, class: in-progress }
      - { id: approved, text: Approved, class: done }
    moves:
      - { from: draft, to: submitted, label: submit, who: [asker, author], needs: [revision] }
      - { from: submitted, to: approved, label: approve, who: [author], approval: true }
`;

async function seeded() {
  const t = await testApp();
  const admin = await t.bearer('admin', { admin: true });
  const ws = ((await t.json('/api/v1/workspaces', { headers: admin.headers })).body['workspaces'] as { slug: string }[])[0]!;
  const forms = await t.connector('forms-client', { roles: [TEST_MODULE_ROLE] });
  return { t, admin, ws, forms };
}

const send = (t: Awaited<ReturnType<typeof seeded>>['t'], path: string, method: string, headers: Record<string, string>, body: unknown, key?: string) =>
  t.json(path, { method, headers: { ...headers, ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) });

describe('modules through a port', () => {
  test('an app loads its kinds file from its pipeline only once an admin registers it, and only into its own workspace', async () => {
    const { t, admin, ws, forms } = await seeded();
    expect((await send(t, '/api/v1/kinds/FRM', 'PUT', forms, { yaml: FORMS })).status).toBe(403);
    expect((await send(t, '/api/v1/apps', 'POST', admin.headers, { clientId: 'forms-client', name: 'Forms', workspace: ws.slug, kinds: ['FRM'] })).status).toBe(200);
    const loaded = await send(t, '/api/v1/kinds/FRM', 'PUT', forms, { yaml: FORMS });
    expect(loaded.body['line']).toBe('made kind FRM');
    expect((await send(t, '/api/v1/kinds/FRM', 'PUT', forms, { yaml: FORMS })).body['line']).toBe('unchanged kind FRM');
    expect((await send(t, '/api/v1/kinds/OTHER', 'PUT', forms, { yaml: FORMS.replace('prefix: FRM', 'prefix: OTHER') })).status).toBe(403);
  });

  test('an app puts items of its kinds by its own key, reads them whole, and never makes a person\'s move', async () => {
    const { t, admin, ws, forms } = await seeded();
    await send(t, '/api/v1/apps', 'POST', admin.headers, { clientId: 'forms-client', name: 'Forms', workspace: ws.slug, kinds: ['FRM'] });
    await send(t, '/api/v1/kinds/FRM', 'PUT', forms, { yaml: FORMS });
    const made = await send(t, '/api/v1/items', 'PUT', forms, { kind: 'FRM', ref: 'forms/1842', title: 'Job 1842 estimate', labels: { job: '1842', amount: 1200 }, revision: 'r1' }, 'a1');
    expect(made.status).toBe(201);
    expect(made.body['key']).toBe('FRM-1');
    const read = await t.json(`/api/v1/items/${encodeURIComponent('FRM:forms/1842')}`, { headers: forms });
    expect((read.body['card'] as { asker: string | null }).asker).toBeNull();
    const refused = await send(t, '/api/v1/items/FRM-1/move', 'POST', forms, { to: 'submitted', revision: 'r1' }, 'a2');
    expect(refused.status).toBe(409);
    expect((await send(t, '/api/v1/items/FRM-1/hold', 'POST', forms, {}, 'a3')).status).toBe(403);
    const feed = await t.json('/api/v1/changes', { headers: forms });
    expect((feed.body['changes'] as { item: string; actorKind: string; surface: string }[]).map((c) => `${c.item}:${c.actorKind}:${c.surface}`)).toEqual(['FRM-1:app:app:forms-client']);
    // A person's move comes with the person's own token, and they need the revision the move pins.
    const person = await send(t, '/api/v1/items/FRM-1/move', 'POST', admin.headers, { to: 'submitted', revision: 'r1' }, 'a4');
    expect(person.body['line']).toBe('FRM-1 moved draft → submitted (submit)');
  });

  test('a person acts through the module with the token the issuer gave it for them, as themselves (VAN-2005, VAN-2006)', async () => {
    const { t, admin, ws, forms } = await seeded();
    await send(t, '/api/v1/apps', 'POST', admin.headers, { clientId: 'forms-client', name: 'Forms', workspace: ws.slug, kinds: ['FRM'] });
    await send(t, '/api/v1/kinds/FRM', 'PUT', forms, { yaml: FORMS });
    const known = await t.bearer('pat');
    await send(t, `/api/v1/workspaces/${ws.slug}/grants`, 'POST', admin.headers, { role: 'author', subjectKind: 'user', subjectId: known.principal.userId });
    const viaForms = await t.actingFor('forms-client', { oid: 'pat-oid', email: 'pat@example.com' });
    const made = await send(t, '/api/v1/items', 'PUT', viaForms, { kind: 'FRM', ref: 'forms/9', title: 'A laptop', revision: 'r1' }, 'p1');
    expect(made.status).toBe(201);
    const moved = await send(t, '/api/v1/items/FRM-1/move', 'POST', viaForms, { to: 'submitted', revision: 'r1' }, 'p2');
    expect(moved.body['line']).toBe('FRM-1 moved draft → submitted (submit)');
    const feed = (await t.json('/api/v1/changes', { headers: forms })).body['changes'] as { actor: string; actorKind: string; surface: string }[];
    expect(feed.map((c) => [c.actor, c.actorKind])).toEqual([['pat@example.com', 'person'], ['pat@example.com', 'person']]);
    expect(feed.every((c) => c.surface.includes('forms-client'))).toBe(true);
    expect((await t.ctx.db.query('select id from users where email = $1', ['pat@example.com'])).length).toBe(1);
  });

  test('an app sees only its own kinds', async () => {
    const { t, admin, ws, forms } = await seeded();
    await send(t, '/api/v1/apps', 'POST', admin.headers, { clientId: 'forms-client', name: 'Forms', workspace: ws.slug, kinds: ['FRM'] });
    await send(t, `/api/v1/workspaces/${ws.slug}/documents`, 'POST', admin.headers, { yaml: 'title: Work\nkind: { prefix: SW, name: Work, base: work-item }\nviews: []\n' });
    await send(t, '/api/v1/items', 'PUT', admin.headers, { kind: 'SW', title: 'Not the app\'s' }, 'w1');
    expect((await t.json('/api/v1/items/SW-1', { headers: forms })).status).toBe(404);
    expect(((await t.json('/api/v1/items?kind=SW', { headers: forms })).body as { total: number }).total).toBe(0);
    expect(((await t.json('/api/v1/changes', { headers: forms })).body as { changes: unknown[] }).changes).toHaveLength(0);
  });

  test('an erase blanks what the item said, keeps its history in order, and still folds', async () => {
    const { t, admin, ws } = await seeded();
    await send(t, `/api/v1/workspaces/${ws.slug}/documents`, 'POST', admin.headers, { yaml: 'title: Work\nkind: { prefix: SW, name: Work, base: work-item }\nviews: []\n' });
    await send(t, '/api/v1/items', 'PUT', admin.headers, { kind: 'SW', title: 'A person named Pat Example asked', body: 'Call Pat at home.' }, 'e1');
    await send(t, '/api/v1/items/SW-1/notes', 'POST', admin.headers, { text: 'Pat lives on Example Street.' }, 'e2');
    await send(t, '/api/v1/items/SW-1/move', 'POST', admin.headers, { to: 'doing' }, 'e3');
    const erased = await send(t, '/api/v1/items/SW-1', 'DELETE', admin.headers, { reason: 'the person asked to be forgotten' }, 'e4');
    expect(erased.body['line']).toBe('erased SW-1');
    const raw = JSON.stringify(await t.ctx.db.query('select data from item_events order by position'));
    expect(raw).not.toContain('Pat');
    expect(JSON.stringify(await t.ctx.db.query('select text from item_bodies'))).not.toContain('Pat');
    const item = (await findItem(t.ctx, admin.principal, 'SW-1')).item;
    expect(item.title).toBe('(erased)');
    expect(item.state).toBe('doing');
    const { folded, stored } = await rebuild(t.ctx.db, item.id);
    expect(folded).toEqual(stored!);
    expect((await history(t.ctx, await findItem(t.ctx, admin.principal, 'SW-1'))).lines[0]).toMatch(/: erased: the person asked to be forgotten$/);
    const member = await t.bearer('member');
    expect((await send(t, '/api/v1/items/SW-1', 'DELETE', member.headers, { reason: 'no' }, 'e5')).status).toBe(403);
  });
});

import { describe, expect, test } from 'bun:test';
import { testApp, type TestApp } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';
import { openCounts } from '../api/viewer.ts';
import type { CommentRow } from '../comments.ts';

const YAML = `title: Steerable
nodes:
  - name: Shoppers
    type: users
  - id: apps
    name: Apps
    children:
      - name: Web App # the front
        type: web
      - name: Orders API
        type: api
  - name: Orders DB
    type: database
relations:
  - { from: shoppers, to: web-app, label: buys, tags: [context] }
  - { from: web-app, to: orders-api, label: calls, tags: [context] }
  - { from: orders-api, to: orders-db, label: writes, tags: [context] }
views:
  - id: context
    title: Context
    include: { tags: [context] }
`;

async function setup(): Promise<{ t: TestApp; headers: Record<string, string>; id: string; v1: string }> {
  const t = await testApp();
  const me = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
  const created = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: YAML, message: 'first' }) });
  expect(created.status).toBe(201);
  return { t, headers: me.headers, id: (created.body['document'] as { id: string }).id, v1: (created.body['version'] as { id: string }).id };
}

describe('viewer api by document id', () => {
  test('steer actions each save a version with a message and the one YAML change', async () => {
    const { t, headers, id, v1 } = await setup();
    const steer = async (action: Record<string, unknown>, expectedVersion: string): Promise<{ status: number; body: Record<string, unknown> }> =>
      t.json(`/api/v1/documents/${id}/steer`, { method: 'POST', headers, body: JSON.stringify({ action, expectedVersion }) });
    const yamlOf = async (version: string): Promise<string> => (await t.ctx.db.query<{ yaml: string }>('select yaml from versions where id = $1', [version]))[0]!.yaml;

    let head = v1;
    const steps: { action: Record<string, unknown>; message: string; expect: string }[] = [
      { action: { kind: 'order', view: 'context', node: 'apps', order: ['orders-api', 'web-app'] }, message: 'steer: reorder apps', expect: 'order: [ orders-api, web-app ]' },
      { action: { kind: 'collapse', view: 'context', node: 'apps', on: true }, message: 'steer: collapse apps', expect: 'collapse: [ apps ]' },
      { action: { kind: 'expand', view: 'context', node: 'apps', on: true }, message: 'steer: expand apps', expect: 'expand: [ apps ]' },
      { action: { kind: 'hide', view: 'context', node: 'orders-db' }, message: 'steer: hide orders-db', expect: 'hide: [ orders-db ]' },
      { action: { kind: 'arrange', view: 'context', node: 'root', as: 'grid', direction: 'down' }, message: 'steer: arrange root as grid, direction down', expect: 'as: grid' },
      { action: { kind: 'note', view: 'context', text: 'Entry point.', at: 'web-app' }, message: 'steer: note on web-app', expect: '{ text: Entry point., at: web-app }' },
      { action: { kind: 'question', view: 'context', text: 'Who buys?' }, message: 'steer: question for context', expect: 'question: Who buys?' },
      { action: { kind: 'bind', node: 'web-app', bind: 'orrery:app-1' }, message: 'steer: bind web-app', expect: 'bind: orrery:app-1' },
    ];
    for (const s of steps) {
      const r = await steer(s.action, head);
      expect(r.status).toBe(200);
      expect(r.body['message']).toBe(s.message);
      const version = r.body['version'] as { id: string; message: string };
      expect(version.message).toBe(s.message);
      const yaml = await yamlOf(version.id);
      expect(yaml).toContain(s.expect);
      expect(yaml).toContain('# the front');
      head = version.id;
    }
    const final = await yamlOf(head);
    expect(final).not.toContain('collapse:');
    expect(final.match(/node: apps/g)?.length).toBe(1);

    const stale = await steer({ kind: 'hide', view: 'context', node: 'shoppers' }, v1);
    expect(stale.status).toBe(409);
    expect((stale.body['details'] as { head: { id: string } }).head.id).toBe(head);

    const bad = await steer({ kind: 'hide', view: 'nope', node: 'shoppers' }, head);
    expect(bad.status).toBe(400);

    const versions = await t.json(`/api/v1/documents/${id}/versions`, { headers });
    expect((versions.body['versions'] as { message: string }[]).map((v) => v.message)[0]).toBe('steer: bind web-app');
    expect((versions.body['versions'] as unknown[]).length).toBe(steps.length + 1);
    await t.ctx.db.close();
  });

  test('viewers may not steer', async () => {
    const { t, headers, id, v1 } = await setup();
    const viewer = await t.bearer('viewer');
    const ws = ((await t.json('/api/v1/workspaces', { headers })).body['workspaces'] as { slug: string }[])[0]!;
    await t.json(`/api/v1/workspaces/${ws.slug}/grants`, { method: 'POST', headers, body: JSON.stringify({ role: 'viewer', subjectKind: 'user', subjectId: viewer.principal.userId }) });
    const r = await t.json(`/api/v1/documents/${id}/steer`, { method: 'POST', headers: viewer.headers, body: JSON.stringify({ action: { kind: 'hide', view: 'context', node: 'shoppers' }, expectedVersion: v1 }) });
    expect(r.status).toBe(403);
    const stranger = await t.bearer('stranger');
    const hidden = await t.json(`/api/v1/documents/${id}/comments`, { headers: stranger.headers });
    expect(hidden.status).toBe(404);
    await t.ctx.db.close();
  });

  test('visual diff renders the narrative and the restore saves the old text', async () => {
    const { t, headers, id, v1 } = await setup();
    const r = await t.json(`/api/v1/documents/${id}/steer`, { method: 'POST', headers, body: JSON.stringify({ action: { kind: 'hide', view: 'context', node: 'orders-db' }, expectedVersion: v1 }) });
    const v2 = (r.body['version'] as { id: string }).id;
    const svg = await t.app.request(`/api/v1/documents/${id}/diff/${v1}/${v2}/context.svg`, { headers });
    expect(svg.status).toBe(200);
    expect(svg.headers.get('content-type')).toContain('svg');
    const text = await svg.text();
    expect(text).toContain('<svg');
    expect(text).toContain('Orders DB vanished');
    const json = await t.json(`/api/v1/documents/${id}/diff/${v1}/${v2}/context.json`, { headers });
    expect((json.body['changes'] as { kind: string; id: string }[]).map((c) => `${c.kind}:${c.id}`)).toContain('vanished:orders-db');
    expect((await t.app.request(`/api/v1/documents/${id}/diff/${v1}/${v2}/nope.svg`, { headers })).status).toBe(404);

    const restored = await t.json(`/api/v1/documents/${id}/restore`, { method: 'POST', headers, body: JSON.stringify({ version: v1, expectedVersion: v2 }) });
    expect(restored.status).toBe(200);
    const v3 = (restored.body['version'] as { id: string; message: string });
    expect(v3.message).toBe(`restore: version ${v1}`);
    expect((await t.ctx.db.query<{ yaml: string }>('select yaml from versions where id = $1', [v3.id]))[0]!.yaml).toBe(YAML);
    const stale = await t.json(`/api/v1/documents/${id}/restore`, { method: 'POST', headers, body: JSON.stringify({ version: v1, expectedVersion: v1 }) });
    expect(stale.status).toBe(409);

    await createWorker(t.ctx).drain();
    const versions = await t.json(`/api/v1/documents/${id}/versions`, { headers });
    const list = versions.body['versions'] as { id: string; scores: Record<string, number>; authorLabel: string }[];
    expect(list.length).toBe(3);
    // The burst drew its last version; a version it passed over is scored once something draws it.
    expect(typeof list[0]!.scores['context']).toBe('number');
    expect(list[0]!.authorLabel).toBe('author');
    expect(versions.body['head']).toBe(v3.id);
    await t.ctx.db.close();
  });

  test('comments by id point at boxes and carry open counts per view and box; resolving drops them', async () => {
    const { t, headers, id } = await setup();
    const base = `/api/v1/documents/${id}/comments`;
    const a = await t.json(base, { method: 'POST', headers, body: JSON.stringify({ text: 'Move the database down', view: 'context', targets: ['orders-db', 'orders-api', 'orders-db'] }) });
    expect(a.status).toBe(201);
    expect(a.body['targets']).toEqual(['orders-db', 'orders-api']);
    await t.json(base, { method: 'POST', headers, body: JSON.stringify({ text: 'Is this the whole picture?', view: 'context' }) });
    const list = await t.json(base, { headers });
    expect((list.body['comments'] as { authorLabel: string }[])[0]!.authorLabel).toBe('author');
    const counts = list.body['counts'] as { total: number; byView: Record<string, number>; byNode: Record<string, number> };
    expect(counts).toEqual({ total: 2, byView: { context: 2 }, byNode: { 'orders-db': 1, 'orders-api': 1 } });
    const resolved = await t.json(`${base}/${a.body['id'] as string}/resolve`, { method: 'POST', headers, body: JSON.stringify({ resolved: true }) });
    expect(resolved.status).toBe(200);
    const after = (await t.json(base, { headers })).body['counts'] as { total: number; byNode: Record<string, number> };
    expect(after.total).toBe(1);
    expect(after.byNode).toEqual({});
    const loose = await t.json(base, { method: 'POST', headers, body: JSON.stringify({ text: 'Which view?', view: 'context', targets: [] }) });
    expect(loose.body['targets']).toEqual([]);
    await t.ctx.db.close();
  });

  test('a document that defines a kind of item names it and its Work board in the bundle', async () => {
    const { t, headers } = await setup();
    const ws = ((await t.json('/api/v1/workspaces', { headers })).body['workspaces'] as { slug: string }[])[0]!;
    const yaml = 'title: Shop roadmap\nkind: { prefix: PLAN, name: Shop roadmap, base: roadmap-item }\nviews: []\n';
    expect((await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers, body: JSON.stringify({ yaml }) })).status).toBe(201);
    const bundle = await t.json(`/w/${ws.slug}/shop-roadmap/api/bundle`, { headers });
    expect((bundle.body['hub'] as { items?: unknown }).items).toEqual({ name: 'Shop roadmap', url: `/w/${ws.slug}?tab=work&kind=PLAN` });
    const plain = await t.json(`/w/${ws.slug}/steerable/api/bundle`, { headers });
    expect((plain.body['hub'] as { items?: unknown }).items).toBeUndefined();
    await t.ctx.db.close();
  });

  test('the bundle carries hub for a signed-in reader and not for the embed', async () => {
    const { t, headers, id, v1 } = await setup();
    const ws = ((await t.json('/api/v1/workspaces', { headers })).body['workspaces'] as { slug: string }[])[0]!;
    const pending = await t.json(`/w/${ws.slug}/steerable/api/bundle`, { headers });
    expect(pending.body['pending']).toBe(true);
    expect((pending.body['hub'] as { version: string }).version).toBe(v1);
    await createWorker(t.ctx).drain();
    const bundle = await t.json(`/w/${ws.slug}/steerable/api/bundle`, { headers });
    expect(bundle.body['pending']).toBeUndefined();
    expect(bundle.body['hub']).toEqual({ documentId: id, version: v1, canEdit: true, canDelete: true, workspaceUrl: `/w/${ws.slug}`, apiBase: '/api/v1', theme: 'system' });
    const embed = await t.app.request(`/embed/${ws.slug}/steerable/context`, { headers });
    expect(embed.status).toBe(200);
    expect(await embed.text()).not.toContain('"hub"');
    await t.ctx.db.close();
  });
});

describe('openCounts', () => {
  test('counts only unresolved comments', () => {
    const row = (over: Partial<CommentRow>): CommentRow => ({ id: 'c', org_id: 'o', document_id: 'd', view_id: 'v', targets: [], text: 't', author_user_id: 'u', resolved_by: null, resolved_at: null, created_at: new Date(), ...over });
    const counts = openCounts([row({}), row({ targets: ['n', 'm'] }), row({ targets: ['n'], resolved_at: new Date(), resolved_by: 'u' })]);
    expect(counts).toEqual({ total: 2, byView: { v: 2 }, byNode: { n: 1, m: 1 } });
  });
});

import { describe, expect, test } from 'bun:test';
import { testApp, SAMPLE_YAML } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';

describe('documents api', () => {
  test('save, version, conflict, diff, artifacts, search, and export round trip', async () => {
    const t = await testApp();
    const me = await t.bearer('author');
    const list = await t.json('/api/v1/workspaces', { headers: me.headers });
    expect(list.status).toBe(200);
    const ws = (list.body['workspaces'] as { slug: string; kind: string; role: string }[])[0]!;
    expect(ws.kind).toBe('personal');
    expect(ws.role).toBe('author');

    const created = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML, message: 'first' }) });
    expect(created.status).toBe(201);
    const doc = created.body['document'] as { slug: string };
    const v1 = (created.body['version'] as { id: string }).id;
    expect(doc.slug).toBe('sample');

    const got = await t.json(`/api/v1/workspaces/${ws.slug}/documents/${doc.slug}`, { headers: me.headers });
    expect((got.body['headVersion'] as { id: string }).id).toBe(v1);

    const second = await t.json(`/api/v1/workspaces/${ws.slug}/documents/${doc.slug}`, { method: 'PUT', headers: me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML.replace('title: Sample', 'title: Second'), expectedVersion: v1, message: 'rename' }) });
    expect(second.status).toBe(200);
    expect(second.body['status']).toBe('saved');

    const conflict = await t.json(`/api/v1/workspaces/${ws.slug}/documents/${doc.slug}`, { method: 'PUT', headers: me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML.replace('title: Sample', 'title: Third'), expectedVersion: v1 }) });
    expect(conflict.status).toBe(409);
    expect(conflict.body['status']).toBe('conflict');
    expect(String(conflict.body['diff'])).toContain('+title: Second');

    const versions = await t.json(`/api/v1/workspaces/${ws.slug}/documents/${doc.slug}/versions`, { headers: me.headers });
    expect((versions.body['versions'] as unknown[]).length).toBe(2);
    const yaml = await t.app.request(`/api/v1/workspaces/${ws.slug}/documents/${doc.slug}/versions/${v1}?format=yaml`, { headers: me.headers });
    expect(await yaml.text()).toBe(SAMPLE_YAML);
    const diff = await t.app.request(`/api/v1/workspaces/${ws.slug}/documents/${doc.slug}/diff`, { headers: me.headers });
    expect(await diff.text()).toContain('-title: Sample');

    await createWorker(t.ctx).drain();
    const arts = await t.json(`/api/v1/workspaces/${ws.slug}/documents/${doc.slug}/artifacts`, { headers: me.headers });
    expect((arts.body['artifacts'] as { kind: string }[]).map((a) => a.kind).sort()).toEqual(['bundle', 'html', 'png', 'svg', 'view']);
    const svg = await t.app.request(`/api/v1/workspaces/${ws.slug}/documents/${doc.slug}/artifacts/svg?view=context`, { headers: me.headers });
    expect(svg.headers.get('content-type')).toContain('svg');
    expect(await svg.text()).toContain('<svg');
    const png = await t.app.request(`/api/v1/workspaces/${ws.slug}/documents/${doc.slug}/artifacts/png?view=context`, { headers: me.headers });
    expect(png.status).toBe(200);
    expect((await png.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    // The first version was saved over before it drew; asking for it draws it.
    const oldSvg = `/api/v1/workspaces/${ws.slug}/documents/${doc.slug}/artifacts/svg?view=context&version=${v1}`;
    const drawing = await t.app.request(oldSvg, { headers: me.headers });
    expect(drawing.status).toBe(202);
    expect(await createWorker(t.ctx).drain()).toBe(1);
    const drawn = await t.app.request(oldSvg, { headers: me.headers });
    expect(drawn.status).toBe(200);
    expect(await drawn.text()).toContain('<svg');

    const search = await t.json('/api/v1/search?q=orders', { headers: me.headers });
    expect((search.body['hits'] as { documentSlug: string }[]).map((h) => h.documentSlug)).toEqual(['sample']);
    const none = await t.json('/api/v1/search?q=zebra', { headers: me.headers });
    expect((none.body['hits'] as unknown[]).length).toBe(0);

    const other = await t.bearer('stranger');
    const hidden = await t.json('/api/v1/search?q=orders', { headers: other.headers });
    expect((hidden.body['hits'] as unknown[]).length).toBe(0);

    const zip = await t.app.request(`/api/v1/workspaces/${ws.slug}/export`, { headers: me.headers });
    expect(zip.headers.get('content-type')).toBe('application/zip');
    const bytes = new Uint8Array(await zip.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(1000);

    const team = await t.json('/api/v1/workspaces', { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'Platform' }) });
    expect(team.status).toBe(201);
    const imported = await t.json('/api/v1/workspaces/platform/import', { method: 'POST', headers: { ...me.headers, 'content-type': 'application/zip' }, body: bytes });
    expect(imported.status).toBe(200);
    expect((imported.body['results'] as { status: string; document: string }[]).map((r) => `${r.document}:${r.status}`)).toEqual(['sample:saved']);
    const single = await t.json('/api/v1/workspaces/platform/import?name=Second', { method: 'POST', headers: { ...me.headers, 'content-type': 'application/yaml' }, body: SAMPLE_YAML });
    expect((single.body['results'] as { document: string }[])[0]!.document).toBe('second');
    const docs = await t.json('/api/v1/workspaces/platform/documents', { headers: me.headers });
    expect((docs.body['documents'] as unknown[]).length).toBe(2);
    await t.ctx.db.close();
  });

  test('comments: create, list, resolve, delete; viewers may comment, only authors delete', async () => {
    const t = await testApp();
    const author = await t.bearer('author');
    const viewer = await t.bearer('viewer');
    const ws = ((await t.json('/api/v1/workspaces', { headers: author.headers })).body['workspaces'] as { slug: string }[])[0]!;
    await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: author.headers, body: JSON.stringify({ yaml: SAMPLE_YAML }) });
    await t.json(`/api/v1/workspaces/${ws.slug}/grants`, { method: 'POST', headers: author.headers, body: JSON.stringify({ role: 'viewer', subjectKind: 'user', subjectId: viewer.principal.userId }) });
    const base = `/api/v1/workspaces/${ws.slug}/documents/sample/comments`;
    const c1 = await t.json(base, { method: 'POST', headers: viewer.headers, body: JSON.stringify({ text: 'Move the database down', view: 'context', targets: ['orders-db'] }) });
    expect(c1.status).toBe(201);
    const id = c1.body['id'] as string;
    expect(c1.body['targets']).toEqual(['orders-db']);
    const unplaced = await t.json(base, { method: 'POST', headers: viewer.headers, body: JSON.stringify({ text: 'Which view?', targets: ['orders-db'] }) });
    expect(unplaced.status).toBe(400);
    const open = await t.json(`${base}?open=true`, { headers: author.headers });
    expect((open.body['comments'] as unknown[]).length).toBe(1);
    const resolved = await t.json(`${base}/${id}/resolve`, { method: 'POST', headers: author.headers, body: JSON.stringify({ resolved: true }) });
    expect(resolved.body['resolvedBy']).toBe(author.principal.userId);
    expect(((await t.json(`${base}?open=true`, { headers: author.headers })).body['comments'] as unknown[]).length).toBe(0);
    expect((await t.json(`${base}/${id}`, { method: 'DELETE', headers: viewer.headers })).status).toBe(403);
    expect((await t.json(`${base}/${id}`, { method: 'DELETE', headers: author.headers })).status).toBe(204);
    const audit = await t.ctx.db.query<{ what: string }>("select what from audit where what like 'comment.%' order by at");
    expect(audit.map((a) => a.what)).toEqual(['comment.create', 'comment.resolve', 'comment.delete']);
    await t.ctx.db.close();
  });

  test('openapi document lists every route with a role', async () => {
    const t = await testApp();
    const doc = await t.json('/api/v1/openapi.json');
    expect(doc.status).toBe(200);
    const paths = doc.body['paths'] as Record<string, Record<string, { 'x-required-role': string }>>;
    expect(Object.keys(paths).length).toBeGreaterThan(30);
    expect(paths['/workspaces/{workspace}/documents/{doc}']!['put']!['x-required-role']).toBe('author');
    expect(paths['/admin/users']!['get']!['x-required-role']).toBe('admin');
    await t.ctx.db.close();
  });
});

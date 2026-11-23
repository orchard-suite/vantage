import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { SAMPLE_YAML, testApp, type TestApp } from '../testing.ts';

type Auth = Awaited<ReturnType<TestApp['bearer']>>;

describe('library', () => {
  // One hub for the file: each in-memory database costs real memory.
  let t: TestApp;
  let ann: Auth;
  let bob: Auth;
  let docId = '';
  beforeAll(async () => {
    t = await testApp();
    ann = await t.bearer('ann');
    bob = await t.bearer('bob');
    await t.json('/api/v1/workspaces', { method: 'POST', headers: ann.headers, body: JSON.stringify({ name: 'Platform', slug: 'platform' }) });
    const doc = await t.json('/api/v1/workspaces/platform/documents', { method: 'POST', headers: ann.headers, body: JSON.stringify({ yaml: SAMPLE_YAML }) });
    docId = (doc.body['document'] as { id: string }).id;
  });

  test('a star is the reader\'s own and shows on home', async () => {
    expect((await t.app.request(`/api/v1/documents/${docId}/star`, { method: 'PUT', headers: ann.headers })).status).toBe(204);
    const starred = await (await t.app.request('/?show=starred', { headers: ann.headers })).text();
    expect(starred).toContain('aria-pressed="true"');
    expect(starred).toContain('Sample');
    expect((await t.app.request(`/api/v1/documents/${docId}/star`, { method: 'PUT', headers: bob.headers })).status).toBe(404);
    expect((await t.app.request(`/api/v1/documents/${docId}/star`, { method: 'DELETE', headers: ann.headers })).status).toBe(204);
    expect(await (await t.app.request('/?show=starred', { headers: ann.headers })).text()).toContain('No stars yet.');
  });

  test('folders hold diagrams, refuse a second name, and leave them behind when removed', async () => {
    const made = await t.json('/api/v1/workspaces/platform/folders', { method: 'POST', headers: ann.headers, body: JSON.stringify({ name: 'Networks' }) });
    expect(made.status).toBe(201);
    const id = made.body['id'] as string;
    expect((await t.json('/api/v1/workspaces/platform/folders', { method: 'POST', headers: ann.headers, body: JSON.stringify({ name: 'networks' }) })).status).toBe(409);
    expect((await t.json(`/api/v1/documents/${docId}/folder`, { method: 'PUT', headers: ann.headers, body: JSON.stringify({ folderId: id }) })).status).toBe(200);
    const list = await t.json('/api/v1/workspaces/platform/folders', { headers: ann.headers });
    expect(list.body['folders']).toMatchObject([{ id, name: 'Networks', documents: 1 }]);
    const page = await (await t.app.request(`/w/platform?folder=${id}`, { headers: ann.headers })).text();
    expect(page).toContain('Remove folder');
    expect(page).toContain(`data-folder="${id}" aria-current="true"`);
    expect((await t.app.request(`/api/v1/workspaces/platform/folders/${id}`, { method: 'DELETE', headers: ann.headers })).status).toBe(204);
    const docs = await t.ctx.db.query<{ folder_id: string | null }>('select folder_id from documents where id = $1', [docId]);
    expect(docs[0]!.folder_id).toBeNull();
  });

  test('an invite grants at once for a known address and waits for an unknown one', async () => {
    const known = await t.json('/api/v1/workspaces/platform/invites', { method: 'POST', headers: ann.headers, body: JSON.stringify({ email: 'BOB@example.com', role: 'viewer' }) });
    expect(known.body['status']).toBe('granted');
    expect((await t.app.request(`/api/v1/documents/${docId}/star`, { method: 'PUT', headers: bob.headers })).status).toBe(204);
    const later = await t.json('/api/v1/workspaces/platform/invites', { method: 'POST', headers: ann.headers, body: JSON.stringify({ email: 'cy@example.com', role: 'author' }) });
    expect(later.status).toBe(201);
    expect((await (await t.app.request('/w/platform?tab=members', { headers: ann.headers })).text())).toContain('cy@example.com');
    const cy = await t.bearer('cy');
    const spaces = (await t.json('/api/v1/workspaces', { headers: cy.headers })).body['workspaces'] as { slug: string; role: string }[];
    expect(spaces.find((w) => w.slug === 'platform')?.role).toBe('author');
    expect((await t.json('/api/v1/workspaces/platform/invites', { headers: ann.headers })).body['invites']).toEqual([]);
    expect((await t.json('/api/v1/workspaces/platform/invites', { method: 'POST', headers: bob.headers, body: JSON.stringify({ email: 'x@example.com', role: 'viewer' }) })).status).toBe(403);
  });

  test('an import can be laid out fresh, with guessed types the reader overrides', async () => {
    const bytes = readFileSync(new URL('../../../import/fixtures/flat.drawio', import.meta.url));
    const send = (q: string) => t.app.request(`/api/v1/workspaces/platform/drawings?filename=flat.drawio${q}`, { method: 'POST', headers: { ...ann.headers, 'content-type': 'application/octet-stream' }, body: bytes });
    const preview = (await (await send('&preview=true')).json()) as { report: { typed: { id: string; name: string; type: string }[] } };
    const db = preview.report.typed.find((g) => g.name === 'Orders DB')!;
    expect(db.type).toBe('database');
    const saved = await send(`&layout=auto&types=${encodeURIComponent(JSON.stringify({ [db.id]: 'storage' }))}`);
    expect(saved.status).toBe(201);
    const slug = ((await saved.json()) as { document: { slug: string } }).document.slug;
    const versions = (await t.json(`/api/v1/workspaces/platform/documents/${slug}/versions`, { headers: ann.headers })).body['versions'] as { id: string }[];
    const yaml = await (await t.app.request(`/api/v1/workspaces/platform/documents/${slug}/versions/${versions[0]!.id}?format=yaml`, { headers: ann.headers })).text();
    expect(yaml).toContain('type: storage');
    expect(yaml).not.toContain('pins:');
  });
});

import { describe, expect, test } from 'bun:test';
import { SAMPLE_YAML, testApp, type TestApp } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';

type Ws = { slug: string; name: string; kind: string };

async function personWithDiagram(t: TestApp, subject: string) {
  const me = await t.bearer(subject);
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as Ws[])[0]!;
  await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML, name: 'Pat private map' }) });
  await createWorker(t.ctx).drain();
  const doc = (await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { headers: me.headers })).body['documents'] as { id: string; slug: string }[];
  return { me, ws, doc: doc[0]! };
}

describe('an admin library holds only their own and shared workspaces', () => {
  test('lists, search, and the sidebar leave out workspaces nobody shared; the console and a direct open still reach them', async () => {
    const t = await testApp();
    const admin = await t.bearer('admin', { admin: true });
    const pat = await personWithDiagram(t, 'pat');
    const mine = (await t.json('/api/v1/workspaces', { headers: admin.headers })).body['workspaces'] as Ws[];
    expect(mine.map((w) => w.slug)).not.toContain(pat.ws.slug);
    const all = (await t.json('/api/v1/workspaces?all=true', { headers: admin.headers })).body['workspaces'] as Ws[];
    expect(all.map((w) => w.slug)).toContain(pat.ws.slug);
    // ?all is an admin's alone.
    const patAll = (await t.json('/api/v1/workspaces?all=true', { headers: pat.me.headers })).body['workspaces'] as Ws[];
    expect(patAll.map((w) => w.slug)).toEqual([pat.ws.slug]);

    expect(((await t.json('/api/v1/search?q=Shoppers', { headers: admin.headers })).body['hits'] as unknown[]).length).toBe(0);
    expect(((await t.json('/api/v1/search?q=Shoppers', { headers: pat.me.headers })).body['hits'] as unknown[]).length).toBe(1);

    const home = await (await t.app.request('/', { headers: admin.headers })).text();
    expect(home).not.toContain(`href="/w/${pat.ws.slug}"`);
    expect(home).not.toContain('Pat private map');

    const visit = await t.app.request(`/w/${pat.ws.slug}`, { headers: admin.headers });
    expect(visit.status).toBe(200);
    const visitHtml = await visit.text();
    expect(visitHtml).toContain('as an org admin');
    expect(visitHtml).toContain('Pat private map');

    const consolePage = await (await t.app.request('/admin', { headers: admin.headers })).text();
    expect(consolePage).toContain(`href="/admin/w/${pat.ws.slug}"`);
    expect(consolePage).toContain(`Personal space of pat`);
    const found = await (await t.app.request('/admin?q=private', { headers: admin.headers })).text();
    expect(found).toContain('Pat private map');
    const wsPage = await (await t.app.request(`/admin/w/${pat.ws.slug}`, { headers: admin.headers })).text();
    expect(wsPage).toContain(`href="/w/${pat.ws.slug}?tab=members"`);
    expect(wsPage).toContain(`/api/v1/documents/${pat.doc.id}/move`);

    // Sharing brings it into the admin's library, and the visit banner goes.
    await t.json(`/api/v1/workspaces/${pat.ws.slug}/grants`, { method: 'POST', headers: pat.me.headers, body: JSON.stringify({ role: 'viewer', subjectKind: 'user', subjectId: admin.principal.userId }) });
    expect(((await t.json('/api/v1/workspaces', { headers: admin.headers })).body['workspaces'] as Ws[]).map((w) => w.slug)).toContain(pat.ws.slug);
    expect(await (await t.app.request(`/w/${pat.ws.slug}`, { headers: admin.headers })).text()).not.toContain('as an org admin');
    await t.ctx.db.close();
  });
});

describe('moving a diagram between workspaces', () => {
  test('carries its publications and history; needs the delete rule where it is and author where it goes; a clash is 409', async () => {
    const t = await testApp();
    const admin = await t.bearer('admin', { admin: true });
    const pat = await personWithDiagram(t, 'pat');
    const team = (await t.json('/api/v1/workspaces', { method: 'POST', headers: admin.headers, body: JSON.stringify({ name: 'Platform' }) })).body as { slug: string };
    await t.json(`/api/v1/workspaces/${pat.ws.slug}/publications`, { method: 'POST', headers: pat.me.headers, body: JSON.stringify({ name: 'Wiki', document: pat.doc.slug, formats: ['png'], target: 'webhook', config: { url: 'https://wiki.example.test/in' } }) });

    // Pat may not write in Platform.
    const refused = await t.json(`/api/v1/documents/${pat.doc.id}/move`, { method: 'POST', headers: pat.me.headers, body: JSON.stringify({ workspace: team.slug }) });
    expect(refused.status).toBe(404);

    const moved = await t.json(`/api/v1/documents/${pat.doc.id}/move`, { method: 'POST', headers: admin.headers, body: JSON.stringify({ workspace: team.slug }) });
    expect(moved.status).toBe(200);
    expect(moved.body['url']).toBe(`/w/${team.slug}/${pat.doc.slug}`);
    expect((await t.json(`/api/v1/workspaces/${pat.ws.slug}/documents`, { headers: pat.me.headers })).body['documents']).toEqual([]);
    const there = (await t.json(`/api/v1/workspaces/${team.slug}/documents/${pat.doc.slug}/versions`, { headers: admin.headers })).body['versions'] as unknown[];
    expect(there.length).toBe(1);
    const pubs = (await t.json(`/api/v1/workspaces/${team.slug}/publications`, { headers: admin.headers })).body['publications'] as { name: string }[];
    expect(pubs.map((p) => p.name)).toEqual(['Wiki']);
    const activity = await t.ctx.db.query<{ target: string }>("select target from audit where what = 'document.move'");
    expect(activity.length).toBe(2);

    // A second diagram at the same slug cannot land on the first.
    await t.json(`/api/v1/workspaces/${pat.ws.slug}/documents`, { method: 'POST', headers: pat.me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML, name: 'Pat private map' }) });
    const again = ((await t.json(`/api/v1/workspaces/${pat.ws.slug}/documents`, { headers: pat.me.headers })).body['documents'] as { id: string }[])[0]!;
    const clash = await t.json(`/api/v1/documents/${again.id}/move`, { method: 'POST', headers: admin.headers, body: JSON.stringify({ workspace: team.slug }) });
    expect(clash.status).toBe(409);
    await t.ctx.db.close();
  });
});

describe('the look a person picks', () => {
  test('lives on the account: the hub pages and the viewer bundle wear it, and system follows the system', async () => {
    const t = await testApp();
    const pat = await personWithDiagram(t, 'pat');
    expect((await t.json('/api/v1/me', { headers: pat.me.headers })).body['theme']).toBe('system');
    expect(await (await t.app.request('/', { headers: pat.me.headers })).text()).toContain('<html lang="en"><head>');

    expect((await t.json('/api/v1/me/theme', { method: 'PUT', headers: pat.me.headers, body: JSON.stringify({ theme: 'sepia' }) })).status).toBe(400);
    expect((await t.json('/api/v1/me/theme', { method: 'PUT', headers: pat.me.headers, body: JSON.stringify({ theme: 'light' }) })).body).toEqual({ theme: 'light' });
    expect((await t.json('/api/v1/me', { headers: pat.me.headers })).body['theme']).toBe('light');
    const home = await (await t.app.request('/', { headers: pat.me.headers })).text();
    expect(home).toContain('<html lang="en" data-theme="light">');
    expect(home).toContain('data-theme-pick="light" aria-pressed="true"');
    const bundle = await t.json(`/w/${pat.ws.slug}/${pat.doc.slug}/api/bundle`, { headers: pat.me.headers });
    expect((bundle.body['hub'] as { theme: string }).theme).toBe('light');

    await t.json('/api/v1/me/theme', { method: 'PUT', headers: pat.me.headers, body: JSON.stringify({ theme: 'system' }) });
    expect(await (await t.app.request('/', { headers: pat.me.headers })).text()).toContain('data-theme-pick="system" aria-pressed="true"');
    await t.ctx.db.close();
  });
});

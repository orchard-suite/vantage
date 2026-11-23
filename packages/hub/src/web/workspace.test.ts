import { describe, expect, test } from 'bun:test';
import { testApp, SAMPLE_YAML } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';
import { DEFAULT_ORG } from '../auth/authenticate.ts';

async function seeded() {
  const t = await testApp();
  const me = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
  await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML }) });
  await createWorker(t.ctx).drain();
  return { t, me, ws };
}

describe('workspace page', () => {
  test('lists its diagrams under the frame, with the workspace marked in the sidebar', async () => {
    const { t, me, ws } = await seeded();
    const res = await t.app.request(`/w/${ws.slug}`, { headers: me.headers });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`href="/w/${ws.slug}" aria-current="page"`);
    expect(html).toContain('1 diagram');
    expect(html).toContain(`href="/w/${ws.slug}/sample"`);
    expect(html).toContain(`/api/v1/workspaces/${ws.slug}/export`);
    expect(html).toContain('You can edit');
    expect((await t.app.request(`/w/${ws.slug}`)).status).toBe(401);
    expect((await t.app.request('/w/nope', { headers: me.headers })).status).toBe(404);
  });

  test('connectors, publications, members and activity tabs', async () => {
    const { t, me, ws } = await seeded();
    const none = await (await t.app.request(`/w/${ws.slug}?tab=connectors`, { headers: me.headers })).text();
    expect(none).toContain('No connectors in this workspace yet.');
    await t.json(`/api/v1/workspaces/${ws.slug}/connectors`, { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'Azure', connector: 'push', clientId: 'app-azure' }) });
    const src = await (await t.app.request(`/w/${ws.slug}?tab=connectors`, { headers: me.headers })).text();
    expect(src).toContain('Signs in as the app <code>app-azure</code>');
    expect(src).not.toContain('data-run="/api/v1/sources');

    const wsId = (await t.ctx.db.query<{ id: string }>('select id from workspaces where slug = $1', [ws.slug]))[0]!.id;
    const docId = (await t.ctx.db.query<{ id: string }>('select id from documents where workspace_id = $1', [wsId]))[0]!.id;
    await t.ctx.db.query(`insert into publications (id, org_id, workspace_id, document_id, name, formats, target, config, trigger) values ('p1', $1, $2, $3, 'Wiki page', '["png","pdf"]', 'fs', '{"path":"/tmp/x"}', '{"kind":"on-save"}')`, [DEFAULT_ORG, wsId, docId]);
    const pubs = await (await t.app.request(`/w/${ws.slug}?tab=publications`, { headers: me.headers })).text();
    expect(pubs).toContain('Wiki page');
    expect(pubs).toContain('Sample as PNG, PDF to fs');
    expect(pubs).toContain('On every new version');
    expect(pubs).toContain(`data-run="/api/v1/workspaces/${ws.slug}/publications/p1/run"`);
    const run = await t.app.request(`/api/v1/workspaces/${ws.slug}/publications/p1/run`, { method: 'POST', headers: me.headers });
    expect(run.status).toBe(202);

    const members = await (await t.app.request(`/w/${ws.slug}?tab=members`, { headers: me.headers })).text();
    expect(members).toContain('Can edit');
    expect(members).toContain('/grants');

    const act = await (await t.app.request(`/w/${ws.slug}?tab=activity`, { headers: me.headers })).text();
    expect(act).toContain('saved a new version of');
    expect(act).toContain('<b>Sample</b>');
    expect(act).toContain('asked to publish');
  });

  test('a viewer sees no members tab and no run buttons', async () => {
    const { t, ws } = await seeded();
    const viewer = await t.bearer('viewer');
    const wsId = (await t.ctx.db.query<{ id: string }>('select id from workspaces where slug = $1', [ws.slug]))[0]!.id;
    await t.ctx.db.query("insert into grants (id, org_id, workspace_id, role, subject_kind, subject_id) values ('g1', $1, $2, 'viewer', 'user', $3)", [DEFAULT_ORG, wsId, viewer.principal.userId]);
    const html = await (await t.app.request(`/w/${ws.slug}?tab=members`, { headers: viewer.headers })).text();
    expect(html).not.toContain('?tab=members"');
    expect(html).toContain('You can view');
    expect(html).toContain('1 diagram');
    const pubs = await (await t.app.request(`/w/${ws.slug}?tab=publications`, { headers: viewer.headers })).text();
    expect(pubs).not.toContain('data-run=');
  });
});

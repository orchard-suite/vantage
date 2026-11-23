import { describe, expect, test } from 'bun:test';
import { SAMPLE_YAML, testApp } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';
import { adminFootprint, adminWorkspaceDetail } from './admin-data.ts';

describe('the admin footprint', () => {
  test('counts bytes by kind, who reaches each workspace, and where each person is a member', async () => {
    const t = await testApp();
    const admin = await t.bearer('admin', { admin: true });
    const pat = await t.bearer('pat');
    const team = (await t.json('/api/v1/workspaces', { method: 'POST', headers: admin.headers, body: JSON.stringify({ name: 'Platform' }) })).body as { slug: string };
    const doc = (await t.json(`/api/v1/workspaces/${team.slug}/documents`, { method: 'POST', headers: admin.headers, body: JSON.stringify({ yaml: SAMPLE_YAML, name: 'Edge' }) })).body['document'] as { slug: string };
    await t.json(`/api/v1/workspaces/${team.slug}/documents/${doc.slug}`, { method: 'PUT', headers: admin.headers, body: JSON.stringify({ yaml: `${SAMPLE_YAML}\n# again\n` }) });
    await t.json(`/api/v1/workspaces/${team.slug}/grants`, { method: 'POST', headers: admin.headers, body: JSON.stringify({ role: 'author', subjectKind: 'user', subjectId: pat.principal.userId }) });
    await t.json(`/api/v1/workspaces/${team.slug}/grants`, { method: 'POST', headers: admin.headers, body: JSON.stringify({ role: 'viewer', subjectKind: 'org', subjectId: 'default' }) });
    const wsId = (await t.ctx.db.query<{ id: string }>('select id from workspaces where slug = $1', [team.slug]))[0]!.id;
    await t.ctx.db.query("insert into sources (id, org_id, workspace_id, name, slug, connector, config, client_id, enabled) values ('s1', 'default', $1, 'Fleet', 'fleet', 'push', '{}', 'client-1', true)", [wsId]);
    await t.ctx.db.query("insert into observed_entities (source_id, key, data, observed) values ('s1', 'a', '{\"name\":\"web\"}', 'now')");
    await createWorker(t.ctx).drain();

    const fp = await adminFootprint(t.ctx.db, 'default');
    const ws = fp.workspaces.find((w) => w.slug === team.slug)!;
    expect(ws.diagrams).toBe(1);
    expect(ws.versions).toBe(2);
    expect(ws.disk.history).toBeGreaterThan(SAMPLE_YAML.length * 2);
    expect(ws.disk.renders).toBeGreaterThan(0);
    expect(ws.disk.observed).toBe('{"name": "web"}'.length);
    expect(ws.bytes).toBe(ws.disk.renders + ws.disk.history + ws.disk.observed);
    expect(ws.reach).toBe(2);
    expect(ws.connectors).toBe(1);
    expect(ws.waiting).toBe(1);

    const p = fp.people.find((x) => x.id === pat.principal.userId)!;
    expect(p.owns).toBe(1);
    expect(p.memberOf).toBe(1);
    expect(fp.memberships.get(pat.principal.userId)).toMatchObject([{ workspace: { slug: team.slug }, role: 'author', via: 'pat' }]);
    const boss = fp.people.find((x) => x.id === admin.principal.userId)!;
    expect(boss.bytes).toBe(ws.bytes);
    expect(boss.made).toBe(1);

    const detail = (await adminWorkspaceDetail(t.ctx.db, fp, team.slug))!;
    expect(detail.diagrams).toMatchObject([{ slug: doc.slug, versions: 2, views: 1 }]);
    expect(detail.diagrams[0]!.bytes).toBe(detail.diagrams[0]!.disk.renders + detail.diagrams[0]!.disk.history);
    expect(detail.grants.map((g) => [g.kind, g.role, g.people])).toEqual([['user', 'author', 1], ['user', 'author', 1], ['org', 'viewer', 2]]);
    expect(detail.recent.length).toBe(2);
    await t.ctx.db.close();
  });

  test('the pages draw the map, the access grid with the delete rule, and a person', async () => {
    const t = await testApp();
    const admin = await t.bearer('admin', { admin: true });
    const pat = await t.bearer('pat');
    const team = (await t.json('/api/v1/workspaces', { method: 'POST', headers: admin.headers, body: JSON.stringify({ name: 'Platform' }) })).body as { slug: string };
    await t.json(`/api/v1/workspaces/${team.slug}/documents`, { method: 'POST', headers: admin.headers, body: JSON.stringify({ yaml: SAMPLE_YAML, name: 'Edge' }) });
    await t.json(`/api/v1/workspaces/${team.slug}/grants`, { method: 'POST', headers: admin.headers, body: JSON.stringify({ role: 'author', subjectKind: 'user', subjectId: pat.principal.userId }) });
    await createWorker(t.ctx).drain();

    const home = await (await t.app.request('/admin', { headers: admin.headers })).text();
    expect(home).toContain(`class="a-tile team" href="/admin/w/${team.slug}"`);
    expect(home).toContain('on disk across 3 workspaces, 1 diagram, and 2 people');
    const page = await (await t.app.request(`/admin/w/${team.slug}`, { headers: admin.headers })).text();
    expect(page).toContain('Who can do what');
    expect(page).toContain('Their own');
    expect(page).toContain('An author may delete the diagrams they made.');
    const person = await (await t.app.request(`/admin/people/${pat.principal.userId}`, { headers: admin.headers })).text();
    expect(person).toContain('Can also open');
    expect(person).toContain('through pat');
    expect((await t.app.request('/admin/w/nowhere', { headers: admin.headers })).status).toBe(404);
    await t.ctx.db.close();
  });
});

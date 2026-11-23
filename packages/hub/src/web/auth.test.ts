import { describe, expect, test } from 'bun:test';
import { testApp, testContext, SAMPLE_YAML } from '../testing.ts';
import { createHubApp } from './app.ts';
import { sealSession } from '../auth/session.ts';
import pkg from '../../../../package.json';

describe('auth and grants', () => {
  test('anonymous is rejected in proxy mode; trusted headers sign in and map groups to teams', async () => {
    const t = await testApp();
    expect((await t.json('/api/v1/me')).status).toBe(401);
    expect((await t.app.request('/')).status).toBe(401);
    const me = await t.json('/api/v1/me', { headers: { 'x-forwarded-user': 'alpha@example.com', 'x-forwarded-groups': 'platform, security' } });
    expect(me.status).toBe(200);
    expect(me.body['admin']).toBe(true);
    expect((me.body['teams'] as string[]).length).toBe(2);
    const second = await t.json('/api/v1/me', { headers: { 'x-forwarded-user': 'beta@example.com' } });
    expect(second.body['admin']).toBe(false);
    const teams = await t.ctx.db.query<{ external_group: string }>('select external_group from teams order by external_group');
    expect(teams.map((x) => x.external_group)).toEqual(['platform', 'security']);
    await t.ctx.db.close();
  });

  test('none mode signs everyone in as the local developer with admin', async () => {
    const ctx = await testContext({ env: { AUTH_MODE: 'none' } });
    const app = createHubApp(ctx);
    const res = await app.request('/api/v1/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { admin: boolean; subject: string };
    expect(body.admin).toBe(true);
    expect(body.subject).toBe('local-developer');
    expect((await app.request('/')).status).toBe(200);
    expect(await (await app.request('/healthz')).json()).toEqual({ ok: true, version: pkg.version });
    const ready = (await (await app.request('/readyz')).json()) as { ok: boolean; checks: Record<string, string> };
    expect(ready.ok).toBe(true);
    expect(ready.checks['db']).toBe('ok');
    await ctx.db.close();
  });

  test('bearer tokens: revoked and unknown tokens fail; automation tokens are pinned to a workspace and role', async () => {
    const t = await testApp();
    const me = await t.bearer('author');
    const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
    expect((await t.json('/api/v1/me', { headers: { authorization: 'Bearer vpt_nope' } })).status).toBe(401);

    const auto = await t.json('/api/v1/tokens', { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'ci', kind: 'automation', workspace: ws.slug, role: 'viewer' }) });
    expect(auto.status).toBe(201);
    const autoHeaders = { authorization: `Bearer ${auto.body['token'] as string}` };
    expect(((await t.json('/api/v1/workspaces', { headers: autoHeaders })).body['workspaces'] as { role: string }[])[0]!.role).toBe('viewer');
    const denied = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: autoHeaders, body: JSON.stringify({ yaml: SAMPLE_YAML }) });
    expect(denied.status).toBe(403);
    expect((await t.json('/api/v1/tokens', { method: 'POST', headers: autoHeaders, body: JSON.stringify({ name: 'x' }) })).status).toBe(403);

    const listed = await t.json('/api/v1/tokens', { headers: me.headers });
    const tokens = listed.body['tokens'] as { id: string; name: string; token?: string }[];
    expect(tokens.map((x) => x.name).sort()).toEqual(['ci', 'test author']);
    expect(tokens.every((x) => x.token === undefined)).toBe(true);
    const ciId = tokens.find((x) => x.name === 'ci')!.id;
    expect((await t.json(`/api/v1/tokens/${ciId}`, { method: 'DELETE', headers: me.headers })).status).toBe(204);
    expect((await t.json('/api/v1/me', { headers: autoHeaders })).status).toBe(401);
    const hashes = await t.ctx.db.query<{ hash: string }>('select hash from tokens');
    expect(hashes.every((h) => /^[0-9a-f]{64}$/.test(h.hash))).toBe(true);
    await t.ctx.db.close();
  });

  test('grants: strangers get 404, viewers read but cannot write, team grants work, org grant opens to all', async () => {
    const t = await testApp();
    const owner = await t.bearer('owner');
    const viewer = await t.bearer('viewer');
    const teammate = await t.bearer('teammate', { groups: ['platform'] });
    const stranger = await t.bearer('stranger');
    const ws = ((await t.json('/api/v1/workspaces', { headers: owner.headers })).body['workspaces'] as { slug: string }[])[0]!;
    await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: owner.headers, body: JSON.stringify({ yaml: SAMPLE_YAML }) });
    const path = `/api/v1/workspaces/${ws.slug}/documents/sample`;

    expect((await t.json(path, { headers: stranger.headers })).status).toBe(404);
    expect((await t.json(path, { headers: viewer.headers })).status).toBe(404);

    await t.json(`/api/v1/workspaces/${ws.slug}/grants`, { method: 'POST', headers: owner.headers, body: JSON.stringify({ role: 'viewer', subjectKind: 'user', subjectId: viewer.principal.userId }) });
    expect((await t.json(path, { headers: viewer.headers })).status).toBe(200);
    expect((await t.json(path, { method: 'PUT', headers: viewer.headers, body: JSON.stringify({ yaml: SAMPLE_YAML }) })).status).toBe(403);
    expect((await t.json(`/api/v1/workspaces/${ws.slug}/grants`, { method: 'POST', headers: viewer.headers, body: JSON.stringify({ role: 'author', subjectKind: 'user', subjectId: viewer.principal.userId }) })).status).toBe(403);

    const team = (await t.ctx.db.query<{ id: string }>("select id from teams where external_group = 'platform'"))[0]!;
    await t.json(`/api/v1/workspaces/${ws.slug}/grants`, { method: 'POST', headers: owner.headers, body: JSON.stringify({ role: 'author', subjectKind: 'team', subjectId: team.id }) });
    expect((await t.json(path, { method: 'PUT', headers: teammate.headers, body: JSON.stringify({ yaml: SAMPLE_YAML.replace('Sample', 'Team edit') }) })).status).toBe(200);
    expect((await t.json(path, { headers: stranger.headers })).status).toBe(404);

    await t.json(`/api/v1/workspaces/${ws.slug}/grants`, { method: 'POST', headers: owner.headers, body: JSON.stringify({ role: 'viewer', subjectKind: 'org', subjectId: 'default' }) });
    expect((await t.json(path, { headers: stranger.headers })).status).toBe(200);
    expect((await t.json(path, { method: 'PUT', headers: stranger.headers, body: JSON.stringify({ yaml: SAMPLE_YAML }) })).status).toBe(403);
    const audited = await t.ctx.db.query<{ what: string }>("select what from audit where what = 'grant.set'");
    expect(audited.length).toBe(3);
    await t.ctx.db.close();
  });

  test('cookie sessions need a same-origin or csrf header for writes; admin routes need admin', async () => {
    const t = await testApp();
    const admin = await t.bearer('first-admin');
    const cookie = `vantage_session=${await sealSession(t.ctx.config.SESSION_SECRET, admin.principal.userId)}`;
    const me = await t.json('/api/v1/me', { headers: { cookie } });
    expect(me.status).toBe(200);
    const csrf = me.body['csrf'] as string;
    expect(csrf.length).toBeGreaterThan(10);
    const blocked = await t.json('/api/v1/workspaces', { method: 'POST', headers: { cookie, origin: 'https://evil.example' }, body: JSON.stringify({ name: 'Evil' }) });
    expect(blocked.status).toBe(403);
    const sameOrigin = await t.json('/api/v1/workspaces', { method: 'POST', headers: { cookie, origin: 'http://hub.test' }, body: JSON.stringify({ name: 'Good' }) });
    expect(sameOrigin.status).toBe(201);
    const withHeader = await t.json('/api/v1/workspaces', { method: 'POST', headers: { cookie, 'x-csrf-token': csrf }, body: JSON.stringify({ name: 'Also good' }) });
    expect(withHeader.status).toBe(201);

    const regular = await t.bearer('regular');
    expect((await t.json('/api/v1/admin/users', { headers: regular.headers })).status).toBe(403);
    const users = await t.json('/api/v1/admin/users', { headers: admin.headers });
    expect((users.body['users'] as unknown[]).length).toBe(2);
    const disabled = await t.json(`/api/v1/admin/users/${regular.principal.userId}`, { method: 'PATCH', headers: admin.headers, body: JSON.stringify({ disabled: true }) });
    expect(disabled.status).toBe(200);
    expect((await t.json('/api/v1/me', { headers: regular.headers })).status).toBe(401);
    const moved = await t.ctx.db.query<{ owner_user_id: string }>("select owner_user_id from workspaces where kind = 'personal'");
    expect(moved.every((w) => w.owner_user_id === admin.principal.userId)).toBe(true);
    await t.ctx.db.close();
  });

  test('device code flow issues a personal token after browser approval', async () => {
    const t = await testApp();
    const admin = await t.bearer('person');
    const start = await t.json('/auth/device', { method: 'POST', body: JSON.stringify({ name: 'laptop agent' }) });
    expect(start.status).toBe(200);
    const pending = await t.json('/auth/device/token', { method: 'POST', body: JSON.stringify({ device_code: start.body['device_code'] }) });
    expect(pending.body['error']).toBe('authorization_pending');
    const cookie = `vantage_session=${await sealSession(t.ctx.config.SESSION_SECRET, admin.principal.userId)}`;
    const approve = await t.app.request('/auth/device/approve', { method: 'POST', headers: { cookie, origin: 'http://hub.test', 'content-type': 'application/x-www-form-urlencoded' }, body: `code=${start.body['user_code'] as string}` });
    expect(approve.status).toBe(200);
    const issued = await t.json('/auth/device/token', { method: 'POST', body: JSON.stringify({ device_code: start.body['device_code'] }) });
    expect(issued.status).toBe(200);
    const me = await t.json('/api/v1/me', { headers: { authorization: `Bearer ${issued.body['access_token'] as string}` } });
    expect(me.body['userId']).toBe(admin.principal.userId);
    expect((await t.json('/auth/device/token', { method: 'POST', body: JSON.stringify({ device_code: start.body['device_code'] }) })).body['error']).toBe('expired_token');
    await t.ctx.db.close();
  });
});

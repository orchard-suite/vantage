import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SAMPLE_YAML, testApp, testContext, type TestApp } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';
import { enqueue } from '../worker/jobs.ts';
import { createHubApp } from '../web/app.ts';
import type { OidcProvider } from '../auth/oidc.ts';
import { FLOW_COOKIE } from '../auth/session.ts';
import { ResponseBodyError } from 'openid-client';
import { createLogger } from '../log.ts';

async function withDiagram(t: TestApp, subject: string) {
  const me = await t.bearer(subject);
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
  await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML }) });
  await createWorker(t.ctx).drain();
  return { me, ws };
}

describe('team workspaces', () => {
  test('with TEAM_WORKSPACES=granted only admins and the people an admin lets make team workspaces', async () => {
    const t = await testApp({ env: { TEAM_WORKSPACES: 'granted' } });
    const admin = await t.bearer('admin', { admin: true });
    const pat = await t.bearer('pat');
    const make = (h: Record<string, string>, name: string) => t.json('/api/v1/workspaces', { method: 'POST', headers: h, body: JSON.stringify({ name }) });

    expect((await make(pat.headers, 'Sprawl')).status).toBe(403);
    expect((await t.json('/api/v1/me', { headers: pat.headers })).body['canCreateWorkspaces']).toBe(false);
    expect((await make(admin.headers, 'Platform')).status).toBe(201);
    expect((await t.json(`/api/v1/admin/users/${pat.principal.userId}`, { method: 'PATCH', headers: pat.headers, body: JSON.stringify({ workspaceCreator: true }) })).status).toBe(403);

    const let_ = await t.json(`/api/v1/admin/users/${pat.principal.userId}`, { method: 'PATCH', headers: admin.headers, body: JSON.stringify({ workspaceCreator: true }) });
    expect(let_.body['can_create_workspaces']).toBe(true);
    expect((await t.json('/api/v1/me', { headers: pat.headers })).body['canCreateWorkspaces']).toBe(true);
    expect((await make(pat.headers, 'Delivery')).status).toBe(201);

    await t.json(`/api/v1/admin/users/${pat.principal.userId}`, { method: 'PATCH', headers: admin.headers, body: JSON.stringify({ workspaceCreator: false }) });
    expect((await make(pat.headers, 'Another')).status).toBe(403);
    await t.ctx.db.close();
  });

  test('the sidebar offers a new team workspace only to the people who may make one', async () => {
    const t = await testApp({ env: { TEAM_WORKSPACES: 'granted' } });
    const admin = await t.bearer('admin', { admin: true });
    const pat = await t.bearer('pat');
    const offered = async (h: Record<string, string>, path: string) => (await (await t.app.request(path, { headers: h })).text()).includes('<form data-new-workspace>');

    for (const path of ['/', '/admin', '/api']) expect(await offered(admin.headers, path)).toBe(true);
    expect(await offered(pat.headers, '/')).toBe(false);
    await t.json(`/api/v1/admin/users/${pat.principal.userId}`, { method: 'PATCH', headers: admin.headers, body: JSON.stringify({ workspaceCreator: true }) });
    expect(await offered(pat.headers, '/')).toBe(true);
    await t.ctx.db.close();
  });

  test('by default anyone signed in makes team workspaces', async () => {
    const t = await testApp();
    const pat = await t.bearer('pat');
    expect(await (await t.app.request('/', { headers: pat.headers })).text()).toContain('<form data-new-workspace>');
    expect((await t.json('/api/v1/workspaces', { method: 'POST', headers: pat.headers, body: JSON.stringify({ name: 'Mine' }) })).status).toBe(201);
    await t.ctx.db.close();
  });
});

describe('publication approval', () => {
  test('a publication runs only once an admin approves it, a new destination takes the approval back, and a stop holds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vantage-approval-'));
    try {
      const t = await testApp({ env: { PUBLICATION_APPROVAL: 'true' } });
      const worker = createWorker(t.ctx);
      const admin = await t.bearer('admin', { admin: true });
      const { me, ws } = await withDiagram(t, 'author');
      const base = `/api/v1/workspaces/${ws.slug}/publications`;
      const spec = { name: 'Share folder', document: 'sample', formats: ['svg'], views: ['context'], target: 'fs', config: { path: dir }, trigger: { kind: 'on-save' }, titleBlock: false };

      const created = await t.json(base, { method: 'POST', headers: me.headers, body: JSON.stringify(spec) });
      expect(created.status).toBe(201);
      expect(created.body['approval']).toBe('pending');
      expect(created.body['createdBy']).toBe(me.principal.userId);
      const id = created.body['id'] as string;

      const refused = await t.json(`${base}/${id}/run`, { method: 'POST', headers: me.headers });
      expect(refused.status).toBe(403);
      expect(refused.body['error']).toContain('waiting for an admin');
      await t.json(`/api/v1/workspaces/${ws.slug}/documents/sample`, { method: 'PUT', headers: me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML.replace('title: Sample', 'title: Two') }) });
      await worker.drain();
      expect(readdirSync(dir)).toEqual([]);
      await enqueue(t.ctx.db, { orgId: 'default', kind: 'publication-run', payload: { publicationId: id, trigger: 'manual' } });
      await worker.drain();
      expect(readdirSync(dir)).toEqual([]);
      const job = await t.ctx.db.query<{ state: string }>("select state from jobs where kind = 'publication-run' order by created_at desc limit 1");
      expect(job[0]!.state).toBe('failed');

      expect((await t.json('/api/v1/admin/publications', { headers: me.headers })).status).toBe(403);
      expect((await t.json(`/api/v1/admin/publications/${id}/approve`, { method: 'POST', headers: me.headers })).status).toBe(403);
      const listed = await t.json('/api/v1/admin/publications', { headers: admin.headers });
      expect(listed.body['approvalRequired']).toBe(true);
      expect((listed.body['publications'] as { id: string; approval: string; workspace: string; createdByName: string; blocked: string | null; config: unknown }[])[0]).toMatchObject({ id, approval: 'pending', workspace: ws.slug, createdByName: 'author', config: { path: dir } });

      expect((await t.json(`/api/v1/admin/publications/${id}/approve`, { method: 'POST', headers: admin.headers })).body['approval']).toBe('approved');
      expect((await t.json(`${base}/${id}/run`, { method: 'POST', headers: me.headers })).status).toBe(202);
      await worker.drain();
      expect(readdirSync(dir)).toEqual(['sample.context.svg']);

      expect((await t.json(`${base}/${id}`, { method: 'PUT', headers: me.headers, body: JSON.stringify({ ...spec, name: 'Renamed' }) })).body['approval']).toBe('approved');
      const moved = await t.json(`${base}/${id}`, { method: 'PUT', headers: me.headers, body: JSON.stringify({ ...spec, name: 'Renamed', config: { path: join(dir, 'elsewhere') } }) });
      expect(moved.body['approval']).toBe('pending');
      expect((await t.json(`${base}/${id}/run`, { method: 'POST', headers: me.headers })).status).toBe(403);

      await t.json(`/api/v1/admin/publications/${id}/approve`, { method: 'POST', headers: admin.headers });
      expect((await t.json(`/api/v1/admin/publications/${id}/stop`, { method: 'POST', headers: admin.headers })).body['approval']).toBe('stopped');
      const stopped = await t.json(`${base}/${id}/run`, { method: 'POST', headers: me.headers });
      expect(stopped.status).toBe(403);
      expect(stopped.body['error']).toContain('stopped');
      expect((await t.json(`${base}/${id}`, { method: 'PUT', headers: me.headers, body: JSON.stringify({ ...spec, config: { path: dir } }) })).body['approval']).toBe('stopped');

      const audits = (await t.ctx.db.query<{ what: string }>('select what from audit')).map((a) => a.what);
      for (const w of ['publication.approve', 'publication.stop']) expect(audits).toContain(w);
      await t.ctx.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('without approval publications run at once, and an admin can still stop one', async () => {
    const t = await testApp();
    const admin = await t.bearer('admin', { admin: true });
    const { me, ws } = await withDiagram(t, 'author');
    const base = `/api/v1/workspaces/${ws.slug}/publications`;
    const created = await t.json(base, { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'Out', document: 'sample', formats: ['svg'], target: 'fs', config: { path: '/tmp/vantage-never' } }) });
    const id = created.body['id'] as string;
    await t.json(`/api/v1/admin/publications/${id}/stop`, { method: 'POST', headers: admin.headers });
    expect((await t.json(`${base}/${id}/run`, { method: 'POST', headers: me.headers })).status).toBe(403);
    await t.json(`/api/v1/admin/publications/${id}/approve`, { method: 'POST', headers: admin.headers });
    expect((await t.json(`${base}/${id}/run`, { method: 'POST', headers: me.headers })).status).toBe(202);
    await t.ctx.db.close();
  });
});

describe('guest links off', () => {
  test('GUEST_LINKS=false makes none, opens none, and the share dialog says so', async () => {
    const on = await testApp();
    const { me, ws } = await withDiagram(on, 'author');
    const made = await on.json(`/api/v1/workspaces/${ws.slug}/documents/sample/guest-links`, { method: 'POST', headers: me.headers, body: JSON.stringify({}) });
    const path = new URL(made.body['url'] as string).pathname;
    expect((await on.app.request(path)).status).toBe(200);

    const off = createHubApp({ ...on.ctx, config: { ...on.ctx.config, GUEST_LINKS: false } });
    const ask = (p: string, init: RequestInit = {}) => off.request(p, { ...init, headers: { 'content-type': 'application/json', ...me.headers } });
    expect((await off.request(path)).status).toBe(404);
    expect((await off.request(`/api/bundle?file=g/${path.slice(3)}`)).status).toBe(404);
    const refused = await ask(`/api/v1/workspaces/${ws.slug}/documents/sample/guest-links`, { method: 'POST', body: '{}' });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toContain('turned off on this hub');
    const doc = (await on.ctx.db.query<{ id: string }>("select id from documents where slug = 'sample'"))[0]!;
    const share = (await (await ask(`/api/v1/documents/${doc.id}/share`)).json()) as { guestLinksAllowed: boolean; guestLinksOnHub: boolean };
    expect(share).toMatchObject({ guestLinksAllowed: false, guestLinksOnHub: false });
    await on.ctx.db.close();
  });
});

describe('sign-in groups', () => {
  test('the front door and the OIDC callback refuse people outside SIGN_IN_GROUPS, and nobody refused is created', async () => {
    const t = await testApp({ env: { SIGN_IN_GROUPS: 'employees, staff' } });
    expect((await t.json('/api/v1/me', { headers: { 'x-forwarded-user': 'guest@partner.example', 'x-forwarded-groups': 'partners' } })).status).toBe(401);
    expect((await t.json('/api/v1/me', { headers: { 'x-forwarded-user': 'pat@example.com', 'x-forwarded-groups': 'staff' } })).status).toBe(200);

    const ctx = await testContext({ env: { AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://issuer.example/', OIDC_CLIENT_ID: 'c', OIDC_CLIENT_SECRET: 's', SIGN_IN_GROUPS: 'employees' } });
    let groups: string[] = [];
    const oidc: OidcProvider = { begin: async () => ({ url: 'https://issuer.example/authorize', flowCookie: 'f' }), complete: async () => ({ signIn: { subject: `sub-${groups.join('-') || 'none'}`, email: 'x@example.com', groups }, returnTo: '/' }) };
    const app = createHubApp(ctx, { oidc });
    const callback = () => app.request('/auth/callback?code=c&state=s', { headers: { cookie: `${FLOW_COOKIE}=f` } });
    groups = ['partners'];
    const refused = await callback();
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain('members of the organization only');
    groups = [];
    expect((await callback()).status).toBe(403);
    expect((await ctx.db.query('select id from users')).length).toBe(0);
    groups = ['employees'];
    const ok = await callback();
    expect(ok.status).toBe(302);
    expect(ok.headers.get('set-cookie')).toContain('vantage_session=');
    await t.ctx.db.close();
    await ctx.db.close();
  });
});

describe('admin page', () => {
  test('admins see the rules, every publication with where it goes, and the people; others get 403', async () => {
    const t = await testApp({ env: { PUBLICATION_APPROVAL: 'true', TEAM_WORKSPACES: 'granted', GUEST_LINKS: 'false' } });
    const admin = await t.bearer('admin', { admin: true });
    const { me, ws } = await withDiagram(t, 'author');
    await t.json(`/api/v1/workspaces/${ws.slug}/publications`, { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'To the wiki', document: 'sample', formats: ['png'], target: 'webhook', config: { url: 'https://wiki.example.test/in' } }) });

    expect((await t.app.request('/admin', { headers: me.headers })).status).toBe(403);
    const page = await t.app.request('/admin', { headers: admin.headers });
    expect(page.status).toBe(200);
    const html = await page.text();
    for (const s of ['To the wiki', 'https://wiki.example.test/in', 'Waits for you', '/approve', 'Admins and the people you let', 'Off on this hub', '1 publication waits for approval', 'author@example.com']) expect(html).toContain(s);
    const authorId = (await t.ctx.db.query<{ id: string }>("select id from users where subject = 'author'"))[0]!.id;
    const person = await (await t.app.request(`/admin/people/${authorId}`, { headers: admin.headers })).text();
    expect(person).toContain('Let make team workspaces');
    expect(person).toContain('author@example.com');
    expect((await t.app.request(`/admin/people/${authorId}`, { headers: me.headers })).status).toBe(403);
    const home = await (await t.app.request('/', { headers: admin.headers })).text();
    expect(home).toContain('href="/admin"');
    expect(await (await t.app.request('/', { headers: me.headers })).text()).not.toContain('href="/admin"');
    const tab = await (await t.app.request(`/w/${ws.slug}?tab=publications`, { headers: me.headers })).text();
    expect(tab).toContain('Waiting for an admin');
    await t.ctx.db.close();
  });
});

describe('sign-in failures', () => {
  test('a refused code exchange logs what the issuer said', async () => {
    const lines: Record<string, unknown>[] = [];
    const base = await testContext({ env: { AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://issuer.example/', OIDC_CLIENT_ID: 'c', OIDC_CLIENT_SECRET: 's' } });
    const ctx = { ...base, log: createLogger('debug', { write: (l) => lines.push(JSON.parse(l) as Record<string, unknown>) }) };
    const refused = new ResponseBodyError('server responded with an error in the response body', { cause: { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' }, response: new Response(null, { status: 401 }) });
    const oidc: OidcProvider = { begin: async () => ({ url: 'https://issuer.example/authorize', flowCookie: 'f' }), complete: async () => { throw refused; } };
    const res = await createHubApp(ctx, { oidc }).request('/auth/callback?code=c&state=s', { headers: { cookie: `${FLOW_COOKIE}=f` } });
    expect(res.status).toBe(400);
    expect(lines.find((l) => l['msg'] === 'auth.callback.failed')).toMatchObject({ issuerError: 'invalid_client', issuerStatus: 401, issuerDescription: 'AADSTS7000215: Invalid client secret provided.' });
    await base.db.close();
  });
});

import { describe, expect, test } from 'bun:test';
import { SAMPLE_YAML, testApp, testContext } from '../testing.ts';
import { createHubApp } from './app.ts';

const PAGE = { accept: 'text/html,application/xhtml+xml', 'sec-fetch-dest': 'document' };

async function diagram(): Promise<{ t: Awaited<ReturnType<typeof testApp>>; path: string }> {
  const t = await testApp();
  const me = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
  const created = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML }) });
  expect(created.status).toBe(201);
  return { t, path: `/w/${ws.slug}/${(created.body['document'] as { slug: string }).slug}` };
}

describe('browser pages never answer with JSON', () => {
  test('a signed-out reader opening a diagram under OIDC goes through sign-in and back to the same address', async () => {
    const ctx = await testContext({ env: { AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://issuer.example/', OIDC_CLIENT_ID: 'c', OIDC_CLIENT_SECRET: 's' } });
    const app = createHubApp(ctx);
    const res = await app.request('/w/platform-engineering/cmt-login?view=run', { headers: PAGE });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/signin?return=${encodeURIComponent('/w/platform-engineering/cmt-login?view=run')}`);
    const home = await app.request('/', { headers: PAGE });
    expect(home.headers.get('location')).toBe('/signin');
    // The viewer's own fetches keep the JSON answer the script reads.
    const bundle = await app.request('/w/platform-engineering/cmt-login/api/bundle', { headers: { accept: '*/*' } });
    expect(bundle.status).toBe(401);
    expect(await bundle.json()).toEqual({ error: 'sign in required' });
    await ctx.db.close();
  });

  test('a signed-in reader without access sees a page that says so, not JSON', async () => {
    const { t, path } = await diagram();
    const outsider = await t.app.request(path, { headers: { ...PAGE, 'x-forwarded-user': 'outsider@example.com' } });
    expect(outsider.status).toBe(404);
    expect(outsider.headers.get('content-type')).toContain('text/html');
    expect(await outsider.text()).toContain('you do not have access to it');
    const owner = await t.app.request(path, { headers: { ...PAGE, 'x-forwarded-user': 'author' } });
    expect(owner.status).toBe(200);
    await t.ctx.db.close();
  });

  test('a page with no route and a signed-out page outside OIDC show a message; API clients keep JSON', async () => {
    const { t, path } = await diagram();
    const missing = await t.app.request('/nowhere/at/all/here', { headers: PAGE });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('<h1>Not found</h1>');
    const signedOut = await t.app.request(path, { headers: PAGE });
    expect(signedOut.status).toBe(401);
    expect(await signedOut.text()).toContain('Sign in to continue');
    const api = await t.app.request(path, { headers: { accept: 'application/json' } });
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: 'sign in required' });
    await t.ctx.db.close();
  });
});

import { describe, expect, test } from 'bun:test';
import { testApp, type TestApp } from '../testing.ts';
import { base64url } from '../crypto.ts';

const PERSON = { 'x-forwarded-user': 'pat@example.com' };
const FORM = { ...PERSON, 'content-type': 'application/x-www-form-urlencoded', origin: 'http://hub.test' };
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'a-verifier-long-enough-for-pkce-0123456789abcdef';

async function challenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

async function register(t: TestApp, redirect = REDIRECT): Promise<string> {
  const res = await t.app.request('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirect], token_endpoint_auth_method: 'none' }) });
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

function request(clientId: string, code_challenge: string, extra: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge, code_challenge_method: 'S256', state: 'st-1', ...extra });
}

/** Approves a request as the person and returns the code the redirect carries. */
async function approve(t: TestApp, clientId: string): Promise<string> {
  const res = await t.app.request('/oauth/authorize', { method: 'POST', headers: FORM, body: new URLSearchParams({ ...Object.fromEntries(request(clientId, await challenge(VERIFIER))), decision: 'allow' }).toString() });
  expect(res.status).toBe(302);
  const to = new URL(res.headers.get('location')!);
  expect(`${to.origin}${to.pathname}`).toBe(REDIRECT);
  expect(to.searchParams.get('state')).toBe('st-1');
  expect(to.searchParams.get('iss')).toBe('http://hub.test');
  return to.searchParams.get('code')!;
}

async function token(t: TestApp, body: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await t.app.request('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const mcpList = async (t: TestApp, bearer: string): Promise<Response> =>
  t.app.request('/mcp', { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });

describe('agents sign in through the hub', () => {
  test('/mcp points a client at the hub, and the hub describes itself as the authorization server', async () => {
    const t = await testApp();
    const refused = await t.app.request('/mcp', { method: 'POST' });
    expect(refused.status).toBe(401);
    expect(refused.headers.get('www-authenticate')).toContain('resource_metadata="http://hub.test/.well-known/oauth-protected-resource/mcp"');
    const resource = (await (await t.app.request('/.well-known/oauth-protected-resource/mcp')).json()) as Record<string, unknown>;
    expect(resource['authorization_servers']).toEqual(['http://hub.test']);
    const server = (await (await t.app.request('/.well-known/oauth-authorization-server')).json()) as Record<string, unknown>;
    expect(server).toMatchObject({ issuer: 'http://hub.test', registration_endpoint: 'http://hub.test/oauth/register', code_challenge_methods_supported: ['S256'] });
  });

  test('register, approve, trade the code, call /mcp, refresh, then disconnect', async () => {
    const t = await testApp();
    const clientId = await register(t);
    const page = await t.app.request(`/oauth/authorize?${request(clientId, await challenge(VERIFIER))}`, { headers: PERSON });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Connect Claude?');

    const code = await approve(t, clientId);
    const first = await token(t, { grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: VERIFIER });
    expect(first.status).toBe(200);
    expect(first.json['expires_in']).toBe(3600);
    expect((await mcpList(t, String(first.json['access_token']))).status).toBe(200);
    expect((await token(t, { grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: VERIFIER })).status).toBe(400);

    const next = await token(t, { grant_type: 'refresh_token', refresh_token: String(first.json['refresh_token']), client_id: clientId });
    expect(next.status).toBe(200);
    expect((await mcpList(t, String(first.json['access_token']))).status).toBe(401);
    expect((await mcpList(t, String(next.json['access_token']))).status).toBe(200);
    expect((await token(t, { grant_type: 'refresh_token', refresh_token: String(first.json['refresh_token']), client_id: clientId })).status).toBe(400);

    const account = await (await t.app.request('/account', { headers: PERSON })).text();
    expect(account).toContain('Connected apps');
    const listed = (await (await t.app.request('/api/v1/connections', { headers: PERSON })).json()) as { connections: { id: string; name: string }[] };
    expect(listed.connections.map((x) => x.name)).toEqual(['Claude']);
    expect((await t.app.request(`/api/v1/connections/${listed.connections[0]!.id}`, { method: 'DELETE', headers: { ...PERSON, origin: 'http://hub.test' } })).status).toBe(204);
    expect((await mcpList(t, String(next.json['access_token']))).status).toBe(401);
    expect((await token(t, { grant_type: 'refresh_token', refresh_token: String(next.json['refresh_token']), client_id: clientId })).status).toBe(400);
  });

  test('a wrong verifier, another client, or another redirect gets no token', async () => {
    const t = await testApp();
    const clientId = await register(t);
    const other = await register(t);
    const base = { grant_type: 'authorization_code', client_id: clientId, redirect_uri: REDIRECT, code_verifier: VERIFIER };
    expect((await token(t, { ...base, code: await approve(t, clientId), code_verifier: 'not-the-verifier-0123456789abcdef0123' })).status).toBe(400);
    expect((await token(t, { ...base, code: await approve(t, clientId), client_id: other })).status).toBe(400);
    expect((await token(t, { ...base, code: await approve(t, clientId), redirect_uri: 'https://claude.ai/elsewhere' })).status).toBe(400);
  });

  test('an unregistered redirect is shown, never followed; deny goes back as access_denied; no PKCE is refused', async () => {
    const t = await testApp();
    const clientId = await register(t);
    const stray = await t.app.request(`/oauth/authorize?${request(clientId, 'x', { redirect_uri: 'https://evil.example/cb' })}`, { headers: PERSON });
    expect(stray.status).toBe(400);
    expect(stray.headers.get('location')).toBeNull();
    const denied = await t.app.request('/oauth/authorize', { method: 'POST', headers: FORM, body: new URLSearchParams({ ...Object.fromEntries(request(clientId, 'x')), decision: 'deny' }).toString() });
    expect(new URL(denied.headers.get('location')!).searchParams.get('error')).toBe('access_denied');
    const plain = await t.app.request(`/oauth/authorize?${request(clientId, '', { code_challenge_method: '' })}`, { headers: PERSON });
    expect(new URL(plain.headers.get('location')!).searchParams.get('error')).toBe('invalid_request');
  });

  test('a client registers only https redirects or loopback ones, and approving needs a person, not a token', async () => {
    const t = await testApp();
    const bad = await t.app.request('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }) });
    expect(bad.status).toBe(400);
    await register(t, 'http://127.0.0.1:33418/callback');
    const clientId = await register(t);
    const me = await t.bearer('pat');
    const res = await t.app.request('/oauth/authorize', { method: 'POST', headers: { ...me.headers, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...Object.fromEntries(request(clientId, 'x')), decision: 'allow' }).toString() });
    expect(res.status).toBe(401);
  });
});

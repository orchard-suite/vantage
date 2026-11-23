import { describe, expect, test } from 'bun:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fakeFetch, testContext } from '../testing.ts';
import { silentLogger } from '../log.ts';
import { createHubApp } from '../web/app.ts';
import { ensureUser } from './identity.ts';
import { DEFAULT_ORG } from './authenticate.ts';
import { createIssuerTokens, issuerTokensFrom } from './issuer-token.ts';

const ISSUER = 'https://login.example/tenant/v2.0';
const CLIENT = 'hub-client-id';
const GROUP = 'Employees';

async function issuer() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const sign = (claims: Record<string, unknown>, opts: { aud?: string; iss?: string; key?: CryptoKey } = {}) =>
    new SignJWT({ scp: 'access_as_user', email: 'pat@example.com', name: 'Pat', groups: [GROUP], ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(opts.iss ?? ISSUER)
      .setAudience(opts.aud ?? CLIENT)
      .setSubject('pat-subject')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(opts.key ?? privateKey);
  const tokens = (personClaim: string) => issuerTokensFrom({ issuer: ISSUER, audiences: [CLIENT, `api://${CLIENT}`], scopeName: 'access_as_user', groupsClaim: 'groups', personClaim, keys: createLocalJWKSet({ keys: [jwk] }) }, silentLogger);
  return { jwk, sign, tokens: tokens('sub'), entra: tokens('oid') };
}

async function hub(personClaim: 'sub' | 'oid' = 'sub') {
  const made = await issuer();
  const iss = { ...made, tokens: personClaim === 'oid' ? made.entra : made.tokens };
  const base = await testContext({ env: { AUTH_MODE: 'proxy', SIGN_IN_GROUPS: GROUP, OIDC_ISSUER: ISSUER } });
  const ctx = { ...base, issuerTokens: iss.tokens };
  return { ...iss, ctx, app: createHubApp(ctx) };
}

const mcpInit = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } };
const post = (token: string) => ({ method: 'POST', body: JSON.stringify(mcpInit), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' } });

describe('issuer access tokens on /mcp', () => {
  test('a token the issuer signed for the hub acts as the same user a browser sign-in made', async () => {
    const h = await hub();
    const browser = await ensureUser(h.ctx.db, silentLogger, DEFAULT_ORG, { subject: 'pat-subject', email: 'pat@example.com' });
    const transport = new StreamableHTTPClientTransport(new URL('http://hub.test/mcp'), {
      fetch: (input, init) => Promise.resolve(h.app.request(String(input), init)),
      requestInit: { headers: { authorization: `Bearer ${await h.sign({})}` } },
    });
    const client = new Client({ name: 'copilot', version: '0' });
    await client.connect(transport);
    const ws = (await client.callTool({ name: 'vantage_outline', arguments: {} })).content as { text: string }[];
    expect(ws[0]!.text).toContain('pat');
    const users = await h.ctx.db.query<{ id: string }>('select id from users');
    expect(users.map((u) => u.id)).toEqual([browser.user.id]);
    await client.close();
    await h.ctx.db.close();
  });

  test('the application URI is accepted as the audience too', async () => {
    const h = await hub();
    expect((await h.app.request('/mcp', post(await h.sign({}, { aud: `api://${CLIENT}` })))).status).toBe(200);
    await h.ctx.db.close();
  });

  test('a token for another audience, from another issuer, signed by another key, without the scope, or for an outsider is refused', async () => {
    const h = await hub();
    const stranger = (await generateKeyPair('RS256')).privateKey;
    const refused = [
      await h.sign({}, { aud: 'https://graph.microsoft.com' }),
      await h.sign({}, { iss: 'https://login.example/other/v2.0' }),
      await h.sign({}, { key: stranger }),
      await h.sign({ scp: 'User.Read' }),
      await h.sign({ groups: ['Contractors'] }),
    ];
    for (const token of refused) {
      const res = await h.app.request('/mcp', post(token));
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain('resource_metadata="http://hub.test/.well-known/oauth-protected-resource/mcp"');
    }
    expect((await h.ctx.db.query('select id from users')).length).toBe(0);
    await h.ctx.db.close();
  });

});

/** A tracking read as the bearer: who the hub says they are. */
async function me(h: Awaited<ReturnType<typeof hub>>, token: string): Promise<string> {
  const res = await h.app.request('/api/v1/me', { headers: { authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { userId: string }).userId;
}

describe('a person through any app is one user (docs/decisions/2006)', () => {
  // Entra gives each app its own sub for the same person; oid is the same in all of them.
  const viaForms = { oid: 'pat-oid', azp: 'forms-client', sub: 'pat-sub-for-forms' };
  const viaCopilot = { oid: 'pat-oid', azp: 'copilot-client', sub: 'pat-sub-for-copilot' };

  test('two apps acting for the same person reach the same user, and each act names its app', async () => {
    const h = await hub('oid');
    const a = await me(h, await h.sign(viaForms));
    const b = await me(h, await h.sign(viaCopilot));
    expect(b).toBe(a);
    expect((await h.ctx.db.query('select id from users')).length).toBe(1);
    expect(await h.tokens.verify(await h.sign(viaForms))).toMatchObject({ signIn: { person: 'pat-oid', client: 'forms-client' } });
    await h.ctx.db.close();
  });

  test('a person the front door made is found once by address, then by the issuer id', async () => {
    const h = await hub('oid');
    const door = await ensureUser(h.ctx.db, silentLogger, DEFAULT_ORG, { subject: 'pat@example.com', email: 'pat@example.com' });
    expect(await me(h, await h.sign(viaForms))).toBe(door.user.id);
    expect(await me(h, await h.sign({ ...viaCopilot, email: 'pat.renamed@example.com' }))).toBe(door.user.id);
    expect((await h.ctx.db.query<{ person_id: string }>('select person_id from users'))).toEqual([{ person_id: 'pat-oid' }]);
    await h.ctx.db.close();
  });

  test('an address two people share, or one already tied to another id, links nobody', async () => {
    const h = await hub('oid');
    await ensureUser(h.ctx.db, silentLogger, DEFAULT_ORG, { subject: 'a', email: 'pat@example.com' });
    await ensureUser(h.ctx.db, silentLogger, DEFAULT_ORG, { subject: 'b', email: 'pat@example.com' });
    await me(h, await h.sign(viaForms));
    expect((await h.ctx.db.query('select id from users')).length).toBe(3);
    const other = await hub('oid');
    await ensureUser(other.ctx.db, silentLogger, DEFAULT_ORG, { subject: 'c', person: 'someone-else', email: 'pat@example.com' });
    await me(other, await other.sign(viaForms));
    expect((await other.ctx.db.query('select id from users')).length).toBe(2);
    await h.ctx.db.close();
    await other.ctx.db.close();
  });

  test('a browser sign-in made before the issuer id was read gets it from its own token', async () => {
    const h = await hub('oid');
    const before = await ensureUser(h.ctx.db, silentLogger, DEFAULT_ORG, { subject: 'pat-sub-for-hub', email: 'pat@example.com' });
    const after = await ensureUser(h.ctx.db, silentLogger, DEFAULT_ORG, { subject: 'pat-sub-for-hub', person: 'pat-oid', email: 'pat@example.com' });
    expect(after.user.id).toBe(before.user.id);
    expect(await me(h, await h.sign(viaForms))).toBe(before.user.id);
    await h.ctx.db.close();
  });

  test('a token without the person claim is refused', async () => {
    const h = await hub('oid');
    expect(await h.tokens.verify(await h.sign({}))).toEqual({ refused: 'oid missing' });
    await h.ctx.db.close();
  });
});

describe('issuer token setup', () => {
  test('reads the keys from the issuer discovery document, and stays off without OIDC_API_SCOPE', async () => {
    const iss = await issuer();
    const { fetch } = fakeFetch([
      { match: '/.well-known/openid-configuration', json: { issuer: ISSUER, jwks_uri: 'https://login.example/keys' } },
      { match: '/keys', json: { keys: [iss.jwk] } },
    ]);
    const ctx = await testContext();
    const env = { ...ctx.config, AUTH_MODE: 'oidc' as const, OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: CLIENT };
    expect(await createIssuerTokens(env, silentLogger, fetch)).toBeUndefined();
    const tokens = (await createIssuerTokens({ ...env, OIDC_API_SCOPE: 'access_as_user' }, silentLogger, fetch))!;
    expect(await tokens.verify(await iss.sign({}))).toEqual({ signIn: { subject: 'pat-subject', person: 'pat-subject', email: 'pat@example.com', name: 'Pat', groups: [GROUP] } });
    await ctx.db.close();
  });

  test('a front door hub takes them too, and names the hub by its application URI alone', async () => {
    const iss = await issuer();
    const { fetch } = fakeFetch([
      { match: '/.well-known/openid-configuration', json: { issuer: ISSUER, jwks_uri: 'https://login.example/keys' } },
      { match: '/keys', json: { keys: [iss.jwk] } },
    ]);
    const ctx = await testContext();
    const env = { ...ctx.config, AUTH_MODE: 'proxy' as const, OIDC_ISSUER: ISSUER, OIDC_API_SCOPE: 'access_as_user', OIDC_API_AUDIENCE: `api://${CLIENT}`, OIDC_PERSON_CLAIM: 'oid' };
    const tokens = (await createIssuerTokens(env, silentLogger, fetch))!;
    expect(await tokens.verify(await iss.sign({ oid: 'pat-oid' }, { aud: `api://${CLIENT}` }))).toMatchObject({ signIn: { subject: 'pat-oid', person: 'pat-oid' } });
    expect(await tokens.verify(await iss.sign({ oid: 'pat-oid' }))).toEqual({ refused: 'ERR_JWT_CLAIM_VALIDATION_FAILED' });
    expect(await createIssuerTokens({ ...env, AUTH_MODE: 'none' }, silentLogger, fetch)).toBeUndefined();
    await ctx.db.close();
  });
});

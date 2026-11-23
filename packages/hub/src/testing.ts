/** Test fixtures: an app context over PGlite and an in-memory blob store. */
import { trace } from '@opentelemetry/api';
import { connectPglite } from './db/pglite.ts';
import { scoped } from './db/test-scope.ts';
import { migrate } from './db/migrate.ts';
import { memoryBlobStore } from './blob/blob.ts';
import { loadConfig, type Config } from './config.ts';
import { silentLogger } from './log.ts';
import { createHubMetrics } from './metrics.ts';
import type { AppContext } from './context.ts';
import { ensureUser, type Identity } from './auth/identity.ts';
import { DEFAULT_ORG } from './auth/authenticate.ts';
import type { Principal } from './auth/principal.ts';
import { createHubApp } from './web/app.ts';
import { createToken } from './auth/tokens.ts';
import { createRegistry, type Connector } from '@vantage/connectors';
import { defaultTargets } from '@vantage/publish';
import { createRenderPool } from './render/pool.ts';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { connectorTokensFrom } from './auth/connector-token.ts';
import { issuerTokensFrom } from './auth/issuer-token.ts';
import { providerFromConfig } from './revise/provider.ts';

export const TEST_CONNECTOR_ISSUER = 'https://login.example/tenant/v2.0';
export const TEST_CONNECTOR_AUDIENCE = 'api://hub-client-id';
export const TEST_CONNECTOR_ROLE = 'Vantage.Connector';
export const TEST_POOL_ROLE = 'Vantage.ConnectorPool';
export const TEST_MODULE_ROLE = 'Vantage.Module';
export const TEST_API_SCOPE = 'access_as_user';

/** A signing key that stands in for the issuer: connector tokens the test hub accepts, and ones it must refuse. */
export async function connectorIssuer() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const sign = (clientId: string, claims: Record<string, unknown> = {}, opts: { aud?: string; iss?: string } = {}) =>
    new SignJWT({ azp: clientId, idtyp: 'app', roles: [TEST_CONNECTOR_ROLE], ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(opts.iss ?? TEST_CONNECTOR_ISSUER)
      .setAudience(opts.aud ?? TEST_CONNECTOR_AUDIENCE)
      .setSubject(`sp-${clientId}`)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  const tokens = connectorTokensFrom({ issuer: TEST_CONNECTOR_ISSUER, audiences: [TEST_CONNECTOR_AUDIENCE], role: TEST_CONNECTOR_ROLE, poolRole: TEST_POOL_ROLE, moduleRole: TEST_MODULE_ROLE, keys: createLocalJWKSet({ keys: [jwk] }) }, silentLogger);
  /** A person's token for the hub that an app got from the issuer on their behalf: Entra's shape, a sub of the app's own and the person's oid. */
  const delegated = (clientId: string, person: { oid: string; email: string }) =>
    new SignJWT({ azp: clientId, scp: TEST_API_SCOPE, oid: person.oid, email: person.email })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(TEST_CONNECTOR_ISSUER)
      .setAudience(TEST_CONNECTOR_AUDIENCE)
      .setSubject(`${person.oid}-for-${clientId}`)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  const people = issuerTokensFrom({ issuer: TEST_CONNECTOR_ISSUER, audiences: [TEST_CONNECTOR_AUDIENCE], scopeName: TEST_API_SCOPE, groupsClaim: 'groups', personClaim: 'oid', keys: createLocalJWKSet({ keys: [jwk] }) }, silentLogger);
  return { sign, tokens, delegated, people };
}

export const TEST_ENV: Record<string, string> = {
  DATABASE_URL: 'pglite://memory',
  PUBLIC_URL: 'http://hub.test',
  AUTH_MODE: 'none',
  SESSION_SECRET: 'test-session-secret-test-session-secret',
  SECRETS_KEY: 'test-secrets-key-test-secrets-key-xx',
  RETENTION_VERSIONS: '3',
  RENDER_THREADS: '0',
};

export interface TestOptions {
  readonly env?: Record<string, string>;
  /** Connectors the test registers; the default registry's network connectors stay out of tests. */
  readonly connectors?: readonly Connector[];
  readonly fetch?: typeof fetch;
}

export async function testContext(opts: TestOptions = {}): Promise<AppContext> {
  const config: Config = loadConfig({ ...TEST_ENV, ...(opts.env ?? {}) });
  const db = scoped(connectPglite());
  await migrate(db, silentLogger);
  const fetchImpl: typeof fetch = opts.fetch ?? noNetwork();
  const render = createRenderPool({ threads: config.RENDER_THREADS, timeoutMs: config.RENDER_TIMEOUT_SECONDS * 1000, maxQueue: config.RENDER_QUEUE, log: silentLogger });
  return { config, db, dbRead: db, blob: memoryBlobStore(), log: silentLogger, tracer: trace.getTracer('test'), metrics: createHubMetrics(), connectors: createRegistry(opts.connectors ?? []), targets: defaultTargets(), fetch: fetchImpl, render, ai: providerFromConfig(config, fetchImpl, silentLogger) };
}

/** A fetch that answers every request with a failure, so a test that reaches the network fails loudly. */
export function noNetwork(): typeof fetch {
  return Object.assign(async (_input: string | URL | Request, _init?: RequestInit) => new Response('no network in tests', { status: 599 }), { preconnect: () => undefined });
}

/** One request a fakeFetch saw; header names are lowercase. */
export interface FakeCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

/** A fetch that answers from a table of URL substrings to JSON bodies, and records every call. */
export function fakeFetch(routes: readonly { match: string; status?: number; json?: unknown }[]): { fetch: typeof fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetchImpl = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, method: init?.method ?? 'GET', headers: Object.fromEntries(new Headers(init?.headers).entries()), body: typeof init?.body === 'string' ? init.body : undefined });
      const route = routes.find((r) => url.includes(r.match));
      if (!route) return new Response(JSON.stringify({ error: `no route for ${url}` }), { status: 404, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify(route.json ?? {}), { status: route.status ?? 200, headers: { 'content-type': 'application/json' } });
    },
    { preconnect: () => undefined },
  );
  return { fetch: fetchImpl, calls };
}

export async function testUser(ctx: AppContext, subject: string, opts: { groups?: string[]; admin?: boolean } = {}): Promise<{ identity: Identity; principal: Principal }> {
  const identity = await ensureUser(ctx.db, ctx.log, DEFAULT_ORG, { subject, email: `${subject}@example.com`, name: subject, groups: opts.groups });
  if (opts.admin !== undefined) await ctx.db.query('update users set is_admin = $2 where id = $1', [identity.user.id, opts.admin]);
  const admin = opts.admin ?? identity.user.is_admin;
  return { identity, principal: { userId: identity.user.id, orgId: DEFAULT_ORG, subject, admin, teamIds: identity.teamIds, surface: 'api', via: 'token' } };
}

export const SAMPLE_YAML = `title: Sample
nodes:
  - name: Shoppers
    type: users
  - name: Shop API
    type: api
    subtitle: node service
    description: Takes orders
  - name: Orders DB
    type: database
relations:
  - { from: shoppers, to: shop-api, label: buys, tags: [context] }
  - { from: shop-api, to: orders-db, label: writes, tags: [context] }
views:
  - id: context
    title: Context
    question: Who talks to whom?
    include: { tags: [context] }
`;

export interface TestApp {
  readonly ctx: AppContext;
  /** A bearer header for a connector's own client: an app-only token the test issuer signs. */
  connector(clientId: string, claims?: Record<string, unknown>): Promise<Record<string, string>>;
  /** A bearer header for a person, from a token the issuer gave an app (a module) to act for them. */
  actingFor(clientId: string, person: { oid: string; email: string }): Promise<Record<string, string>>;
  /** A bearer header for the shared connector pool's own app. */
  pool(clientId?: string): Promise<Record<string, string>>;
  readonly app: ReturnType<typeof createHubApp>;
  /** A bearer header for a fresh personal token of this user. */
  bearer(subject: string, opts?: { groups?: string[]; admin?: boolean }): Promise<{ headers: Record<string, string>; principal: Principal; token: string }>;
  json(path: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<{ status: number; body: Record<string, unknown> }>;
}

/** An app in proxy mode so requests without credentials are anonymous; tests authenticate with bearer tokens. */
export async function testApp(opts: TestOptions = {}): Promise<TestApp> {
  const base = await testContext({ ...opts, env: { AUTH_MODE: 'proxy', ...(opts.env ?? {}) } });
  const issuer = await connectorIssuer();
  const ctx: AppContext = { ...base, connectorTokens: issuer.tokens, issuerTokens: issuer.people };
  const app = createHubApp(ctx);
  return {
    ctx,
    app,
    async connector(clientId, claims = {}) {
      return { authorization: `Bearer ${await issuer.sign(clientId, claims)}` };
    },
    async actingFor(clientId, person) {
      return { authorization: `Bearer ${await issuer.delegated(clientId, person)}` };
    },
    async pool(clientId = 'pool-app') {
      return { authorization: `Bearer ${await issuer.sign(clientId, { roles: [TEST_POOL_ROLE] })}` };
    },
    async bearer(subject, opts = {}) {
      const { principal } = await testUser(ctx, subject, opts);
      const { plaintext } = await createToken(ctx.db, { orgId: principal.orgId, userId: principal.userId, kind: 'personal', name: `test ${subject}` });
      return { headers: { authorization: `Bearer ${plaintext}` }, principal: { ...principal, via: 'token' }, token: plaintext };
    },
    async json(path, init = {}) {
      const headers = { 'content-type': 'application/json', ...(init.headers ?? {}) };
      const res = await app.request(path, { ...init, headers });
      const text = await res.text();
      let body: Record<string, unknown> = {};
      try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        body = { raw: text };
      }
      return { status: res.status, body: withReader(res, body) };
    },
  };
}

/** A bundle response's body with its X-Vantage-Reader fields laid over it, the way the viewer reads it. */
export function withReader(res: Response, body: Record<string, unknown>): Record<string, unknown> {
  const reader = res.headers.get('x-vantage-reader');
  return reader ? { ...body, ...(JSON.parse(Buffer.from(reader, 'base64url').toString('utf8')) as Record<string, unknown>) } : body;
}

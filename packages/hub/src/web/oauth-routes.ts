/**
 * The hub's OAuth endpoints for agents that connect to /mcp (auth/oauth.ts):
 * the authorization server metadata (RFC 8414), client registration
 * (RFC 7591), the approval page a signed-in person answers, and the token
 * endpoint. Registration and the token endpoint take no session: the agent
 * calls them from its own servers. The approval page needs the person,
 * signed in the way every other page signs them in.
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from './env.ts';
import { DEFAULT_ORG } from '../auth/authenticate.ts';
import { ACCESS_SECONDS, allowedRedirect, exchangeCode, findClient, issueCode, refresh, registerClient, type OAuthClient, type TokenResult } from '../auth/oauth.ts';
import { audit } from '../audit.ts';
import { HttpError, unauthorized } from '../http.ts';
import { clientAddress, createRateLimiter } from '../ratelimit.ts';
import { messageHtml, oauthApproveHtml } from './html.ts';

/** The one scope the hub grants: everything the person may do through /mcp. */
export const MCP_SCOPE = 'mcp';

export function authorizationMetadata(publicUrl: string): Record<string, unknown> {
  return {
    issuer: publicUrl,
    authorization_endpoint: `${publicUrl}/oauth/authorize`,
    token_endpoint: `${publicUrl}/oauth/token`,
    registration_endpoint: `${publicUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [MCP_SCOPE],
  };
}

const Registration = z.object({
  client_name: z.string().trim().min(1).max(100).optional(),
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

/** What an authorization request carries, from the query (GET) or the approval form (POST). */
interface AuthRequest {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly responseType: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: string;
  readonly state: string;
}

function readRequest(get: (k: string) => string | undefined): AuthRequest {
  return {
    clientId: get('client_id') ?? '',
    redirectUri: get('redirect_uri') ?? '',
    responseType: get('response_type') ?? '',
    codeChallenge: get('code_challenge') ?? '',
    codeChallengeMethod: get('code_challenge_method') ?? '',
    state: get('state') ?? '',
  };
}

function back(r: AuthRequest, params: Record<string, string>, issuer: string): string {
  const u = new URL(r.redirectUri);
  for (const [k, v] of Object.entries({ ...params, ...(r.state ? { state: r.state } : {}), iss: issuer })) u.searchParams.set(k, v);
  return u.toString();
}

const tokenError = (c: Context<HubEnv>, error: string, description: string, status: 400 | 401 = 400): Response =>
  c.json({ error, error_description: description }, status, { 'cache-control': 'no-store' });

export function oauthRoutes(ctx: AppContext): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  const issuer = ctx.config.PUBLIC_URL;
  const limiter = createRateLimiter(30, 60_000);
  const limit = (c: Context<HubEnv>): void => {
    if (!limiter.allow(clientAddress(c.req.raw))) throw new HttpError(429, 'too many sign-in requests');
  };

  const metadata = authorizationMetadata(issuer);
  app.get('/.well-known/oauth-authorization-server', (c) => c.json(metadata));
  app.get('/.well-known/oauth-authorization-server/*', (c) => c.json(metadata));

  app.post('/oauth/register', async (c) => {
    limit(c);
    const parsed = Registration.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: 'invalid_client_metadata', error_description: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    const bad = parsed.data.redirect_uris.find((u) => !allowedRedirect(u));
    if (bad) return c.json({ error: 'invalid_redirect_uri', error_description: `redirect URIs must be https, or http to localhost: ${bad}` }, 400);
    const client = await registerClient(ctx.db, DEFAULT_ORG, parsed.data.client_name ?? 'An agent', parsed.data.redirect_uris);
    ctx.log.info('oauth.client.registered', { clientId: client.id, name: client.name, redirects: client.redirectUris.length });
    return c.json({ client_id: client.id, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: client.name, redirect_uris: client.redirectUris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, 201);
  });

  /** The client and its redirect, checked before anything goes back to the redirect: a bad one is shown here, never followed. */
  async function checked(c: Context<HubEnv>, r: AuthRequest): Promise<{ client: OAuthClient } | { page: Response }> {
    const client = r.clientId ? await findClient(ctx.db, r.clientId) : undefined;
    if (!client || !client.redirectUris.includes(r.redirectUri)) {
      ctx.log.warn('oauth.authorize.refused', { reason: client ? 'redirect not registered' : 'client unknown', clientId: r.clientId });
      return { page: c.html(messageHtml('This link does not work', 'The app that sent you here is not registered with this hub, or sent you from an address it did not register. Start again from the app.', c.get('nonce')), 400) };
    }
    return { client };
  }

  app.get('/oauth/authorize', async (c) => {
    const r = readRequest((k) => c.req.query(k));
    const ok = await checked(c, r);
    if ('page' in ok) return ok.page;
    if (r.responseType !== 'code') return c.redirect(back(r, { error: 'unsupported_response_type' }, issuer));
    if (!r.codeChallenge || r.codeChallengeMethod !== 'S256') return c.redirect(back(r, { error: 'invalid_request', error_description: 'PKCE with S256 is required' }, issuer));
    const p = c.get('principal');
    if (!p) {
      if (ctx.config.AUTH_MODE === 'oidc') return c.redirect(`/signin?return=${encodeURIComponent(c.req.url.slice(c.req.url.indexOf('/oauth/')))}`);
      throw unauthorized();
    }
    if (p.via === 'token' || p.via === 'issuer' || p.via === 'connector') throw unauthorized('approve an app from a browser');
    return c.html(oauthApproveHtml(c.get('nonce'), { clientName: ok.client.name, redirectHost: new URL(r.redirectUri).host, fields: { client_id: r.clientId, redirect_uri: r.redirectUri, response_type: r.responseType, code_challenge: r.codeChallenge, code_challenge_method: r.codeChallengeMethod, state: r.state } }));
  });

  app.post('/oauth/authorize', async (c) => {
    const p = c.get('principal');
    if (!p || p.via === 'token' || p.via === 'issuer' || p.via === 'connector') throw unauthorized('approve an app from a browser');
    const form = await c.req.parseBody();
    const r = readRequest((k) => (typeof form[k] === 'string' ? (form[k] as string) : undefined));
    const ok = await checked(c, r);
    if ('page' in ok) return ok.page;
    if (r.responseType !== 'code' || !r.codeChallenge || r.codeChallengeMethod !== 'S256') return c.redirect(back(r, { error: 'invalid_request' }, issuer));
    if (form['decision'] !== 'allow') {
      ctx.log.info('oauth.authorize.denied', { clientId: r.clientId, userId: p.userId });
      return c.redirect(back(r, { error: 'access_denied' }, issuer));
    }
    const code = await issueCode(ctx.db, { clientId: r.clientId, userId: p.userId, redirectUri: r.redirectUri, codeChallenge: r.codeChallenge });
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: p.userId, what: 'connection.approve', surface: 'browser', target: `user:${p.userId}`, details: { clientId: r.clientId, client: ok.client.name } });
    return c.redirect(back(r, { code }, issuer));
  });

  app.post('/oauth/token', async (c) => {
    limit(c);
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const field = (k: string): string => (typeof form[k] === 'string' ? (form[k] as string) : '');
    const clientId = field('client_id');
    if (!clientId) return tokenError(c, 'invalid_client', 'client_id is required', 401);
    let result: TokenResult;
    if (field('grant_type') === 'authorization_code') {
      if (!field('code') || !field('code_verifier') || !field('redirect_uri')) return tokenError(c, 'invalid_request', 'code, code_verifier, and redirect_uri are required');
      result = await exchangeCode(ctx.db, { code: field('code'), clientId, redirectUri: field('redirect_uri'), codeVerifier: field('code_verifier') });
    } else if (field('grant_type') === 'refresh_token') {
      if (!field('refresh_token')) return tokenError(c, 'invalid_request', 'refresh_token is required');
      result = await refresh(ctx.db, { refreshToken: field('refresh_token'), clientId });
    } else {
      return tokenError(c, 'unsupported_grant_type', 'authorization_code or refresh_token');
    }
    if (!result.ok) {
      ctx.log.warn('oauth.token.refused', { clientId, grantType: field('grant_type'), why: result.why });
      return tokenError(c, result.error, result.why, result.error === 'invalid_client' ? 401 : 400);
    }
    ctx.log.info('oauth.token.issued', { clientId, grantType: field('grant_type'), grantId: result.issued.grantId });
    return c.json({ access_token: result.issued.accessToken, token_type: 'Bearer', expires_in: ACCESS_SECONDS, refresh_token: result.issued.refreshToken, scope: MCP_SCOPE }, 200, { 'cache-control': 'no-store' });
  });

  return app;
}

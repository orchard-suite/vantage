/** Sign-in, sign-out, and the device code flow for agents. */
import { Hono } from 'hono';
import { AuthorizationResponseError, ResponseBodyError } from 'openid-client';
import type { AppContext } from '../context.ts';
import type { HubEnv } from './env.ts';
import type { OidcProvider } from '../auth/oidc.ts';
import { safeReturn } from '../auth/oidc.ts';
import { ensureUser } from '../auth/identity.ts';
import { DEFAULT_ORG, refusedSignIn } from '../auth/authenticate.ts';
import { cookieHeader, FLOW_COOKIE, sealSession, readCookie, SESSION_COOKIE } from '../auth/session.ts';
import { approveDevice, pollDevice, startDevice } from '../auth/device.ts';
import { audit } from '../audit.ts';
import { badRequest, HttpError, unauthorized } from '../http.ts';
import { deviceApproveHtml, messageHtml, signInHtml } from './html.ts';
import { createRateLimiter, clientAddress } from '../ratelimit.ts';

/** What the issuer said when it refused a step of the sign-in: its error, HTTP status, and description (Entra's carries the AADSTS code). */
function issuerSaid(err: unknown): Record<string, unknown> {
  if (!(err instanceof ResponseBodyError) && !(err instanceof AuthorizationResponseError)) return {};
  const description = err instanceof ResponseBodyError ? err.cause['error_description'] : err.cause.get('error_description');
  return { issuerError: err.error, ...(err instanceof ResponseBodyError ? { issuerStatus: err.status } : {}), ...(typeof description === 'string' ? { issuerDescription: description.slice(0, 500) } : {}) };
}

export function authRoutes(ctx: AppContext, oidc: OidcProvider | undefined): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  const secure = ctx.config.PUBLIC_URL.startsWith('https://');
  const deviceLimiter = createRateLimiter(30, 60_000);

  // The sign-in page: one way in, the organization's identity provider, and where the reader was going.
  app.get('/signin', (c) => {
    if (!oidc) return c.html(messageHtml('Sign in', `Sign-in runs in ${ctx.config.AUTH_MODE} mode; there is no login page.`, c.get('nonce')));
    const returnTo = safeReturn(c.req.query('return'));
    if (c.get('principal')) return c.redirect(returnTo);
    return c.html(signInHtml(c.get('nonce'), returnTo));
  });

  app.get('/auth/login', async (c) => {
    if (!oidc) return c.html(messageHtml('Sign in', `Sign-in runs in ${ctx.config.AUTH_MODE} mode; there is no login page.`, c.get('nonce')));
    const { url, flowCookie } = await oidc.begin(c.req.query('return') ?? '/');
    return new Response(null, { status: 302, headers: { location: url, 'set-cookie': cookieHeader(FLOW_COOKIE, flowCookie, { maxAge: 600, secure }) } });
  });

  app.get('/auth/callback', async (c) => {
    if (!oidc) throw badRequest('oidc is not configured');
    const log = ctx.log.child({ requestId: c.get('requestId') });
    let completed: Awaited<ReturnType<OidcProvider['complete']>>;
    try {
      completed = await oidc.complete(new URL(c.req.url).search, readCookie(c.req.header('cookie'), FLOW_COOKIE));
    } catch (err) {
      log.warn('auth.callback.failed', { error: err as Error, ...issuerSaid(err) });
      return c.html(signInHtml(c.get('nonce'), '/', 'Sign-in did not finish. Try again; if it keeps failing, your identity provider may have refused this hub.'), 400);
    }
    if (refusedSignIn(ctx.config, completed.signIn.groups)) {
      log.warn('auth.signin.refused', { reason: 'not in SIGN_IN_GROUPS', groups: completed.signIn.groups?.length ?? 0 });
      return c.html(messageHtml('Not for this account', 'This hub is open to members of the organization only. If you should have access, ask an admin to add you to the right group.', c.get('nonce')), 403);
    }
    const { user } = await ensureUser(ctx.db, log, DEFAULT_ORG, completed.signIn);
    if (user.disabled_at) return c.html(messageHtml('Account disabled', 'This account is disabled on this hub. An admin can turn it back on.', c.get('nonce')), 403);
    await audit(ctx.db, log, { orgId: user.org_id, who: user.id, what: 'auth.signin', surface: 'browser', target: `user:${user.id}`, details: { mode: 'oidc' } });
    const headers = new Headers({ location: safeReturn(completed.returnTo) });
    headers.append('set-cookie', cookieHeader(SESSION_COOKIE, await sealSession(ctx.config.SESSION_SECRET, user.id), { maxAge: 7 * 86_400, secure }));
    headers.append('set-cookie', cookieHeader(FLOW_COOKIE, '', { maxAge: 0, secure }));
    return new Response(null, { status: 302, headers });
  });

  app.get('/auth/logout', async (c) => {
    const p = c.get('principal');
    if (p) await audit(ctx.db, ctx.log, { orgId: p.orgId, who: p.userId, what: 'auth.signout', surface: 'browser', target: `user:${p.userId}` });
    return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': cookieHeader(SESSION_COOKIE, '', { maxAge: 0, secure }) } });
  });

  app.post('/auth/device', async (c) => {
    if (!deviceLimiter.allow(clientAddress(c.req.raw))) throw new HttpError(429, 'too many device requests');
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    const start = await startDevice(ctx.db, DEFAULT_ORG, body.name ?? 'device');
    ctx.log.info('device.start', { name: body.name ?? 'device' });
    return c.json({ device_code: start.deviceCode, user_code: start.userCode, verification_uri: `${ctx.config.PUBLIC_URL}/auth/device/approve`, verification_uri_complete: `${ctx.config.PUBLIC_URL}/auth/device/approve?code=${start.userCode}`, expires_in: start.expiresIn, interval: 5 });
  });

  app.post('/auth/device/token', async (c) => {
    if (!deviceLimiter.allow(clientAddress(c.req.raw))) throw new HttpError(429, 'too many device requests');
    const body = (await c.req.json().catch(() => ({}))) as { device_code?: string };
    if (!body.device_code) throw badRequest('device_code is required');
    const poll = await pollDevice(ctx.db, ctx.config.SECRETS_KEY, body.device_code);
    if (poll.status === 'approved') return c.json({ access_token: poll.token, token_type: 'bearer' });
    return c.json({ error: poll.status === 'pending' ? 'authorization_pending' : 'expired_token' }, 400);
  });

  app.get('/auth/device/approve', (c) => {
    if (!c.get('principal')) {
      if (oidc) return c.redirect(`/signin?return=${encodeURIComponent(c.req.path + (c.req.query('code') ? `?code=${c.req.query('code')}` : ''))}`);
      throw unauthorized();
    }
    return c.html(deviceApproveHtml(c.get('nonce'), 'form', c.req.query('code') ?? ''));
  });

  app.post('/auth/device/approve', async (c) => {
    const p = c.get('principal');
    if (!p || p.via === 'token' || p.via === 'issuer') throw unauthorized('approve devices from a browser session');
    const form = await c.req.parseBody();
    const code = typeof form['code'] === 'string' ? form['code'] : '';
    const ok = await approveDevice(ctx.db, ctx.log, ctx.config.SECRETS_KEY, p.orgId, code, p.userId);
    if (ok) await audit(ctx.db, ctx.log, { orgId: p.orgId, who: p.userId, what: 'token.create', surface: 'browser', target: `user:${p.userId}`, details: { via: 'device' } });
    return c.html(deviceApproveHtml(c.get('nonce'), ok ? 'approved' : 'unknown', code), ok ? 200 : 404);
  });

  return app;
}

/**
 * Request middleware: a request id and span, structured start and end
 * lines, security headers, authentication, CSRF for cookie sessions, and
 * the error handler that turns HttpError into JSON for clients and a page
 * for a browser.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import { context, propagation, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { AppContext } from '../context.ts';
import { authenticate } from '../auth/authenticate.ts';
import { randomId } from '../crypto.ts';
import { HttpError } from '../http.ts';
import type { HubEnv } from './env.ts';
import type { Surface } from '../audit.ts';
import { PictureTooLargeError } from '@vantage/render';
import { PoolBusyError } from '../render/pool.ts';
import { isPageRequest, pageError } from './page-errors.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requestLog(ctx: AppContext): MiddlewareHandler<HubEnv> {
  return async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? randomId(8);
    c.set('requestId', requestId);
    c.set('nonce', randomId(12));
    const started = Date.now();
    const log = ctx.log.child({ requestId });
    // A caller's traceparent (a browser span, another service) is continued, so one trace spans both.
    const parent = propagation.extract(context.active(), Object.fromEntries(c.req.raw.headers));
    await ctx.tracer.startActiveSpan(`${c.req.method} ${c.req.path}`, { kind: SpanKind.SERVER, attributes: { 'http.request.method': c.req.method, 'url.path': c.req.path, 'request.id': requestId } }, parent, async (span) => {
      try {
        log.debug('request.start', { method: c.req.method, path: c.req.path });
        await next();
        // After next() the route index points at the handler that answered.
        const route = routePath(c);
        span.updateName(`${c.req.method} ${route}`);
        span.setAttributes({ 'http.route': route, 'http.response.status_code': c.res.status });
        span.setStatus({ code: c.res.status >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK });
        ctx.metrics.requestDuration.record((Date.now() - started) / 1000, { 'http.route': route, 'http.request.method': c.req.method, 'http.response.status_code': c.res.status });
        c.res.headers.set('x-request-id', requestId);
        const fields = { method: c.req.method, route, path: c.req.path, status: c.res.status, ms: Date.now() - started, user: c.get('principal')?.userId ?? null };
        if (c.res.status >= 500) log.error('request.end', fields);
        // A viewer posts presence beats every few seconds, up to five a second while presenting; their outcome is logged as presence.*.
        else if (c.res.status < 400 && route.endsWith('/api/presence')) log.debug('request.end', fields);
        else log.info('request.end', fields);
      } finally {
        span.end();
      }
    });
  };
}

export function securityHeaders(): MiddlewareHandler<HubEnv> {
  return async (c, next) => {
    await next();
    c.res.headers.set('x-content-type-options', 'nosniff');
    c.res.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
    // A page names the viewer script by the hub's version, so a browser must ask for the page again to get a new release.
    if (c.res.headers.get('content-type')?.startsWith('text/html') && !c.res.headers.has('cache-control')) c.res.headers.set('cache-control', 'no-cache');
    if (!c.res.headers.has('content-security-policy')) {
      c.res.headers.set('content-security-policy', csp(c.get('nonce')));
    }
  };
}

/**
 * The policy the viewer runs under: self plus a nonce for the inline boot
 * script; fonts and images may be data URIs. A page frames nowhere, and an
 * embed frames in the hub and the origins it is given.
 */
export function csp(nonce: string, opts: { embedIn?: readonly string[] } = {}): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // A voice walkthrough plays from the hub, or from the browser's own take before it is saved.
    "media-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    `frame-ancestors ${opts.embedIn ? ["'self'", ...opts.embedIn].join(' ') : "'none'"}`,
  ].join('; ');
}

export function authMiddleware(ctx: AppContext): MiddlewareHandler<HubEnv> {
  return async (c, next) => {
    const surface: Surface = c.req.path.startsWith('/mcp') ? 'mcp' : c.req.path.startsWith('/api/v1') ? 'api' : 'browser';
    const { principal, csrf } = await authenticate(ctx.db, ctx.config, ctx.log.child({ requestId: c.get('requestId') }), c.req.raw, surface, ctx.issuerTokens, ctx.connectorTokens);
    if (principal) c.set('principal', principal);
    if (csrf) c.set('csrf', csrf);
    await next();
  };
}

/** Browser-authenticated writes (session cookie, or proxy headers a browser carries) must come from our own origin or carry the session's CSRF token. Tokens and the local developer are exempt. */
export function csrfGuard(publicUrl: string): MiddlewareHandler<HubEnv> {
  const origin = new URL(publicUrl).origin;
  return async (c, next) => {
    const p = c.get('principal');
    if (p && (p.via === 'session' || p.via === 'proxy') && !SAFE_METHODS.has(c.req.method)) {
      const reqOrigin = c.req.header('origin') ?? (c.req.header('referer') ? new URL(c.req.header('referer')!).origin : undefined);
      const header = c.req.header('x-csrf-token');
      const ok = reqOrigin === origin || (header !== undefined && header === c.get('csrf'));
      if (!ok) throw new HttpError(403, 'cross-site request rejected', { expectedOrigin: origin });
    }
    await next();
  };
}

export function errorHandler(ctx: AppContext) {
  return (err: Error, c: Context<HubEnv>): Response => {
    if (err instanceof HttpError) {
      ctx.log.info('request.error', { requestId: c.get('requestId'), status: err.status, message: err.message, page: isPageRequest(c) });
      if (isPageRequest(c)) return pageError(c, ctx.config, err.status);
      return c.json({ error: err.message, ...(err.details ? { details: err.details } : {}) }, err.status as 400);
    }
    if (err instanceof PoolBusyError) {
      ctx.log.warn('request.busy', { requestId: c.get('requestId'), path: c.req.path, queued: err.queued });
      if (isPageRequest(c)) return pageError(c, ctx.config, 503);
      return c.json({ error: 'the hub is busy drawing; try again shortly' }, 503, { 'retry-after': '5' });
    }
    if (err.name === PictureTooLargeError.NAME) {
      ctx.log.info('request.error', { requestId: c.get('requestId'), status: 422, message: err.message, page: isPageRequest(c) });
      if (isPageRequest(c)) return pageError(c, ctx.config, 422);
      return c.json({ error: err.message }, 422);
    }
    ctx.log.error('request.failed', { requestId: c.get('requestId'), path: c.req.path, error: err });
    if (isPageRequest(c)) return pageError(c, ctx.config, 500);
    return c.json({ error: 'internal error', requestId: c.get('requestId') }, 500);
  };
}

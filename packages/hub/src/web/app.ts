/** Assembles the hub: middleware, pages, auth, API, MCP, and health. */
import { oauthRoutes } from './oauth-routes.ts';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import type { AppContext } from '../context.ts';
import type { HubEnv } from './env.ts';
import { authMiddleware, csrfGuard, errorHandler, requestLog, securityHeaders } from './middleware.ts';
import { pageRoutes } from './pages.ts';
import { isPageRequest, pageError } from './page-errors.ts';
import { authRoutes } from './auth-routes.ts';
import { apiRoutes } from '../api/index.ts';
import { mcpRoutes } from '../mcp/index.ts';
import { browserTelemetryRoutes } from './browser-telemetry.ts';
import { installRoutes } from './install.ts';
import type { Live } from '../live.ts';
import { createLive } from '../live.ts';
import { liveRoutes } from './live-routes.ts';
import { PRESENCE_CHANNEL_PREFIX } from '../presence.ts';
import type { OidcProvider } from '../auth/oidc.ts';
import { HUB_VERSION } from '../version.ts';

/** Shared with the process: set when the pod is stopping, so /readyz takes it out of the load balancer first. */
export interface Lifecycle {
  draining: boolean;
}

export interface HubAppOptions {
  readonly live?: Live;
  /** The presence channels; one is made when not given. */
  readonly presence?: Live;
  readonly oidc?: OidcProvider | undefined;
  readonly lifecycle?: Lifecycle;
}

export function createHubApp(ctx: AppContext, opts: HubAppOptions = {}): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  const live = opts.live ?? createLive(ctx.db, ctx.log);
  const presence = opts.presence ?? createLive(ctx.db, ctx.log, PRESENCE_CHANNEL_PREFIX);
  app.onError(errorHandler(ctx));
  // A stopping pod tells each client to close its connection after this answer, so the next
  // request opens one to a pod that stays, not to a socket that vanishes with this pod.
  app.use('*', async (c, next) => {
    await next();
    if (opts.lifecycle?.draining) c.header('connection', 'close');
  });
  app.use('*', requestLog(ctx));
  app.use('*', securityHeaders());
  // A bundle carries every view as SVG and a layout kit as JSON: gzip cuts it
  // about eightfold. Event streams are left alone by the content type filter.
  app.use('*', compress());

  app.get('/healthz', (c) => c.json({ ok: true, version: HUB_VERSION }));
  // Readiness takes a pod out of service only when that pod is stopping. The database and the
  // file store are shared: when they are down every pod is, and taking them all out turns a
  // wait the requests ride out into refusals. Their state is reported and logged, each check
  // with a deadline, and the file store asked at most every BLOB_CHECK_MS.
  let blobCheck: { at: number; result: string } = { at: 0, result: 'ok' };
  app.get('/readyz', async (c) => {
    const checks: Record<string, string> = {};
    checks['db'] = await within(ctx.db.query('select 1 as ok'), CHECK_DEADLINE_MS);
    if (Date.now() - blobCheck.at > BLOB_CHECK_MS) blobCheck = { at: Date.now(), result: await within(ctx.blob.ping(), CHECK_DEADLINE_MS) };
    checks['blob'] = blobCheck.result;
    if (opts.lifecycle?.draining) checks['draining'] = 'this pod is stopping';
    const healthy = Object.values(checks).every((v) => v === 'ok');
    if (!healthy) ctx.log.warn('readyz.degraded', { ...checks });
    const ready = !opts.lifecycle?.draining;
    return c.json({ ok: healthy, ready, checks, live: live.size() }, ready ? 200 : 503);
  });

  app.route('/', installRoutes());

  app.use('*', authMiddleware(ctx));
  app.use('*', csrfGuard(ctx.config.PUBLIC_URL));
  app.route('/', authRoutes(ctx, opts.oidc));
  const api = apiRoutes(ctx);
  app.route('/api/v1', api.app);
  app.route('/', oauthRoutes(ctx));
  app.route('/', mcpRoutes(ctx));
  app.route('/', browserTelemetryRoutes(ctx));
  app.route('/', liveRoutes(ctx, live, presence));
  app.route('/', pageRoutes(ctx, api.routes));
  app.notFound((c) => (isPageRequest(c) ? pageError(c, ctx.config, 404) : c.json({ error: 'not found', path: c.req.path }, 404)));
  return app;
}

const CHECK_DEADLINE_MS = 2_000;
const BLOB_CHECK_MS = 30_000;

/** 'ok' when the promise settles in time, else why not. */
async function within(p: Promise<unknown>, ms: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<string>((resolve) => (timer = setTimeout(() => resolve(`no answer in ${ms} ms`), ms)));
  try {
    return await Promise.race([p.then(() => 'ok'), late]);
  } catch (err) {
    return (err as Error).message;
  } finally {
    clearTimeout(timer);
  }
}

#!/usr/bin/env bun
/** vantage-hub web|worker|migrate */
import { ConfigError, loadConfig, type Config } from './config.ts';
import { createLogger, type Logger } from './log.ts';
import { startTelemetry } from './telemetry.ts';
import { createHubMetrics, observeProcess, observeQueue } from './metrics.ts';
import { connectPostgres } from './db/postgres.ts';
import { databasePassword } from './db/auth.ts';
import { migrate } from './db/migrate.ts';
import { refreshBindSources } from './documents/save.ts';
import { backfillCitations } from './decisions/citations.ts';
import { createRenderPool } from './render/pool.ts';
import { openBlobStore } from './blob/index.ts';
import type { AppContext } from './context.ts';
import { createHubApp, type Lifecycle } from './web/app.ts';
import { createLive } from './live.ts';
import { createWorker } from './worker/loop.ts';
import { createOidcProvider } from './auth/oidc.ts';
import { createIssuerTokens } from './auth/issuer-token.ts';
import { createConnectorTokens } from './auth/connector-token.ts';
import { defaultRegistry } from '@vantage/connectors';
import { defaultTargets } from '@vantage/publish';
import { providerFromConfig } from './revise/provider.ts';

const HELP = `vantage-hub <command>

  web       Serve the hub (adds an in-process worker when WORKER_EMBEDDED=true; it
            stalls requests while it renders, so run worker beside it instead)
  worker    Run the render, connector, publication, and maintenance worker
  migrate   Apply pending database migrations and exit
`;

async function buildContext(config: Config, log: Logger, cmd: string): Promise<AppContext & { shutdownTelemetry: () => Promise<void> }> {
  const telemetry = await startTelemetry(log);
  const password = await databasePassword(config);
  const db = connectPostgres(config.DATABASE_URL, log, { max: config.DB_POOL, password });
  const dbRead = config.DATABASE_READ_URL ? connectPostgres(config.DATABASE_READ_URL, log, { max: config.DB_POOL, password }) : db;
  const blob = await openBlobStore(config, log);
  const connectors = defaultRegistry();
  const targets = defaultTargets();
  observeQueue(db);
  observeProcess();
  log.info('hub.plugins', { connectors: connectors.list().map((c) => c.id), targets: targets.list().map((t) => t.id) });
  // Migrations draw nothing, so they start no threads.
  const render = createRenderPool({ threads: cmd === 'migrate' ? 0 : config.RENDER_THREADS, timeoutMs: config.RENDER_TIMEOUT_SECONDS * 1000, maxQueue: config.RENDER_QUEUE, log });
  // Only the web answers requests, so only it checks the issuer's tokens.
  const issuerTokens = cmd === 'web' ? await createIssuerTokens(config, log) : undefined;
  const connectorTokens = cmd === 'web' ? await createConnectorTokens(config, log) : undefined;
  return { config, db, dbRead, blob, log, tracer: telemetry.tracer, metrics: createHubMetrics(), connectors, targets, fetch: globalThis.fetch, render, ai: providerFromConfig(config, globalThis.fetch, log.child({ component: 'ai' })), issuerTokens, connectorTokens, shutdownTelemetry: telemetry.shutdown };
}

export async function main(argv: string[]): Promise<number> {
  const cmd = argv[0] ?? 'help';
  if (cmd === 'help' || cmd === '--help') {
    process.stdout.write(HELP);
    return 0;
  }
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      return 2;
    }
    throw err;
  }
  const log = createLogger(config.LOG_LEVEL, undefined, { service: 'vantage-hub', cmd });
  log.info('hub.start', { cmd, authMode: config.AUTH_MODE, blob: config.BLOB_DRIVER, workerEmbedded: config.WORKER_EMBEDDED, port: config.PORT });
  const ctx = await buildContext(config, log, cmd);
  const stops: (() => Promise<void>)[] = [ctx.shutdownTelemetry, () => ctx.db.close(), ...(ctx.dbRead !== ctx.db ? [() => ctx.dbRead.close()] : []), () => ctx.render.close()];
  const shutdown = async (signal: string): Promise<void> => {
    log.info('hub.shutdown.start', { signal });
    for (const stop of stops.reverse()) await stop().catch((err: Error) => log.error('hub.shutdown.step.failed', { error: err }));
    log.info('hub.shutdown.end', {});
    process.exit(0);
  };
  // An error nobody waited on ends the process, as Bun would, but leaves a log line first.
  for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
    process.on(event, (err: unknown) => {
      log.error('process.crash', { event, error: err instanceof Error ? err : new Error(String(err)) });
      process.exit(1);
    });
  }
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  switch (cmd) {
    case 'migrate': {
      // On a first install the database may still be starting; wait for it rather than fail the pod.
      for (let attempt = 1; ; attempt++) {
        try {
          await ctx.db.query('select 1 as ok');
          break;
        } catch (err) {
          if (attempt >= 60) throw err;
          log.info('migrate.waiting', { attempt, error: (err as Error).message });
          await sleep(2000);
        }
      }
      const out = await migrate(ctx.db, log);
      const refreshed = await refreshBindSources(ctx.db, log);
      const cited = await backfillCitations(ctx);
      process.stdout.write(`applied ${out.applied.length}, skipped ${out.skipped}, refreshed sources of ${refreshed} documents, indexed citations of ${cited.documents} documents and ${cited.records} records\n`);
      await ctx.render.close();
      await ctx.db.close();
      await ctx.shutdownTelemetry();
      return 0;
    }
    case 'worker': {
      const worker = createWorker(ctx);
      await worker.start();
      stops.push(() => worker.stop());
      return await new Promise<number>(() => undefined);
    }
    case 'web': {
      const oidc = config.AUTH_MODE === 'oidc' ? await createOidcProvider(config, log) : undefined;
      const lifecycle: Lifecycle = { draining: false };
      const live = createLive(ctx.db, log);
      const app = createHubApp(ctx, { oidc, live, lifecycle });
      if (config.WORKER_EMBEDDED) {
        const worker = createWorker(ctx);
        await worker.start();
        stops.push(() => worker.stop());
      }
      const server = Bun.serve({ port: config.PORT, fetch: app.fetch, idleTimeout: 0 });
      // Drain: fail readiness so new requests go elsewhere, end the live streams so their
      // clients reconnect to another pod, let requests in flight finish, then close.
      stops.push(async () => {
        lifecycle.draining = true;
        log.info('hub.drain.start', { drainSeconds: config.DRAIN_SECONDS, graceSeconds: config.SHUTDOWN_GRACE_SECONDS });
        await sleep(config.DRAIN_SECONDS * 1000);
        const streams = live.closeAll();
        const finished = await Promise.race([server.stop(false).then(() => true), sleep(config.SHUTDOWN_GRACE_SECONDS * 1000).then(() => false)]);
        if (!finished) await server.stop(true);
        log.info('hub.drain.end', { streams, finished, pending: server.pendingRequests });
      });
      log.info('hub.listening', { url: config.PUBLIC_URL, port: config.PORT });
      return await new Promise<number>(() => undefined);
    }
    default:
      process.stderr.write(`unknown command ${cmd}\n${HELP}`);
      return 1;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exit(code);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

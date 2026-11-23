/**
 * A hub for a bench, started the way it runs in production: `migrate`,
 * then `web` and `worker` as processes of their own against one Postgres
 * and one blob directory, signing in nobody (AUTH_MODE=none). Each hub
 * gets a database of its own on the server it is given, dropped when it
 * stops, so no run reuses another run's renders. The worker
 * sends its metrics to a small OTLP receiver here, so the bench can read
 * the hub's own histograms once the worker has stopped and flushed them.
 * A hub can run from another checkout of the repository (`root`), such as
 * the last release, so a bench can compare two builds on one machine.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { connectPostgres } from '../../packages/hub/src/db/postgres.ts';
import { silentLogger } from '../../packages/hub/src/log.ts';

const HERE = join(import.meta.dir, '..', '..');

/** One histogram as the hub exported it, summed over its data points. */
export interface Histogram {
  readonly count: number;
  readonly sum: number;
  readonly max: number;
  readonly bounds: readonly number[];
  readonly buckets: readonly number[];
}

export interface BenchHub {
  readonly url: string;
  readonly logs: string;
  /** Stops the worker and the web, and returns the histograms the worker flushed on its way out. */
  stop(): Promise<Map<string, Histogram>>;
  /** Ends both processes at once, for a bench that exits early. */
  kill(): void;
}

interface OtlpPoint { count?: number | string; sum?: number; max?: number; bucketCounts?: (number | string)[]; explicitBounds?: number[] }
interface OtlpBody { resourceMetrics?: { scopeMetrics?: { metrics?: { name: string; histogram?: { dataPoints?: OtlpPoint[] } }[] }[] }[] }

export async function startHub(serverUrl: string, env: Record<string, string> = {}, root = HERE): Promise<BenchHub> {
  const main = join(root, 'packages', 'hub', 'src', 'main.ts');
  const dir = mkdtempSync(join(tmpdir(), 'vantage-bench-'));
  const name = `vantage_bench_${Date.now().toString(36)}`;
  const admin = connectPostgres(serverUrl, silentLogger, { max: 1 });
  await admin.exec(`create database ${name}`);
  const databaseUrl = Object.assign(new URL(serverUrl), { pathname: `/${name}` }).toString();
  const histograms = new Map<string, Histogram>();
  const otlp = Bun.serve({
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname === '/v1/metrics') collect(histograms, (await req.json()) as OtlpBody);
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    },
  });
  const port = await freePort();
  const base: Record<string, string> = {
    DATABASE_URL: databaseUrl,
    PORT: String(port),
    PUBLIC_URL: `http://127.0.0.1:${port}`,
    AUTH_MODE: 'none',
    SESSION_SECRET: randomBytes(32).toString('hex'),
    SECRETS_KEY: randomBytes(32).toString('hex'),
    BLOB_PATH: join(dir, 'blobs'),
    // Old versions stay, so every save the bench makes can be ordered and found.
    RETENTION_VERSIONS: '1000',
    // No load balancer waits on this hub, so it stops without draining.
    DRAIN_SECONDS: '0',
    ...env,
  };
  const spawn = (cmd: string, extra: Record<string, string> = {}): Subprocess => {
    const out = openSync(join(dir, `${cmd}.log`), 'a');
    return Bun.spawn([process.execPath, main, cmd], { cwd: root, env: { ...process.env, ...base, ...extra }, stdout: out, stderr: out });
  };
  const migrate = spawn('migrate');
  if ((await migrate.exited) !== 0) throw new Error(`migrate failed:\n${tail(join(dir, 'migrate.log'))}`);
  const web = spawn('web');
  const worker = spawn('worker', { OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${otlp.port}`, OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json' });
  const url = base['PUBLIC_URL']!;
  await ready(url, web, dir);
  return {
    url,
    logs: dir,
    async stop() {
      worker.kill('SIGTERM');
      await worker.exited;
      web.kill('SIGTERM');
      await web.exited;
      await otlp.stop(true);
      await admin.exec(`drop database ${name} with (force)`);
      await admin.close();
      return histograms;
    },
    kill() {
      worker.kill('SIGKILL');
      web.kill('SIGKILL');
    },
  };
}

function collect(into: Map<string, Histogram>, body: OtlpBody): void {
  for (const rm of body.resourceMetrics ?? [])
    for (const sm of rm.scopeMetrics ?? [])
      for (const m of sm.metrics ?? []) {
        for (const p of m.histogram?.dataPoints ?? []) {
          const buckets = (p.bucketCounts ?? []).map(Number);
          // Exports are cumulative, so the newest point is the whole run.
          into.set(m.name, { count: Number(p.count ?? 0), sum: p.sum ?? 0, max: p.max ?? 0, bounds: p.explicitBounds ?? [], buckets });
        }
      }
}

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port;
  await probe.stop(true);
  if (port === undefined) throw new Error('no free port');
  return port;
}

/** The last lines a process wrote, for an error a CI log shows: the run's temporary folder is gone when it ends. */
function tail(file: string, lines = 40): string {
  try {
    return readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return `(no ${file})`;
  }
}

async function ready(url: string, web: Subprocess, dir: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (web.exitCode !== null) throw new Error(`the web exited with ${web.exitCode}:\n${tail(join(dir, 'web.log'))}`);
    const ok = await fetch(`${url}/readyz`).then((r) => r.ok, () => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`the web never became ready:\n${tail(join(dir, 'web.log'))}`);
}

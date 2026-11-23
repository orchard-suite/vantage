/**
 * The shared connector pool: a few runners that run every scheduled
 * connector of a hub, so memory follows how many runs happen at once, not
 * how many connectors exist. The pool signs in to the hub as its own app
 * (the hub's pool role) to lease runs from the hub's queue, and runs each one
 * as that connector's own app: the pool's workload identity token is the
 * assertion every connector app trusts with a federated credential. So a
 * connector still reads only what its app may read, and the hub holds no
 * credential. A run keeps its lease alive while it works; one the hub took
 * back is stopped. On stop the pool takes no new run, lets the running ones
 * finish for a grace period, then hands the rest back to the queue.
 */
import { hostname } from 'node:os';
import type { ConnectorRegistry, FetchLike, Logger } from './connector.ts';
import { appIdentity, runConnectorOnce } from './runner.ts';

export interface PoolOptions {
  /** The hub, for example https://vantage.example.com. */
  readonly hub: string;
  readonly tokenUrl: string;
  /** The pool's own app, which holds the hub's pool role. */
  readonly clientId: string;
  /** The hub's application id URI with /.default. */
  readonly scope: string;
  /** The pool's workload identity token: its own sign-in, and the assertion each connector's app trusts. */
  readonly assertionFile: string;
  readonly registry: ConnectorRegistry;
  readonly log: Logger;
  readonly fetch?: FetchLike;
  /** Runs at once in this process; default 2. */
  readonly concurrency?: number;
  /** Seconds one run may take; default 600. */
  readonly timeoutSeconds?: number;
  /** Seconds the running runs get to finish once the pool stops; default 30. */
  readonly graceSeconds?: number;
  /** Seconds one lease request waits at the hub for a run; default 20. */
  readonly waitSeconds?: number;
  /** Aborted, the pool stops. */
  readonly signal: AbortSignal;
  /** The pool's name in leases and logs; default the host name and a random suffix. */
  readonly worker?: string;
}

export interface PooledRun {
  readonly id: string;
  /** The connector id. */
  readonly connector: string;
  /** The connector's own app, which the run signs in as. */
  readonly clientId: string;
}

interface Lease {
  readonly job: PooledRun;
  readonly leaseSeconds: number;
}

export async function runPool(o: PoolOptions): Promise<void> {
  const fetchImpl: FetchLike = o.fetch ?? fetch;
  const hub = o.hub.replace(/\/$/, '');
  const worker = o.worker ?? `${hostname()}-${Math.random().toString(36).slice(2, 8)}`;
  const log = o.log;
  const concurrency = o.concurrency ?? 2;
  const pool = appIdentity({ tokenUrl: o.tokenUrl, clientId: o.clientId, assertionFile: o.assertionFile }, fetchImpl);
  const running = new Map<string, { done: Promise<void>; stop: AbortController }>();

  const call = async (path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> => {
    const token = await pool.token(o.scope);
    const init: RequestInit = { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ worker, ...body }) };
    if (signal) init.signal = signal;
    const res = await fetchImpl(`${hub}/api/v1/connector-pool${path}`, init);
    if (!res.ok && res.status !== 204) throw new Error(`POST ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res;
  };

  const handedBack = new Set<string>();

  const run = async ({ job, leaseSeconds }: Lease, stop: AbortController): Promise<void> => {
    const started = Date.now();
    const tag = { job: job.id, connector: job.connector };
    const runLog: Logger = { debug: (m, f) => log.debug(m, { ...f, ...tag }), info: (m, f) => log.info(m, { ...f, ...tag }), warn: (m, f) => log.warn(m, { ...f, ...tag }), error: (m, f) => log.error(m, { ...f, ...tag }) };
    // Renew at a quarter of the lease, so two missed renewals still hold it.
    const renew = setInterval(() => {
      call(`/jobs/${encodeURIComponent(job.id)}/renew`, {})
        .then(async (r) => {
          const held = ((await r.json()) as { held?: boolean }).held;
          if (held === false) {
            log.warn('pool lease lost', { job: job.id, connector: job.connector });
            stop.abort(new Error('the hub took the run back'));
          }
        })
        .catch((err: Error) => log.warn('pool renew failed', { job: job.id, error: err.message }));
    }, (leaseSeconds * 1000) / 4);
    let error: string | undefined;
    try {
      await runConnectorOnce({ hub, connector: job.connector, tokenUrl: o.tokenUrl, clientId: job.clientId, scope: o.scope, assertionFile: o.assertionFile, registry: o.registry, log: runLog, fetch: fetchImpl, timeoutSeconds: o.timeoutSeconds ?? 600, pooled: true, signal: stop.signal });
    } catch (err) {
      error = (err as Error).message.slice(0, 4000);
    } finally {
      clearInterval(renew);
    }
    if (handedBack.has(job.id)) return; // the queue runs it again
    await call(`/jobs/${encodeURIComponent(job.id)}/done`, error ? { error } : {}).catch((err: Error) => log.warn('pool could not report a run', { job: job.id, error: err.message }));
    log.info('pool run end', { job: job.id, connector: job.connector, ok: !error, ms: Date.now() - started });
  };

  log.info('pool start', { hub, worker, concurrency, clientId: o.clientId });
  const leasing = new AbortController();
  o.signal.addEventListener('abort', () => leasing.abort(), { once: true });
  while (!o.signal.aborted) {
    if (running.size >= concurrency) {
      await Promise.race([...running.values()].map((r) => r.done));
      continue;
    }
    let lease: Lease | undefined;
    try {
      const res = await call('/lease', { wait: o.waitSeconds ?? 20 }, leasing.signal);
      if (res.status === 200) lease = (await res.json()) as Lease;
    } catch (err) {
      if (o.signal.aborted) break;
      log.warn('pool lease failed', { error: (err as Error).message });
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    if (!lease) continue;
    log.info('pool run start', { job: lease.job.id, connector: lease.job.connector, running: running.size + 1, concurrency });
    const id = lease.job.id;
    const stop = new AbortController();
    const done = run(lease, stop).finally(() => running.delete(id));
    running.set(id, { done, stop });
  }

  if (running.size) {
    log.info('pool stopping', { running: running.size, graceSeconds: o.graceSeconds ?? 30 });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const grace = new Promise<void>((r) => (timer = setTimeout(r, (o.graceSeconds ?? 30) * 1000)));
    await Promise.race([Promise.allSettled([...running.values()].map((r) => r.done)), grace]);
    clearTimeout(timer);
    const left = [...running.keys()];
    if (left.length) {
      for (const id of left) handedBack.add(id);
      await call('/release', { jobs: left }).catch((err: Error) => log.warn('pool could not hand runs back', { error: err.message }));
      for (const r of running.values()) r.stop.abort(new Error('the pool stopped'));
      log.warn('pool handed back', { jobs: left });
    }
  }
  log.info('pool stop', { worker });
}

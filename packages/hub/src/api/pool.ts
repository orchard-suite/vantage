/**
 * What the shared connector pool may do: lease the connector runs the hub
 * queued, keep a lease alive, say how a run ended, and hand runs back when
 * it stops. Only an app with the pool role calls these, and it acts as no
 * connector: each run signs in as its connector's own app and pushes
 * through the connector routes in push.ts. A lease request waits at the
 * hub for a run, woken by the job queue's notices, so the pool hears of a
 * run within moments without asking every second. A queued run whose
 * connector was removed, paused, or stopped since is closed, not handed out.
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body } from './common.ts';
import { forbidden, unauthorized } from '../http.ts';
import { claim, fail, finish, jobById, JOBS_CHANNEL, releaseJobs, renewLeases, type JobLogLine } from '../worker/jobs.ts';
import { sourceById } from '../sources/repo.ts';
import { runRefusal } from '../sources/runs.ts';

/** The longest a lease request waits at the hub; under the idle timeout of the ingresses in front of it. */
export const LEASE_WAIT_MAX_SECONDS = 25;

const Worker = z.string().trim().min(1).max(120);

const line = (level: JobLogLine['level'], message: string, fields?: Record<string, unknown>): JobLogLine => ({ at: new Date().toISOString(), level, message, ...(fields ? { fields } : {}) });

export function poolRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  const log = ctx.log.child({ surface: 'pool' });

  // One subscription per process; every waiting lease request hears each notice and looks again.
  const waiters = new Set<() => void>();
  let listening: Promise<unknown> | undefined;
  const listen = (): void => {
    listening ??= ctx.db
      .listen(JOBS_CHANNEL, () => {
        for (const w of waiters) w();
      })
      .catch((err: Error) => {
        listening = undefined;
        log.warn('pool.listen.failed', { error: err.message });
      });
  };
  const nap = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        waiters.delete(done);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      waiters.add(done);
      signal.addEventListener('abort', done, { once: true });
    });

  /** The pool's name for this worker in job leases: its app, then the name it gave. */
  const owner = (c: Context<HubEnv>, worker: string): string => {
    const p = c.get('principal');
    if (!p) throw unauthorized();
    if (!p.connector?.pool) throw forbidden('the connector pool role is required');
    return `pool:${p.connector.clientId}:${worker}`;
  };

  reg.add({ method: 'post', path: '/connector-pool/lease', summary: 'Lease the next connector run the hub queued, waiting up to wait seconds for one', tag: 'pool', body: { worker: "the pool runner's name", wait: `seconds to wait for a run, at most ${LEASE_WAIT_MAX_SECONDS}` }, auth: 'pool', responses: { '200': 'a run: its job id, the connector, and the app it signs in as, with the lease seconds', '204': 'no run came while it waited' } });
  app.post('/connector-pool/lease', async (c) => {
    const input = await body(c, z.object({ worker: Worker, wait: z.number().int().min(0).max(LEASE_WAIT_MAX_SECONDS).default(0) }).strict());
    const by = owner(c, input.worker);
    const until = Date.now() + input.wait * 1000;
    const signal = c.req.raw.signal;
    listen();
    for (;;) {
      const job = await claim(ctx.db, by, 'pool');
      if (job) {
        const source = await sourceById(ctx.db, String(job.payload['sourceId'] ?? ''));
        const refused = source ? runRefusal(source, ctx) : 'the connector is gone';
        if (!source || refused) {
          await finish(ctx.db, job, [line('info', 'not run', { reason: refused })]);
          log.info('pool.run.dropped', { jobId: job.id, connectorId: job.payload['sourceId'], reason: refused });
          continue;
        }
        log.info('pool.leased', { jobId: job.id, connectorId: source.id, worker: by, trigger: job.payload['trigger'], waitedMs: Date.now() - job.run_at.getTime() });
        return c.json({ job: { id: job.id, connector: source.id, clientId: source.client_id }, leaseSeconds: ctx.config.JOB_LEASE_SECONDS });
      }
      const left = until - Date.now();
      if (left <= 0 || signal.aborted) return c.body(null, 204);
      await nap(left, signal);
    }
  });

  reg.add({ method: 'post', path: '/connector-pool/jobs/:job/renew', summary: 'Keep the lease on a run this worker holds', tag: 'pool', params: ['job'], body: { worker: "the pool runner's name" }, auth: 'pool', responses: { '200': 'held: false when the hub took the run back' } });
  app.post('/connector-pool/jobs/:job/renew', async (c) => {
    const input = await body(c, z.object({ worker: Worker }).strict());
    const held = (await renewLeases(ctx.db, owner(c, input.worker), [c.req.param('job')])).size > 0;
    if (!held) log.warn('pool.lease.lost', { jobId: c.req.param('job'), worker: input.worker });
    return c.json({ held });
  });

  reg.add({ method: 'post', path: '/connector-pool/jobs/:job/done', summary: 'Say how a run ended; the connector already recorded its batch or its failure', tag: 'pool', params: ['job'], body: { worker: "the pool runner's name", error: 'why it failed, when it did' }, auth: 'pool', responses: { '200': 'state: done, failed, or lost when the hub had taken it back' } });
  app.post('/connector-pool/jobs/:job/done', async (c) => {
    const input = await body(c, z.object({ worker: Worker, error: z.string().min(1).max(4000).optional() }).strict());
    const by = owner(c, input.worker);
    const job = await jobById(ctx.db, c.req.param('job'));
    if (!job || job.kind !== 'connector-run' || job.state !== 'running' || job.locked_by !== by) return c.json({ state: 'lost' });
    const state = input.error ? await fail(ctx.db, job, input.error, [line('error', input.error)]) : (await finish(ctx.db, job, [line('info', 'ran')])) ? 'done' : 'running';
    ctx.metrics.jobs.add(1, { task: 'connector-run', outcome: input.error ? 'failed' : 'done' });
    log.info('pool.run.end', { jobId: job.id, connectorId: job.payload['sourceId'], state, error: input.error });
    return c.json({ state: state === 'running' ? 'lost' : state });
  });

  reg.add({ method: 'post', path: '/connector-pool/release', summary: 'Hand runs back to the queue without spending an attempt; for a pool runner that stops', tag: 'pool', body: { worker: "the pool runner's name", jobs: 'job ids' }, auth: 'pool', responses: { '200': 'how many went back' } });
  app.post('/connector-pool/release', async (c) => {
    const input = await body(c, z.object({ worker: Worker, jobs: z.array(z.string().min(1)).max(100) }).strict());
    const released = await releaseJobs(ctx.db, owner(c, input.worker), input.jobs);
    log.info('pool.released', { worker: input.worker, released });
    return c.json({ released });
  });

  return app;
}

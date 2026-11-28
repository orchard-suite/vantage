/**
 * The worker loop: claim jobs up to the concurrency limit, run each inside
 * a span, record the outcome. Wakes on NOTIFY and polls on a timer so a
 * missed notification costs one interval, never a stuck queue. Renews the
 * lease on what it runs, takes back jobs whose worker died, and on stop
 * waits a grace period, then hands back what is still running. Schedules
 * the daily gc and purge jobs for every organization, and starts a new
 * release's redraw (release-redraw.ts).
 */
import type { AppContext } from '../context.ts';
import { SpanStatusCode } from '@opentelemetry/api';
import { claim, enqueue, fail, finish, JobLog, JOBS_CHANNEL, reclaimExpired, releaseJobs, renewLeases, type JobRow } from './jobs.ts';
import { runRender } from './render.ts';
import { dropFiles, runGc, runPurge } from './gc.ts';
import { runIngestJob } from './ingest-run.ts';
import { runOverlay } from './overlay.ts';
import { runRedraw, runReleaseRedraw, startReleaseRedraw } from './release-redraw.ts';
import { runPublicationJob } from './publication-run.ts';
import { runReview } from './review.ts';
import { runRevise } from '../revise/run.ts';
import { runGenerate } from '../revise/generate.ts';
import { createScheduler } from './schedule.ts';
import { randomId } from '../crypto.ts';
import { RENDERER } from '../render/renderer.ts';
import { endException } from '../standards/exception-write.ts';

export interface Worker {
  readonly id: string;
  /** Runs one job if there is one; returns whether it did. */
  tick(): Promise<boolean>;
  /** Drains the queue one job at a time; for tests and benchmarks. */
  drain(): Promise<number>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

const MAINTENANCE_HOURS = 24;

export function createWorker(ctx: AppContext): Worker {
  const id = `worker-${randomId(6)}`;
  const log = ctx.log.child({ worker: id });
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unlisten: (() => Promise<void>) | undefined;
  let wake: (() => void) | undefined;
  let woken = false;
  let busy: Promise<void> = Promise.resolve();
  const scheduler = createScheduler(ctx);

  /** Jobs whose lease this worker still keeps: claimed and not yet recorded. */
  const leased = new Set<string>();

  const runKind = (job: JobRow, jlog: JobLog): Promise<unknown> => {
    if (job.kind === 'render') return runRender(ctx, job, jlog);
    if (job.kind === 'gc') return runGc(ctx, job.org_id, jlog);
    if (job.kind === 'purge') return runPurge(ctx, job.org_id, jlog);
    if (job.kind === 'ingest') return runIngestJob(ctx, job, jlog);
    if (job.kind === 'overlay') return runOverlay(ctx, job, jlog);
    if (job.kind === 'redraw') return runRedraw(ctx, job, jlog);
    if (job.kind === 'release-redraw') return runReleaseRedraw(ctx, job, jlog);
    if (job.kind === 'publication-run') return runPublicationJob(ctx, job, jlog);
    if (job.kind === 'review') return runReview(ctx, job, jlog);
    if (job.kind === 'drop-files') return dropFiles(ctx, job, jlog);
    if (job.kind === 'revise') return runRevise(ctx, job, jlog);
    if (job.kind === 'generate') return runGenerate(ctx, job, jlog);
    if (job.kind === 'exception-end') return endException(ctx, job.org_id, Number(job.payload['number']), String(job.payload['ends']));
    return Promise.reject(new Error(`unknown job kind ${String(job.kind)}`));
  };

  /** One job as a root span of its own, so every line it logs, start to end, carries its trace. */
  const runJob = async (job: JobRow): Promise<void> => {
    const jlog = new JobLog();
    const started = Date.now();
    leased.add(job.id);
    await ctx.tracer.startActiveSpan(`job.${job.kind}`, { root: true, attributes: { task: job.kind, 'job.id': job.id, 'job.attempt': job.attempts } }, async (span) => {
      log.info('job.start', { jobId: job.id, kind: job.kind, attempt: job.attempts, max: job.max_attempts });
      try {
        const outcome = await runKind(job, jlog);
        if (!(await finish(ctx.db, job, jlog.lines))) log.warn('job.lease.lost', { jobId: job.id, kind: job.kind, note: 'finished after another worker took it back' });
        ctx.metrics.jobs.add(1, { task: job.kind, outcome: 'done' });
        ctx.metrics.jobDuration.record((Date.now() - started) / 1000, { task: job.kind });
        span.setStatus({ code: SpanStatusCode.OK });
        log.info('job.end', { jobId: job.id, kind: job.kind, state: 'done', ms: Date.now() - started, outcome });
      } catch (err) {
        const message = (err as Error).message;
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        jlog.add('error', message);
        ctx.metrics.jobs.add(1, { task: job.kind, outcome: 'failed' });
        ctx.metrics.jobDuration.record((Date.now() - started) / 1000, { task: job.kind });
        try {
          const state = await fail(ctx.db, job, message, jlog.lines);
          log.error('job.end', { jobId: job.id, kind: job.kind, state, ms: Date.now() - started, error: err as Error });
        } catch (recordErr) {
          // The database is gone too; the lease lapses and a worker takes the job back.
          log.error('job.end', { jobId: job.id, kind: job.kind, state: 'unrecorded', ms: Date.now() - started, error: err as Error, recordError: recordErr as Error });
        }
      } finally {
        span.end();
        leased.delete(job.id);
      }
    });
  };

  const tick = async (): Promise<boolean> => {
    const job = await claim(ctx.db, id);
    if (!job) return false;
    await runJob(job);
    return true;
  };

  const drain = async (): Promise<number> => {
    let n = 0;
    while (await tick()) n++;
    log.debug('worker.drain', { ran: n });
    return n;
  };

  const scheduleMaintenance = async (): Promise<void> => {
    const orgs = await ctx.db.query<{ id: string }>('select id from orgs');
    for (const org of orgs) {
      const pending = await ctx.db.query<{ n: string }>("select count(*)::text as n from jobs where org_id = $1 and kind in ('gc', 'purge') and state in ('queued', 'running')", [org.id]);
      if (Number(pending[0]?.n ?? '0') > 0) {
        log.debug('worker.maintenance.pending', { orgId: org.id });
        continue;
      }
      const runAt = new Date(Date.now() + MAINTENANCE_HOURS * 3_600_000);
      await enqueue(ctx.db, { orgId: org.id, kind: 'gc', payload: {}, runAt });
      await enqueue(ctx.db, { orgId: org.id, kind: 'purge', payload: {}, runAt });
      log.info('worker.maintenance.scheduled', { orgId: org.id, runAt: runAt.toISOString() });
    }
  };

  /** Jobs this worker is running now, by id. */
  const inFlight = new Map<string, Promise<void>>();
  const leaseMs = ctx.config.JOB_LEASE_SECONDS * 1000;
  let lastReclaim = 0;

  const housekeep = async (): Promise<void> => {
    const ids = [...leased];
    if (ids.length) {
      const renewed = await renewLeases(ctx.db, id, ids);
      // A job recorded while the renewal ran is done, not lost.
      const lost = ids.filter((j) => !renewed.has(j) && leased.has(j));
      if (lost.length) log.warn('worker.lease.lost', { running: ids.length, lost });
    }
    if (Date.now() - lastReclaim < leaseMs / 4) return;
    lastReclaim = Date.now();
    for (const r of await reclaimExpired(ctx.db, ctx.config.JOB_LEASE_SECONDS)) {
      log.warn('worker.reclaimed', { jobId: r.id, kind: r.kind, state: r.state, from: r.locked_by });
      ctx.metrics.jobs.add(1, { task: r.kind, outcome: 'reclaimed' });
    }
  };

  const wakeUp = (): void => {
    // A wake that comes while the loop is busy is kept, so the loop goes round again instead of sleeping.
    woken = true;
    if (timer) clearTimeout(timer);
    wake?.();
  };

  /** Claims jobs until the slots are full or the queue is empty. */
  const fill = async (): Promise<void> => {
    while (running && inFlight.size < ctx.config.WORKER_CONCURRENCY) {
      const job = await claim(ctx.db, id);
      if (!job) return;
      const p = runJob(job).finally(() => {
        inFlight.delete(job.id);
        wakeUp();
      });
      inFlight.set(job.id, p);
      log.debug('worker.slot', { jobId: job.id, kind: job.kind, running: inFlight.size, slots: ctx.config.WORKER_CONCURRENCY });
    }
  };

  const loop = async (): Promise<void> => {
    while (running) {
      try {
        await scheduler.tick();
        await housekeep();
        await fill();
      } catch (err) {
        log.error('worker.loop.error', { error: err as Error });
      }
      if (!running) break;
      // Sleep until a job is queued, a slot frees, or the poll interval passes; renew leases at least every quarter lease.
      if (!woken) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          timer = setTimeout(resolve, Math.min(ctx.config.WORKER_POLL_SECONDS * 1000, leaseMs / 4));
        });
        wake = undefined;
      }
      woken = false;
    }
  };

  return {
    id,
    tick,
    drain,
    async start() {
      running = true;
      log.info('worker.start', { poll: ctx.config.WORKER_POLL_SECONDS, concurrency: ctx.config.WORKER_CONCURRENCY, leaseSeconds: ctx.config.JOB_LEASE_SECONDS });
      unlisten = await ctx.db.listen(JOBS_CHANNEL, wakeUp);
      await scheduleMaintenance();
      // A new release redraws in the background what an older one drew, so no save pays for its new cache keys.
      log.info('worker.release.redraw', { release: RENDERER, started: await startReleaseRedraw(ctx) });
      busy = loop();
    },
    async stop() {
      running = false;
      wakeUp();
      await busy;
      const pending = [...inFlight.values()];
      if (pending.length) {
        log.info('worker.stop.waiting', { running: pending.length, graceSeconds: ctx.config.SHUTDOWN_GRACE_SECONDS });
        let graceTimer: ReturnType<typeof setTimeout> | undefined;
        const grace = new Promise<void>((resolve) => {
          graceTimer = setTimeout(resolve, ctx.config.SHUTDOWN_GRACE_SECONDS * 1000);
        });
        await Promise.race([Promise.allSettled(pending), grace]);
        clearTimeout(graceTimer);
        const left = [...inFlight.keys()];
        if (left.length) log.warn('worker.stop.released', { jobs: left, released: await releaseJobs(ctx.db, id, left) });
      }
      await unlisten?.();
      log.info('worker.stop', {});
    },
  };
}

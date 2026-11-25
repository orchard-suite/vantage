/**
 * A new release redraws every document an older release drew, before a
 * person's save has to. Each view's digest names the release that drew it,
 * so the first draw under a new release lays every view out again; done
 * here in the background, the next save reuses them.
 *
 * One driver job per organization and release, started by every worker
 * and kept unique by its schedule key. Each run queues the next document
 * still drawn by an older release as a `redraw` draw under the document's
 * own draw key, so it never draws beside a save or a refresh of the same
 * document and folds into one that waits. It is claimed after every other
 * job and its tasks run in the render pool's last lane. A finished redraw
 * wakes the driver; it polls too, in case it was missed. What is left is
 * read from the render states every run, so a restart goes on where it
 * stopped.
 */
import type { AppContext } from '../context.ts';
import { RENDERER } from '../render/renderer.ts';
import { documentById, headVersion } from '../documents/repo.ts';
import { renderVersion, type RenderOutcome } from './artifacts.ts';
import { enqueue, enqueueDraw, JOBS_CHANNEL, type JobLog, type JobRow } from './jobs.ts';

/** How long the driver waits for a redraw to wake it before it looks again. */
const POLL_MS = 5_000;
/** How often the driver logs its progress, in documents. */
const PROGRESS_EVERY = 10;
/** Runs a worker of another release hands the driver back before it is dropped: about an hour. */
const HANDOFFS = 120;

interface DriverState {
  readonly release: string;
  readonly startedAt?: string;
  readonly documents?: number;
  readonly logged?: number;
  readonly handoffs?: number;
}

const driverKey = (orgId: string): string => `release-redraw:${orgId}`;

/** Starts this release's redraw in every organization; a no-op where it has started before. */
export async function startReleaseRedraw(ctx: AppContext): Promise<number> {
  let started = 0;
  for (const org of await ctx.db.query<{ id: string }>('select id from orgs')) {
    const id = await enqueue(ctx.db, { orgId: org.id, kind: 'release-redraw', payload: { release: RENDERER } satisfies DriverState, scheduleKey: `release-redraw:${RENDERER}:${org.id}`, dedupeKey: driverKey(org.id) });
    if (id) started++;
  }
  return started;
}

export interface DriverOutcome {
  readonly release: string;
  readonly left: number;
  readonly queued?: string;
  readonly done?: boolean;
}

export async function runReleaseRedraw(ctx: AppContext, job: JobRow, jlog: JobLog): Promise<DriverOutcome> {
  const state = job.payload as unknown as DriverState;
  const log = ctx.log.child({ task: 'release-redraw', orgId: job.org_id, release: state.release });
  // A worker of another release (one still running during a rollout) leaves the driver to this one's workers.
  if (state.release !== RENDERER) {
    const handoffs = (state.handoffs ?? 0) + 1;
    if (handoffs > HANDOFFS) log.warn('release.redraw.dropped', { worker: RENDERER, handoffs });
    else await again(ctx, job.org_id, { ...state, handoffs }, POLL_MS);
    return { release: state.release, left: -1 };
  }
  const left = await staleDocuments(ctx, job.org_id);
  const counts = await redrawCounts(ctx, job.org_id);
  const started = state.startedAt ?? new Date().toISOString();
  if (state.startedAt === undefined) {
    log.info('release.redraw.start', { documents: left.length + counts.running });
    jlog.add('info', 'redraw started', { documents: left.length });
  }
  const ms = Date.now() - new Date(started).getTime();
  const documents = state.documents ?? left.length + counts.running;
  if (!left.length && !counts.running) {
    log.info('release.redraw.end', { documents, drawn: counts.done, failed: counts.failed, ms });
    jlog.add('info', 'redraw finished', { documents, drawn: counts.done, failed: counts.failed, ms });
    ctx.metrics.releaseRedraw.record(ms / 1000, { release: RENDERER });
    return { release: RENDERER, left: 0, done: true };
  }
  const finished = counts.done + counts.failed;
  const report = finished >= (state.logged ?? 0) + PROGRESS_EVERY;
  if (report) log.info('release.redraw.progress', { documents, drawn: counts.done, failed: counts.failed, left: left.length, ms });
  // One at a time, so a release never holds more than one of the worker's slots.
  const next = counts.running ? undefined : left[0];
  const queued = next ? await enqueueDraw(ctx.db, { orgId: job.org_id, kind: 'redraw', documentId: next, payload: { release: RENDERER } }) : undefined;
  await again(ctx, job.org_id, { release: RENDERER, startedAt: started, documents, logged: report ? finished : (state.logged ?? 0) }, POLL_MS);
  return { release: RENDERER, left: left.length, ...(queued ? { queued } : {}) };
}

/** One document's redraw: its head drawn by this release, in the last lane. */
export async function runRedraw(ctx: AppContext, job: JobRow, jlog: JobLog): Promise<RenderOutcome | { skipped: string }> {
  try {
    const doc = await documentById(ctx.db, String(job.payload['documentId'] ?? ''));
    const head = doc ? await headVersion(ctx.db, doc) : undefined;
    if (!head) return { skipped: 'no document or head' };
    if (job.payload['release'] !== RENDERER) return { skipped: `queued by release ${String(job.payload['release'])}` };
    return await renderVersion(ctx, head, { replace: true, jlog, trigger: 'release' });
  } finally {
    await wake(ctx, job.org_id);
  }
}

/** Documents whose head an older release drew, newest first; none another draw waits on, and none whose redraw failed this release. */
async function staleDocuments(ctx: AppContext, orgId: string): Promise<string[]> {
  const rows = await ctx.db.query<{ id: string }>(
    `select d.id from documents d
       join versions v on v.id = d.head_version_id
       join render_states rs on rs.version_hash = v.hash
      where d.org_id = $1 and rs.renderer is distinct from $2
        and not exists (select 1 from jobs j where j.dedupe_key = 'doc:' || d.id and j.state in ('queued', 'running'))
        and not exists (select 1 from jobs f where f.org_id = $1 and f.kind = 'redraw' and f.state = 'failed' and f.payload->>'documentId' = d.id and f.payload->>'release' = $2)
      order by d.updated_at desc`,
    [orgId, RENDERER],
  );
  return rows.map((r) => r.id);
}

/** This release's redraws in an organization, by how they stand. */
async function redrawCounts(ctx: AppContext, orgId: string): Promise<{ done: number; failed: number; running: number }> {
  const rows = await ctx.db.query<{ done: number; failed: number; running: number }>(
    `select count(*) filter (where state = 'done')::int as done, count(*) filter (where state = 'failed')::int as failed,
            count(*) filter (where state in ('queued', 'running'))::int as running
       from jobs where org_id = $1 and kind = 'redraw' and payload->>'release' = $2`,
    [orgId, RENDERER],
  );
  return rows[0] ?? { done: 0, failed: 0, running: 0 };
}

async function again(ctx: AppContext, orgId: string, state: DriverState, delayMs: number): Promise<void> {
  await enqueue(ctx.db, { orgId, kind: 'release-redraw', payload: { ...state }, dedupeKey: driverKey(orgId), runAt: new Date(Date.now() + delayMs) });
}

/** Brings the waiting driver forward, now that a redraw is done. */
async function wake(ctx: AppContext, orgId: string): Promise<void> {
  const rows = await ctx.db.query<{ id: string }>("update jobs set run_at = now() where dedupe_key = $1 and state = 'queued' returning id", [driverKey(orgId)]);
  if (rows[0]) await ctx.db.notify(JOBS_CHANNEL, rows[0].id);
}


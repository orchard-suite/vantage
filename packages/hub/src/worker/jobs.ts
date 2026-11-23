/**
 * The job table: enqueue, claim with FOR UPDATE SKIP LOCKED, finish or
 * retry with backoff. Every job keeps a readable log of its runs. Two lanes
 * claim from it: the hub's worker, and the shared connector pool, which
 * leases connector runs over the API and nothing else.
 */
import type { Db } from '../db/db.ts';
import { randomId } from '../crypto.ts';

export type JobKind = 'render' | 'gc' | 'purge' | 'ingest' | 'overlay' | 'publication-run' | 'review' | 'drop-files' | 'revise' | 'generate' | 'connector-run';

/** Who claims a job: the hub's own worker, or the shared connector pool, which holds the connectors' sign-in and runs connector runs only. */
export type JobLane = 'hub' | 'pool';
export type JobState = 'queued' | 'running' | 'done' | 'failed';

export interface JobRow {
  readonly id: string;
  readonly org_id: string;
  readonly kind: JobKind;
  readonly payload: Record<string, unknown>;
  readonly state: JobState;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly locked_by: string | null;
  readonly run_at: Date;
  readonly log: readonly JobLogLine[];
  readonly last_error: string | null;
  readonly created_at: Date;
}

export interface JobLogLine {
  readonly at: string;
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly fields?: Record<string, unknown>;
}

export const JOBS_CHANNEL = 'vantage_jobs';

/**
 * Attempts per kind. A publication run records its own
 * failure as a run row and notifies, so it is not retried; the schedule
 * or a person queues the next one. A revision records its own failure on
 * its row and is not retried either: every attempt spends the
 * organization's tokens. A connector run records its own failure as a
 * failed run, and its schedule runs it again. Rendering, a pushed batch's
 * ingest, and maintenance retry.
 */
export const DEFAULT_ATTEMPTS: Record<JobKind, number> = { render: 3, gc: 3, purge: 3, ingest: 3, overlay: 3, 'publication-run': 1, review: 2, 'drop-files': 3, revise: 1, generate: 1, 'connector-run': 1 };

export interface NewJob {
  readonly orgId: string;
  readonly kind: JobKind;
  readonly payload: Record<string, unknown>;
  readonly runAt?: Date;
  readonly maxAttempts?: number;
  /**
   * A key unique across the table; a second enqueue with the same key is
   * dropped. The scheduler uses it so one minute enqueues one job however
   * many workers are watching the clock.
   */
  readonly scheduleKey?: string;
  /**
   * At most one queued job per key; a second enqueue while the first still
   * waits is dropped, and no two jobs with the key run at once. A
   * document's draws share `doc:<id>` (drawKey), so a burst of saves and
   * source runs draws it once, on one worker.
   */
  readonly dedupeKey?: string;
}

/** The key every draw of one document shares. */
export function drawKey(documentId: string): string {
  return `doc:${documentId}`;
}

/**
 * Queues a draw of a document's head. When one already waits, a save's draw
 * takes its place as a `render` (a save runs its on-save publications) and
 * nothing new is queued. Returns the id of the job that will draw.
 */
export async function enqueueDraw(db: Db, job: { readonly orgId: string; readonly kind: 'render' | 'overlay'; readonly documentId: string; readonly payload?: Record<string, unknown> }): Promise<string> {
  const payload = { ...job.payload, documentId: job.documentId, head: true };
  const rows = await db.query<{ id: string; inserted: boolean }>(
    `insert into jobs (id, org_id, kind, payload, run_at, max_attempts, dedupe_key) values ($1, $2, $3, $4, now(), $5, $6)
       on conflict (dedupe_key) where state = 'queued' do update set
         kind = case when excluded.kind = 'render' then 'render' else jobs.kind end,
         payload = case when excluded.kind = 'render' then excluded.payload else jobs.payload end,
         updated_at = now()
       returning id, (xmax = 0) as inserted`,
    [randomId(), job.orgId, job.kind, JSON.stringify(payload), DEFAULT_ATTEMPTS[job.kind], drawKey(job.documentId)],
  );
  const row = rows[0]!;
  if (row.inserted) await db.notify(JOBS_CHANNEL, row.id);
  return row.id;
}

/** Enqueues the job and returns its id, or undefined when its schedule key exists or its dedupe key is already queued. */
export async function enqueue(db: Db, job: NewJob): Promise<string | undefined> {
  const id = randomId();
  const rows = await db.query<{ id: string }>(
    'insert into jobs (id, org_id, kind, payload, run_at, max_attempts, schedule_key, dedupe_key) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing returning id',
    [id, job.orgId, job.kind, JSON.stringify(job.payload), job.runAt ?? new Date(), job.maxAttempts ?? DEFAULT_ATTEMPTS[job.kind], job.scheduleKey ?? null, job.dedupeKey ?? null],
  );
  if (!rows.length) return undefined;
  await db.notify(JOBS_CHANNEL, id);
  return id;
}

/** Renews the lease on jobs this worker is running. */
export async function renewLeases(db: Db, workerId: string, ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.query<{ id: string }>("update jobs set locked_at = now() where state = 'running' and locked_by = $1 and id = any($2::text[]) returning id", [workerId, ids]);
  return new Set(rows.map((r) => r.id));
}

/**
 * Takes back jobs whose lease lapsed: their worker died or hung. Each goes
 * back to the queue for another attempt, fails when it has none left, or
 * is done when a newer copy already waits under the same dedupe key.
 */
export async function reclaimExpired(db: Db, leaseSeconds: number): Promise<{ id: string; kind: string; state: JobState; locked_by: string | null }[]> {
  return db.query(
    `update jobs j set
        state = case when exists (select 1 from jobs q where q.dedupe_key = j.dedupe_key and q.state = 'queued') then 'done' when j.attempts >= j.max_attempts then 'failed' else 'queued' end,
        locked_by = null, run_at = now(), updated_at = now(),
        last_error = 'lease expired on worker ' || coalesce(j.locked_by, 'unknown')
      from (select id, locked_by from jobs where state = 'running' and locked_at < now() - ($1 || ' seconds')::interval for update skip locked) old
      where j.id = old.id
      returning j.id, j.kind, j.state, old.locked_by`,
    [String(leaseSeconds)],
  );
}

/** Puts this worker's running jobs back in the queue without spending an attempt; for a worker that stops before they finish. */
export async function releaseJobs(db: Db, workerId: string, ids: readonly string[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = await db.query<{ id: string }>(
    `update jobs j set state = case when exists (select 1 from jobs q where q.dedupe_key = j.dedupe_key and q.state = 'queued') then 'done' else 'queued' end,
        locked_by = null, attempts = greatest(j.attempts - 1, 0), last_error = 'released by a stopping worker', updated_at = now()
      where j.state = 'running' and j.locked_by = $1 and j.id = any($2::text[]) returning j.id`,
    [workerId, ids],
  );
  return rows.length;
}

/** Claims the oldest runnable job of its lane for this worker, or nothing. A job whose dedupe key is running waits for it. */
export async function claim(db: Db, workerId: string, lane: JobLane = 'hub'): Promise<JobRow | undefined> {
  const rows = await db.query<JobRow>(
    `update jobs set state = 'running', locked_by = $1, locked_at = now(), attempts = attempts + 1, updated_at = now()
      where id = (select q.id from jobs q where q.state = 'queued' and q.run_at <= now() and (q.kind = 'connector-run') = $2
                    and (q.dedupe_key is null or not exists (select 1 from jobs r where r.state = 'running' and r.dedupe_key = q.dedupe_key))
                    order by q.run_at, q.created_at limit 1 for update skip locked)
      returning *`,
    [workerId, lane === 'pool'],
  );
  return rows[0];
}

/** Marks the job done, if this worker still holds it; false when its lease was taken back. */
export async function finish(db: Db, job: JobRow, lines: readonly JobLogLine[]): Promise<boolean> {
  const rows = await db.query<{ id: string }>("update jobs set state = 'done', locked_by = null, log = log || $2::jsonb, updated_at = now() where id = $1 and state = 'running' and locked_by = $3 returning id", [job.id, JSON.stringify(lines), job.locked_by]);
  return rows.length > 0;
}

/** Fails the attempt; requeues with backoff until max_attempts, then marks failed. Returns 'running' when this worker no longer holds the job. */
export async function fail(db: Db, job: JobRow, error: string, lines: readonly JobLogLine[]): Promise<JobState> {
  const exhausted = job.attempts >= job.max_attempts;
  const state: JobState = exhausted ? 'failed' : 'queued';
  const delay = Math.min(300, 5 * 2 ** job.attempts);
  const rows = await db.query<{ id: string }>(
    `update jobs set state = $2, locked_by = null, last_error = $3, log = log || $4::jsonb, run_at = now() + ($5 || ' seconds')::interval, updated_at = now() where id = $1 and state = 'running' and locked_by = $6 returning id`,
    [job.id, state, error, JSON.stringify(lines), String(exhausted ? 0 : delay), job.locked_by],
  );
  return rows.length ? state : 'running';
}

export async function jobById(db: Db, id: string): Promise<JobRow | undefined> {
  return (await db.query<JobRow>('select * from jobs where id = $1', [id]))[0];
}

export async function listJobs(db: Db, orgId: string, limit = 100): Promise<JobRow[]> {
  return db.query<JobRow>('select * from jobs where org_id = $1 order by created_at desc limit $2', [orgId, limit]);
}

/** Lines a job run collects for its history. */
export class JobLog {
  readonly lines: JobLogLine[] = [];
  add(level: JobLogLine['level'], message: string, fields?: Record<string, unknown>): void {
    this.lines.push({ at: new Date().toISOString(), level, message, ...(fields ? { fields } : {}) });
  }
}

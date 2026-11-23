/**
 * The cron matcher: once per minute, every worker asks which publications,
 * workspace reviews, and pool connectors are due and enqueues them; the
 * shared runner pool, outside the hub, runs the connectors. The job
 * table's schedule key makes the second worker's enqueue a no-op, so one
 * due minute is one job however many pods are running.
 */
import type { AppContext } from '../context.ts';
import { cronMatches, cronProblem, minuteKey, parseCron } from './cron.ts';
import { enqueue } from './jobs.ts';
import { scheduledPublications } from '../publishing/repo.ts';
import { scheduledConnectors } from '../sources/repo.ts';
import { dueAt, queueConnectorRun, runRefusal } from '../sources/runs.ts';

export interface ScheduleOutcome {
  readonly minute: string;
  readonly publications: number;
  readonly reviews: number;
  readonly connectors: number;
  /** Due jobs another worker had already enqueued for this minute. */
  readonly duplicates: number;
  readonly invalid: number;
}

/** Enqueues everything due in the minute containing `at`. Safe to call more than once per minute. */
export async function scheduleDue(ctx: AppContext, at: Date): Promise<ScheduleOutcome> {
  const minute = minuteKey(at);
  const log = ctx.log.child({ task: 'schedule', minute });
  log.debug('schedule.start', {});
  let publications = 0, reviews = 0, connectors = 0, duplicates = 0, invalid = 0;
  for (const p of await scheduledPublications(ctx.db, ctx.config.PUBLICATION_APPROVAL)) {
    const cron = p.trigger.kind === 'schedule' ? p.trigger.cron : '';
    const problem = cronProblem(cron);
    if (problem) {
      invalid++;
      log.warn('schedule.publication.invalid', { publicationId: p.id, problem });
      continue;
    }
    if (!cronMatches(cron, at)) continue;
    const id = await enqueue(ctx.db, { orgId: p.org_id, kind: 'publication-run', payload: { publicationId: p.id, trigger: 'schedule' }, scheduleKey: `publication:${p.id}:${minute}` });
    if (id) publications++;
    else duplicates++;
    log.info('schedule.publication', { publicationId: p.id, jobId: id ?? null, duplicate: !id });
  }
  if (cronMatches(parseCron(ctx.config.REVIEW_CRON), at)) {
    const workspaces = await ctx.db.query<{ id: string; org_id: string }>('select id, org_id from workspaces where disabled_at is null');
    for (const w of workspaces) {
      const id = await enqueue(ctx.db, { orgId: w.org_id, kind: 'review', payload: { workspaceId: w.id }, scheduleKey: `review:${w.id}:${minute}` });
      if (id) reviews++;
      else duplicates++;
    }
    log.info('schedule.reviews', { workspaces: workspaces.length, enqueued: reviews });
  }
  for (const s of await scheduledConnectors(ctx.db)) {
    if (!dueAt(s, at)) continue;
    const refused = runRefusal(s, ctx);
    if (refused) {
      log.debug('schedule.connector.skipped', { connectorId: s.id, reason: refused });
      continue;
    }
    const queued = await queueConnectorRun(ctx, s, { trigger: 'schedule', who: 'schedule', scheduleKey: `connector:${s.id}:${minute}` });
    if (queued?.queued) connectors++;
    else duplicates++;
  }
  const outcome = { minute, publications, reviews, connectors, duplicates, invalid };
  if (publications || reviews || connectors || duplicates || invalid) log.info('schedule.end', outcome);
  else log.debug('schedule.end', outcome);
  return outcome;
}

/**
 * Tracks which minutes this worker has handled and runs the matcher for
 * every minute since the last tick, up to a small cap, so a worker busy
 * with a long job catches up instead of skipping a schedule.
 */
export function createScheduler(ctx: AppContext, maxCatchUp = 5): { tick(now?: Date): Promise<ScheduleOutcome[]> } {
  let last: string | undefined;
  return {
    async tick(now = new Date()) {
      const out: ScheduleOutcome[] = [];
      const current = minuteKey(now);
      if (last === current) return out;
      const minutes: Date[] = [];
      if (last) {
        const from = new Date(`${last}:00.000Z`).getTime() + 60_000;
        for (let t = from; t <= now.getTime() && minutes.length < maxCatchUp; t += 60_000) minutes.push(new Date(t));
        if (minutes.length === maxCatchUp && minutes[minutes.length - 1]!.getTime() < now.getTime() - 60_000) ctx.log.warn('schedule.catchup.capped', { from: last, to: current, cap: maxCatchUp });
      } else minutes.push(now);
      if (minutes.length === 0 || minuteKey(minutes[minutes.length - 1]!) !== current) minutes.push(now);
      for (const m of minutes) out.push(await scheduleDue(ctx, m));
      last = current;
      return out;
    },
  };
}

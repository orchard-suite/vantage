/**
 * Connector runs the hub schedules. A connector with an interval runs in
 * the shared runner pool: the scheduler queues one run per due minute, a
 * person may queue one now, and the pool leases each from the job queue.
 * At most one run of a connector waits in the queue and only one runs at a
 * time, so a burst of clicks and a due minute cost one run. A connector's
 * due minutes are spread by its id, so connectors on the same interval do
 * not all start in the same minute.
 */
import type { ConnectorRegistry } from '@vantage/connectors';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/db.ts';
import { enqueue } from '../worker/jobs.ts';
import { connectorBlocked, type SourceRow } from './repo.ts';

/** What queued a run in the pool. */
export type PoolTrigger = 'schedule' | 'manual';

/** The dedupe key every run of one connector shares. */
export const connectorRunKey = (sourceId: string): string => `connector:${sourceId}`;

/** Why a connector of this kind can never run in the shared pool, or undefined when it can. */
export function poolRefusal(kind: string, registry: ConnectorRegistry): string | undefined {
  if (kind === 'push') return 'a push connector has nothing to run; its own script pushes to it';
  const k = registry.get(kind);
  if (!k) return `the pool has no connector kind ${kind}`;
  if (k.hostIdentity) return `a ${kind} connector reads as the machine it runs on, so it needs a runner of its own`;
  return undefined;
}

/** Why the hub cannot queue a run of this connector now, or undefined when it can. */
export function runRefusal(s: SourceRow, ctx: Pick<AppContext, 'connectors' | 'config'>): string | undefined {
  if (s.every_minutes === null) return 'this connector runs on a runner of its own; give it an interval to run it from the hub';
  return poolRefusal(s.connector, ctx.connectors) ?? connectorBlocked(s, ctx.config.CONNECTOR_APPROVAL);
}

/** A stable spread of a connector's due minutes over its interval. */
function offset(id: string, every: number): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % every;
}

/** Whether a connector's interval comes round in the minute that holds `at`. */
export function dueAt(s: Pick<SourceRow, 'id' | 'every_minutes'>, at: Date): boolean {
  if (s.every_minutes === null) return false;
  return Math.floor(at.getTime() / 60_000) % s.every_minutes === offset(s.id, s.every_minutes);
}

/** The start of the next minute after `now` in which the connector is due; null when the hub does not schedule it. */
export function nextRunAt(s: Pick<SourceRow, 'id' | 'every_minutes'>, now: Date): Date | null {
  if (s.every_minutes === null) return null;
  const minute = Math.floor(now.getTime() / 60_000);
  const ahead = (offset(s.id, s.every_minutes) - (minute % s.every_minutes) + s.every_minutes) % s.every_minutes || s.every_minutes;
  return new Date((minute + ahead) * 60_000);
}

export interface QueuedRun {
  readonly jobId: string;
  /** False when a run already waited, and that one stands for this ask. */
  readonly queued: boolean;
}

/**
 * Queues a run of the connector in the pool. When one already waits it is
 * the answer; a schedule key a run already took for this minute queues
 * nothing and answers undefined.
 */
export async function queueConnectorRun(ctx: AppContext, s: SourceRow, run: { trigger: PoolTrigger; who: string; scheduleKey?: string }): Promise<QueuedRun | undefined> {
  const dedupeKey = connectorRunKey(s.id);
  const jobId = await enqueue(ctx.db, { orgId: s.org_id, kind: 'connector-run', payload: { sourceId: s.id, trigger: run.trigger, who: run.who }, dedupeKey, ...(run.scheduleKey ? { scheduleKey: run.scheduleKey } : {}) });
  if (jobId) {
    ctx.log.info('connector.run.queued', { connectorId: s.id, jobId, trigger: run.trigger });
    return { jobId, queued: true };
  }
  const waiting = await ctx.db.query<{ id: string }>("select id from jobs where dedupe_key = $1 and state = 'queued' limit 1", [dedupeKey]);
  if (!waiting[0]) return undefined;
  ctx.log.info('connector.run.waiting', { connectorId: s.id, jobId: waiting[0].id, trigger: run.trigger });
  return { jobId: waiting[0].id, queued: false };
}

/** The run each connector has waiting or running in the pool, by connector id. */
export async function pendingRuns(db: Db, sourceIds: readonly string[]): Promise<Map<string, 'queued' | 'running'>> {
  if (!sourceIds.length) return new Map();
  const rows = await db.query<{ source_id: string; state: 'queued' | 'running' }>(
    "select payload->>'sourceId' as source_id, state from jobs where kind = 'connector-run' and state in ('queued', 'running') and payload->>'sourceId' = any($1::text[])",
    [sourceIds],
  );
  const out = new Map<string, 'queued' | 'running'>();
  for (const r of rows) if (out.get(r.source_id) !== 'running') out.set(r.source_id, r.state);
  return out;
}

import { describe, expect, test } from 'bun:test';
import { testContext } from '../testing.ts';
import type { AppContext } from '../context.ts';
import { claim, enqueue, enqueueDraw, fail, finish, jobById, reclaimExpired } from './jobs.ts';
import { createWorker } from './loop.ts';
import { runGc } from './gc.ts';
import { JobLog } from './jobs.ts';

const ORG = 'default';

async function ageLease(ctx: AppContext, id: string, seconds: number): Promise<void> {
  await ctx.db.query("update jobs set locked_at = now() - ($2 || ' seconds')::interval where id = $1", [id, String(seconds)]);
}

/** A blob store whose deletes wait for `release()`, so drop-files jobs block; counts how many run at once. */
function gateBlob(ctx: AppContext): { release(): void; peak(): number; started(): number } {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let running = 0;
  let peak = 0;
  let started = 0;
  ctx.blob.delete = async () => {
    running++;
    started++;
    peak = Math.max(peak, running);
    await gate;
    running--;
  };
  return { release: () => open(), peak: () => peak, started: () => started };
}

async function dropJobs(ctx: AppContext, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push((await enqueue(ctx.db, { orgId: ORG, kind: 'drop-files', payload: { keys: [`k${i}`] } }))!);
  return ids;
}

async function until(check: () => Promise<boolean> | boolean, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('job queue', () => {
  test('one queued job per dedupe key; a running job frees its key', async () => {
    const ctx = await testContext();
    const job = { orgId: ORG, kind: 'overlay' as const, payload: { documentId: 'd1' }, dedupeKey: 'overlay:d1' };
    const first = await enqueue(ctx.db, job);
    expect(first).toBeDefined();
    expect(await enqueue(ctx.db, job)).toBeUndefined();
    expect((await claim(ctx.db, 'w1'))?.id).toBe(first!);
    const next = await enqueue(ctx.db, job);
    expect(next).toBeDefined();
    expect(next).not.toBe(first);
  });

  test("a save's draw is claimed before a source refresh queued ahead of it", async () => {
    const ctx = await testContext();
    const refresh = await enqueueDraw(ctx.db, { orgId: ORG, kind: 'overlay', documentId: 'bound' });
    const save = await enqueueDraw(ctx.db, { orgId: ORG, kind: 'render', documentId: 'saved' });
    expect((await claim(ctx.db, 'w1'))?.id).toBe(save);
    expect((await claim(ctx.db, 'w1'))?.id).toBe(refresh);
  });

  test('a document has one queued draw; a save takes the place of a source refresh', async () => {
    const ctx = await testContext();
    const refresh = await enqueueDraw(ctx.db, { orgId: ORG, kind: 'overlay', documentId: 'd1', payload: { source: 's' } });
    const save = await enqueueDraw(ctx.db, { orgId: ORG, kind: 'render', documentId: 'd1', payload: { versionId: 'v2' } });
    const again = await enqueueDraw(ctx.db, { orgId: ORG, kind: 'overlay', documentId: 'd1' });
    expect(save).toBe(refresh);
    expect(again).toBe(refresh);
    const job = (await jobById(ctx.db, refresh))!;
    expect(job.kind).toBe('render');
    expect(job.payload).toEqual({ versionId: 'v2', documentId: 'd1', head: true });
    expect(await enqueueDraw(ctx.db, { orgId: ORG, kind: 'render', documentId: 'd2' })).not.toBe(refresh);
  });

  test('a document draws on one worker at a time', async () => {
    const ctx = await testContext();
    const first = await enqueueDraw(ctx.db, { orgId: ORG, kind: 'render', documentId: 'd1' });
    const running = (await claim(ctx.db, 'w1'))!;
    expect(running.id).toBe(first);
    const second = await enqueueDraw(ctx.db, { orgId: ORG, kind: 'render', documentId: 'd1' });
    expect(second).not.toBe(first);
    const other = await enqueueDraw(ctx.db, { orgId: ORG, kind: 'render', documentId: 'd2' });
    // The second draw of d1 waits behind the first; d2 goes ahead.
    expect((await claim(ctx.db, 'w2'))?.id).toBe(other);
    expect(await claim(ctx.db, 'w2')).toBeUndefined();
    expect(await finish(ctx.db, running, [])).toBe(true);
    expect((await claim(ctx.db, 'w2'))?.id).toBe(second);
  });

  test('a lapsed lease goes back to the queue, and the old worker can no longer finish it', async () => {
    const ctx = await testContext();
    const id = (await enqueue(ctx.db, { orgId: ORG, kind: 'render', payload: {} }))!;
    const held = (await claim(ctx.db, 'dead-worker'))!;
    expect(await reclaimExpired(ctx.db, 60)).toEqual([]);
    await ageLease(ctx, id, 120);
    const reclaimed = await reclaimExpired(ctx.db, 60);
    expect(reclaimed.map((r) => [r.id, r.state, r.locked_by])).toEqual([[id, 'queued', 'dead-worker']]);
    const retaken = (await claim(ctx.db, 'w2'))!;
    expect(retaken.attempts).toBe(2);
    expect(await finish(ctx.db, held, [])).toBe(false);
    expect(await fail(ctx.db, held, 'late', [])).toBe('running');
    expect(await finish(ctx.db, retaken, [])).toBe(true);
    expect((await jobById(ctx.db, id))?.state).toBe('done');
  });

  test('a lapsed lease with no attempts left fails, and one with a newer copy queued is done', async () => {
    const ctx = await testContext();
    const last = (await enqueue(ctx.db, { orgId: ORG, kind: 'publication-run', payload: {} }))!;
    await claim(ctx.db, 'dead');
    const dup = { orgId: ORG, kind: 'overlay' as const, payload: {}, dedupeKey: 'overlay:d2' };
    const old = (await enqueue(ctx.db, dup))!;
    await claim(ctx.db, 'dead');
    const newer = (await enqueue(ctx.db, dup))!;
    await ageLease(ctx, last, 600);
    await ageLease(ctx, old, 600);
    const states = Object.fromEntries((await reclaimExpired(ctx.db, 60)).map((r) => [r.id, r.state]));
    expect(states).toEqual({ [last]: 'failed', [old]: 'done' });
    expect((await jobById(ctx.db, newer))?.state).toBe('queued');
  });

  test('a worker runs up to its concurrency at once', async () => {
    const ctx = await testContext({ env: { WORKER_CONCURRENCY: '3', WORKER_POLL_SECONDS: '1' } });
    const gate = gateBlob(ctx);
    await dropJobs(ctx, 5);
    const worker = createWorker(ctx);
    await worker.start();
    await until(() => gate.started() === 3);
    await new Promise((r) => setTimeout(r, 50));
    expect(gate.started()).toBe(3);
    gate.release();
    await until(async () => (await ctx.db.query<{ n: string }>("select count(*)::text as n from jobs where kind = 'drop-files' and state = 'done'"))[0]!.n === '5');
    expect(gate.peak()).toBe(3);
    await worker.stop();
  });

  test('a job whose failure cannot be recorded leaves the worker running and the job leased', async () => {
    const ctx = await testContext();
    const id = (await enqueue(ctx.db, { orgId: ORG, kind: 'drop-files', payload: { keys: ['k'] } }))!;
    ctx.blob.delete = async () => {
      throw new Error('store unreachable');
    };
    const real = ctx.db.query.bind(ctx.db);
    // The job fails, and the database is gone by the time the worker records it.
    ctx.db.query = (async (text: string, params?: readonly unknown[]) => {
      if (text.startsWith('update jobs set state = $2')) throw Object.assign(new Error('write CONNECTION_CLOSED db:5432'), { code: 'CONNECTION_CLOSED' });
      return real(text, params);
    }) as typeof ctx.db.query;
    expect(await createWorker(ctx).tick()).toBe(true);
    expect((await jobById(ctx.db, id))!.state).toBe('running');
  });

  test('a stopping worker hands back what is still running without spending an attempt', async () => {
    const ctx = await testContext({ env: { SHUTDOWN_GRACE_SECONDS: '0' } });
    const gate = gateBlob(ctx);
    const id = (await dropJobs(ctx, 1))[0]!;
    const worker = createWorker(ctx);
    await worker.start();
    await until(() => gate.started() === 1);
    await worker.stop();
    const row = (await jobById(ctx.db, id))!;
    expect([row.state, row.attempts, row.locked_by]).toEqual(['queued', 0, null]);
    gate.release();
  });

  test('gc prunes finished jobs older than HISTORY_DAYS and keeps queued and recent ones', async () => {
    const ctx = await testContext({ env: { HISTORY_DAYS: '7' } });
    const old = (await enqueue(ctx.db, { orgId: ORG, kind: 'render', payload: {} }))!;
    const recent = (await enqueue(ctx.db, { orgId: ORG, kind: 'render', payload: {} }))!;
    const waiting = (await enqueue(ctx.db, { orgId: ORG, kind: 'render', payload: {}, runAt: new Date(Date.now() + 3_600_000) }))!;
    await ctx.db.query("update jobs set state = 'done', updated_at = now() - interval '8 days' where id = $1", [old]);
    await ctx.db.query("update jobs set state = 'done' where id = $1", [recent]);
    const out = await runGc(ctx, ORG, new JobLog());
    expect(out.jobsRemoved).toBe(1);
    expect(await jobById(ctx.db, old)).toBeUndefined();
    expect((await jobById(ctx.db, recent))?.state).toBe('done');
    expect((await jobById(ctx.db, waiting))?.state).toBe('queued');
  });
});

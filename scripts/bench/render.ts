#!/usr/bin/env bun
/**
 * Render at scale through the hub itself: a push source with a synthetic
 * fleet, one live document drawing all of it, and documents bound to it.
 * Several ticks of churn run first, so the observed model carries the
 * vanished entities production carries. Prints per job kind how long the
 * worker took and what it wrote.
 *
 *   bun scripts/bench/render.ts [entities ...] [--ticks 6] [--bound 20] [--threads 2] [--concurrency 4]
 *
 * With --threads 0 the drawing runs on the event loop and the worker runs
 * one job at a time, the way the hub did before the render pool.
 */
import { testApp } from '../../packages/hub/src/testing.ts';
import { createWorker } from '../../packages/hub/src/worker/loop.ts';
import { entityCount, fleetBatch, fleetDocument, boundDocument, shapeFor } from './fleet.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const ticks = flag('ticks', 6);
const bound = flag('bound', 20);
const threads = flag('threads', 2);
const concurrency = flag('concurrency', 4);
const sizes = args.filter((a, i) => /^\d+$/.test(a) && !args[i - 1]?.startsWith('--')).map(Number);

interface JobTiming {
  readonly kind: string;
  readonly n: number;
  readonly totalMs: number;
  readonly maxMs: number;
}

async function timings(ctx: Awaited<ReturnType<typeof testApp>>['ctx'], since: Date): Promise<JobTiming[]> {
  const rows = await ctx.db.query<{ kind: string; n: string; total: string; max: string }>(
    "select kind, count(*)::text as n, sum(extract(epoch from (updated_at - locked_at)) * 1000)::text as total, max(extract(epoch from (updated_at - locked_at)) * 1000)::text as max from jobs where state = 'done' and locked_at >= $1 group by kind order by kind",
    [since],
  );
  return rows.map((r) => ({ kind: r.kind, n: Number(r.n), totalMs: Math.round(Number(r.total)), maxMs: Math.round(Number(r.max)) }));
}

async function bench(entities: number): Promise<void> {
  const shape = shapeFor(entities);
  const t = await testApp({ env: { RENDER_THREADS: String(threads), WORKER_CONCURRENCY: String(concurrency), WORKER_POLL_SECONDS: '1' } });
  const admin = await t.bearer('bench-admin', { admin: true });
  const h = { ...admin.headers };
  const ws = await t.json('/api/v1/workspaces', { method: 'POST', headers: h, body: JSON.stringify({ name: 'Bench' }) });
  const src = await t.json(`/api/v1/workspaces/${String(ws.body['slug'])}/connectors`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'Fleet', slug: 'fleet', connector: 'push', clientId: 'bench-fleet' }) });
  const push = await t.connector('bench-fleet');
  const pushPath = `/api/v1/connector/${String(src.body['id'])}/batches`;
  const worker = createWorker(t.ctx);
  /** Runs the worker the way the hub does until nothing is queued or running; returns the wall time. */
  const settle = async (): Promise<number> => {
    const started = performance.now();
    if (threads === 0) {
      await worker.drain();
      return performance.now() - started;
    }
    await worker.start();
    for (;;) {
      const n = (await t.ctx.db.query<{ n: string }>("select count(*)::text as n from jobs where state in ('queued', 'running') and run_at <= now()"))[0]?.n;
      if (n === '0') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await worker.stop();
    return performance.now() - started;
  };
  const docs = [{ name: 'Fleet', yaml: fleetDocument('fleet') }, ...Array.from({ length: bound }, (_, i) => ({ name: `Service ${i}`, yaml: boundDocument('fleet', i) }))];
  for (const d of docs) {
    const r = await t.json(`/api/v1/workspaces/${String(ws.body['slug'])}/documents`, { method: 'POST', headers: h, body: JSON.stringify(d) });
    if (r.status !== 201) throw new Error(`create ${d.name}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  await settle();
  let last: JobTiming[] = [];
  let pushMs = 0;
  let wallMs = 0;
  for (let tick = 0; tick < ticks; tick++) {
    const batch = fleetBatch('fleet', shape, tick);
    const started = performance.now();
    const r = await t.json(pushPath, { method: 'POST', headers: push, body: JSON.stringify(batch) });
    if (r.status !== 202) throw new Error(`push: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    pushMs = performance.now() - started;
    const since = new Date();
    wallMs = await settle();
    last = await timings(t.ctx, since);
  }
  const observed = await t.ctx.db.query<{ n: string; bytes: string }>("select (select count(*) from jsonb_object_keys(model->'entities'))::text as n, length(model::text)::text as bytes from observed_models");
  const artifacts = await t.ctx.db.query<{ kind: string; n: string; bytes: string }>(
    "select a.kind, count(*)::text as n, sum(a.bytes)::text as bytes from artifacts a join documents d on d.name = 'Fleet' join versions v on v.id = d.head_version_id and v.hash = a.version_hash group by a.kind order by a.kind",
  );
  const mb = (b: string | number): string => (Number(b) / 1e6).toFixed(1);
  console.log(`\n== ${entityCount(shape)} entities per tick (${JSON.stringify(shape)}), ${ticks} ticks, ${docs.length} documents`);
  console.log(`observed model: ${observed[0]?.n} entities, ${mb(observed[0]?.bytes ?? 0)} MB; last push answered in ${pushMs.toFixed(0)} ms; its jobs took ${wallMs.toFixed(0)} ms wall (threads ${threads}, concurrency ${threads === 0 ? 1 : concurrency})`);
  for (const j of last) console.log(`  ${j.kind.padEnd(14)} ${String(j.n).padStart(4)} jobs  total ${String(j.totalMs).padStart(7)} ms  max ${String(j.maxMs).padStart(7)} ms`);
  for (const a of artifacts) console.log(`  fleet ${a.kind.padEnd(7)} ${a.n.padStart(4)} files ${mb(a.bytes).padStart(7)} MB`);
  await t.ctx.render.close();
  await t.ctx.db.close();
}

for (const n of sizes.length ? sizes : [1_500, 10_000]) await bench(n);

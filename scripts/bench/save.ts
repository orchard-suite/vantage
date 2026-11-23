#!/usr/bin/env bun
/**
 * A save's time to its picture through the hub itself: one document is
 * saved and drawn, then each of its relation views is edited in turn (its
 * title), one save at a time. For every save it prints how long until the
 * first picture was stored and readers were told, and how long until the
 * second pass finished. The target is under 4 s on a hub's own workers.
 *
 *   bun scripts/bench/save.ts [file.vantage.yaml] [--saves 5]
 *
 * Times here are this machine's; a hub's workers may run this job several
 * times slower.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { testApp } from '../../packages/hub/src/testing.ts';
import { channelName } from '../../packages/hub/src/db/db.ts';
import { createWorker } from '../../packages/hub/src/worker/loop.ts';

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith('.yaml')) ?? join(import.meta.dir, '..', '..', 'examples', 'harbor', 'harbor.vantage.yaml');
const savesAt = args.indexOf('--saves');
const saves = savesAt >= 0 ? Number(args[savesAt + 1]) : 5;
const yaml = readFileSync(file, 'utf8');

const t = await testApp({ env: { RENDER_THREADS: '1', WORKER_CONCURRENCY: '1' } });
const me = await t.bearer('bench', { admin: true });
const ws = await t.json('/api/v1/workspaces', { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'Saves' }) });
const slug = String(ws.body['slug']);
const created = await t.json(`/api/v1/workspaces/${slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml }) });
const docSlug = String((created.body['document'] as { slug: string }).slug);
const docId = String((created.body['document'] as { id: string }).id);
const worker = createWorker(t.ctx);
await worker.drain();

const told: number[] = [];
await t.ctx.db.listen(channelName('vantage_doc', docId), () => told.push(performance.now()));
const titles = [...yaml.matchAll(/\n {4}title: ([^\n]+)/g)].map((m) => m[1]!);
let head = String((created.body['version'] as { id: string }).id);
let text = yaml;
console.log(`${file}: ${titles.length} view titles; ${saves} saves`);
for (let i = 0; i < Math.min(saves, titles.length); i++) {
  text = text.replace(`\n    title: ${titles[i]}\n`, `\n    title: ${titles[i]} (edited)\n`);
  told.length = 0;
  const started = performance.now();
  const saved = await t.json(`/api/v1/workspaces/${slug}/documents/${docSlug}`, { method: 'PUT', headers: me.headers, body: JSON.stringify({ yaml: text, expectedVersion: head }) });
  head = String((saved.body['version'] as { id: string }).id);
  await worker.drain();
  await new Promise((r) => setTimeout(r, 20));
  const picture = told[0] !== undefined ? Math.round(told[0] - started) : NaN;
  const whole = told.length ? Math.round(told[told.length - 1]! - started) : NaN;
  console.log(`  ${titles[i]!.padEnd(40)} picture ${String(picture).padStart(5)} ms   whole ${String(whole).padStart(5)} ms`);
}
await t.ctx.db.close();
// The render threads keep the process alive.
process.exit(0);

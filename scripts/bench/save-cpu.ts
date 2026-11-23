#!/usr/bin/env bun
/**
 * The CPU a run of saves costs the hub, from each save's request to its
 * picture stored: the work a slow machine pays in time. One process does
 * all of it (the save, its check, the worker's draw, the store, the
 * database), with no render threads, so the CPU it reports is the whole
 * cost and does not depend on how many cores the machine has.
 *
 * The document is the release's load test document: the stress base at 40
 * views. It is drawn once first, unmeasured. Then each save changes one
 * fact on one node, as the load test's agents do, and the worker draws it
 * before the next save. Prints the CPU milliseconds as the last line, as
 * the JSON the climb tool reads.
 *
 *   bun scripts/bench/save-cpu.ts [--saves 20]
 */
import { readFileSync } from 'node:fs';
import { testApp } from '../../packages/hub/src/testing.ts';
import { createWorker } from '../../packages/hub/src/worker/loop.ts';
import { STRESS_BASE, stressDocument } from './stress.ts';

const args = process.argv.slice(2);
const at = args.indexOf('--saves');
const SAVES = at >= 0 ? Number(args[at + 1]) : 20;
const yaml = stressDocument(readFileSync(STRESS_BASE, 'utf8'), 40);

const t = await testApp({ env: { RENDER_THREADS: '0', WORKER_CONCURRENCY: '1' } });
const me = await t.bearer('bench', { admin: true });
const ws = await t.json('/api/v1/workspaces', { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'Saves' }) });
const slug = String(ws.body['slug']);
const created = await t.json(`/api/v1/workspaces/${slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml }) });
const docSlug = String((created.body['document'] as { slug: string }).slug);
const worker = createWorker(t.ctx);
await worker.drain();

/** The fact on the first node that has facts, set to `n`: one line changes, as in the load test. */
function edit(text: string, n: number): string {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^\s+facts: \[/.test(l));
  lines[i] = lines[i]!.replace(/^(\s+facts: \[)(?:"Load \d+", )?/, `$1"Load ${n}", `);
  return lines.join('\n');
}

let head = String((created.body['version'] as { id: string }).id);
let text = yaml;
const cpu0 = process.cpuUsage();
const wall0 = performance.now();
for (let i = 1; i <= SAVES; i++) {
  text = edit(text, i);
  const saved = await t.json(`/api/v1/workspaces/${slug}/documents/${docSlug}`, { method: 'PUT', headers: me.headers, body: JSON.stringify({ yaml: text, expectedVersion: head }) });
  if (saved.status !== 200) throw new Error(`save ${i} answered ${saved.status}`);
  head = String((saved.body['version'] as { id: string }).id);
  await worker.drain();
}
const cpu = process.cpuUsage(cpu0);
const wall = performance.now() - wall0;
await t.ctx.db.close();
console.log(JSON.stringify({ value: Math.round((cpu.user + cpu.system) / 1000), metrics: { wallMs: Math.round(wall), saves: SAVES } }));
process.exit(0);

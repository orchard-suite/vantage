#!/usr/bin/env bun
/**
 * Saves under load, this build against another (the last release), on one
 * machine. A shared runner's speed swings from run to run, so a fixed limit
 * in seconds fails on a slow machine and misses a slow change on a fast
 * one. This bench runs load-saves.ts for each build in turn, in a balanced
 * order (base, head, head, base, ...), so a machine that slows down partway
 * weighs on both alike, and judges this build only against the other.
 *
 *   bun scripts/bench/load-compare.ts --database-url postgres://localhost:5432/vantage
 *     --base ../base [--rounds 3] [--max-ratio 1.25] [-- load-saves arguments]
 *
 * `--base` is a checkout of the other build with its packages installed.
 * Each build's figure is the median of its rounds' save-to-picture p95, so
 * one round on a busy moment does not decide. Exits 1 when this build's
 * figure passes the base's times --max-ratio, or when any of its own
 * rounds failed (a save never shown, a request failed).
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { LoadRun } from './load-saves.ts';

const args = process.argv.slice(2);
const split = args.indexOf('--');
const own = split >= 0 ? args.slice(0, split) : args;
const passed = split >= 0 ? args.slice(split + 1) : [];
const opt = (name: string, fallback: string): string => {
  const i = own.indexOf(`--${name}`);
  return i >= 0 ? own[i + 1]! : fallback;
};
const DATABASE_URL = opt('database-url', '');
const BASE = opt('base', '');
const ROUNDS = Number(opt('rounds', '3'));
const MAX_RATIO = Number(opt('max-ratio', '1.25'));
if (!DATABASE_URL || !BASE) {
  console.error('give --database-url of a Postgres server and --base, a checkout of the build to compare against');
  process.exit(2);
}

const HEAD = resolve(import.meta.dir, '..', '..');
const BENCH = join(import.meta.dir, 'load-saves.ts');
const out = mkdtempSync(join(tmpdir(), 'vantage-compare-'));
type Build = 'base' | 'head';
const roots: Record<Build, string> = { base: resolve(BASE), head: HEAD };
const runs: Record<Build, LoadRun[]> = { base: [], head: [] };

/** base, head, head, base, base, head, ...: each build goes first as often as last. */
const order: Build[] = Array.from({ length: ROUNDS * 2 }, (_, i) => ((i % 4 === 0 || i % 4 === 3) ? 'base' : 'head'));

for (const [i, build] of order.entries()) {
  const json = join(out, `${i}-${build}.json`);
  console.log(`\n── round ${Math.floor(i / 2) + 1}, ${build} (${roots[build]})`);
  const run = Bun.spawn([process.execPath, BENCH, '--database-url', DATABASE_URL, '--hub-root', roots[build], '--json', json, ...passed], { stdout: 'inherit', stderr: 'inherit' });
  const code = await run.exited;
  // A bench that stopped before it measured (the first picture never came, a crash) is a failed round.
  runs[build].push(existsSync(json) ? (JSON.parse(readFileSync(json, 'utf8')) as LoadRun) : { pictures: [], unshown: 0, p95: NaN, firstPicture: null, failures: [`the bench exited ${code} before it measured`] });
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const figure = (b: Build): number => median(runs[b].map((r) => r.p95).filter((x) => !Number.isNaN(x)));
const base = figure('base');
const head = figure('head');
const ratio = head / base;

console.log(`\n${'build'.padEnd(6)} ${'p95 per round'.padEnd(28)} median`);
for (const b of ['base', 'head'] as const) console.log(`${b.padEnd(6)} ${runs[b].map((r) => `${r.p95.toFixed(2)} s`).join('  ').padEnd(28)} ${figure(b).toFixed(2)} s`);
console.log(`head is ${ratio.toFixed(2)}x the base; the limit is ${MAX_RATIO}x`);

const failures = [
  ...(ratio > MAX_RATIO ? [`save-to-picture p95 ${head.toFixed(2)} s is ${ratio.toFixed(2)}x the base's ${base.toFixed(2)} s, over ${MAX_RATIO}x`] : []),
  ...(Number.isNaN(ratio) ? ['no comparison: a build measured nothing'] : []),
  ...runs.head.flatMap((r, i) => r.failures.map((f) => `head round ${i + 1}: ${f}`)),
];
for (const b of runs.base.flatMap((r, i) => r.failures.map((f) => `base round ${i + 1}: ${f}`))) console.log(`note: ${b}`);
for (const f of failures) console.error(`FAIL: ${f}`);
process.exit(failures.length ? 1 : 0);

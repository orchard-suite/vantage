#!/usr/bin/env bun
/**
 * Prints what the agent door costs: each task on the hub beside the same
 * task on a disk, the tasks whose cost must not grow with what they move,
 * and what an agent holds before it works. The check gate runs the same
 * numbers as a test (agent-cost.test.ts) and fails on one over its budget.
 *
 *   bun scripts/bench/agent-cost.ts
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, measureFixed, measureStanding, measureTasks } from './agent-cost/tasks.ts';

const n = (x: number): string => x.toLocaleString('en-US').padStart(7);
const f = await fixture();
console.log('task                                        hub in+out  calls   disk in+out  calls   budget');
for (const r of await measureTasks(f)) console.log(`${r.ok ? 'ok  ' : 'OVER'} ${r.name.padEnd(38)} ${n(r.hub.in + r.hub.out)} ${n(r.hub.calls)}   ${n(r.disk.in + r.disk.out)} ${n(r.disk.calls)}  ${n(r.budget)}`);
console.log('\nfixed size, whatever is moved                                              chars   budget');
for (const r of await measureFixed(f)) console.log(`${r.ok ? 'ok  ' : 'OVER'} ${r.name.padEnd(68)} ${n(r.chars)}  ${n(r.budget)}`);
console.log('\nheld before any work                                                       chars   budget');
for (const r of await measureStanding(f, readdirSync(join(import.meta.dir, '..', '..', 'skills')))) console.log(`${r.ok ? 'ok  ' : 'OVER'} ${r.name.padEnd(68)} ${n(r.chars)}  ${n(r.budget)}`);
await f.t.ctx.db.close();
process.exit(0);

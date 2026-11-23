import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, measureFixed, measureStanding, measureTasks, type Fixture } from './agent-cost/tasks.ts';

/**
 * The bar of VAN-0002, held in the check gate: working in the
 * hub costs an agent no more than working on a disk, and what it holds
 * before it works stays inside its budget.
 */
describe('agent cost', () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await fixture();
  });
  afterAll(async () => {
    await f.t.ctx.db.close();
  });

  test('each task costs no more on the hub than on a disk, in no more calls', async () => {
    const rows = await measureTasks(f);
    expect(rows.map((r) => r.kind)).toEqual(expect.arrayContaining(['box', 'view', 'page', 'record']));
    expect(rows.filter((r) => !r.ok).map((r) => `${r.name}: hub ${r.hub.in + r.hub.out} in ${r.hub.calls} calls, budget ${r.budget} in ${r.disk.calls}`)).toEqual([]);
  });

  test('a picture, a file sent by its path, and a sync cost a fixed size', async () => {
    expect((await measureFixed(f)).filter((r) => !r.ok).map((r) => `${r.name}: ${r.chars}, budget ${r.budget}`)).toEqual([]);
  });

  test('what an agent holds before it works is inside its budget', async () => {
    const rows = await measureStanding(f, readdirSync(join(import.meta.dir, '..', '..', 'skills')));
    expect(rows.filter((r) => !r.ok).map((r) => `${r.name}: ${r.chars}, budget ${r.budget}`)).toEqual([]);
  });
});

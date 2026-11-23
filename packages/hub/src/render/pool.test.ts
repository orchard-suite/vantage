import { afterEach, describe, expect, test } from 'bun:test';
import { silentLogger } from '../log.ts';
import { SAMPLE_YAML } from '../testing.ts';
import { createRenderPool, PoolBusyError, type RenderPool } from './pool.ts';
import { NO_RESOURCES } from './resources.ts';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#36c"/></svg>';
const pools: RenderPool[] = [];
const pool = (threads: number, timeoutMs = 30_000, maxQueue = 50): RenderPool => {
  const p = createRenderPool({ threads, timeoutMs, maxQueue, log: silentLogger });
  pools.push(p);
  return p;
};
afterEach(async () => {
  for (const p of pools.splice(0)) await p.close();
});

const documentInput = { yaml: SAMPLE_YAML, imports: {}, hash: 'h1', observed: { entities: {}, relations: {} }, resources: NO_RESOURCES, thresholdDays: 7, now: '2026-11-01T00:00:00.000Z' };

describe('render pool', () => {
  test('threads draw a document and a picture, and their results cross back intact', async () => {
    const p = pool(2);
    const [views, png] = await Promise.all([p.run('range', { ...documentInput, from: 0, to: 1 }), p.run('png', { svg: SVG })]);
    expect(views.map((v) => v.id)).toEqual(['context']);
    expect(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(views[0]!.entryGz!)))).id).toBe('context');
    expect(png).toBeInstanceOf(Uint8Array);
    expect([...png.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });

  test('a matching digest skips the drawing; the same input gives the same digest on any thread', async () => {
    const p = pool(2);
    const first = await p.run('plan', documentInput);
    const again = await p.run('plan', { ...documentInput, previousDigest: first.digest });
    expect(again.kind).toBe('skipped');
    expect(again.digest).toBe(first.digest);
  });

  test('a task error comes back as a rejection and the thread keeps serving', async () => {
    const p = pool(1);
    await expect(p.run('png', { svg: 'not svg' })).rejects.toThrow();
    expect((await p.run('png', { svg: SVG })).byteLength).toBeGreaterThan(50);
  });

  test('a picture too large for a PNG is refused on the thread and keeps its name across', async () => {
    const p = pool(1);
    const huge = '<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="20000"><rect width="20000" height="20000"/></svg>';
    await expect(p.run('png', { svg: huge })).rejects.toMatchObject({ name: 'PictureTooLargeError' });
    expect((await p.run('png', { svg: SVG })).byteLength).toBeGreaterThan(50);
  });

  test('a task past its deadline fails and its thread is replaced', async () => {
    const p = pool(1);
    await expect(p.run('localValidate', { text: bigDocument(400) }, { timeoutMs: 50 })).rejects.toThrow(/exceeded 50 ms/);
    expect((await p.run('plan', documentInput)).kind).toBe('planned');
    expect(p.stats()).toEqual({ threads: 1, running: 0, queued: 0 });
  });

  test('a full queue refuses with PoolBusyError instead of growing without bound', async () => {
    const p = pool(1, 30_000, 1);
    const running = p.run('localValidate', { text: bigDocument(150) });
    const waiting = p.run('png', { svg: SVG });
    await expect(p.run('png', { svg: SVG })).rejects.toBeInstanceOf(PoolBusyError);
    await Promise.all([running, waiting]);
  });
});

/** A document with `n` nodes in a chain, slow enough to lay out that a short deadline catches it. */
function bigDocument(n: number): string {
  const nodes = Array.from({ length: n }, (_, i) => `  - { id: n${i}, name: Node ${i} }`).join('\n');
  const relations = Array.from({ length: n - 1 }, (_, i) => `  - { from: n${i}, to: n${i + 1}, label: calls }`).join('\n');
  return `title: Big\nnodes:\n${nodes}\nrelations:\n${relations}\nviews:\n  - id: all\n    title: All\n    include: { nodes: [${Array.from({ length: n }, (_, i) => `n${i}`).join(', ')}] }\n`;
}

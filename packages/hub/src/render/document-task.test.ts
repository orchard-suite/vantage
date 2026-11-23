import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drawDocument, type DrawResult, type DrawRunner } from '../worker/draw.ts';
import { drawRange, planDocument, splitRanges, type CachedView, type DocumentInput, type RangeView } from './document-task.ts';
import { NO_RESOURCES } from './resources.ts';

const root = join(import.meta.dir, '..', '..', '..', '..');
const example = (path: string): string => readFileSync(join(root, 'examples', path), 'utf8');
const SHOP = example('shop/shop.vantage.yaml');
const HARBOR = example('harbor/harbor.vantage.yaml');
const input = (yaml: string): DocumentInput => ({ yaml, imports: {}, hash: 'h', observed: { entities: {}, relations: {} }, resources: NO_RESOURCES, thresholdDays: 7, now: '2026-11-01T00:00:00Z' });

type Rendered = Extract<DrawResult, { kind: 'rendered' }>;

/** Runs the plan and ranges in place, with the given number of threads. */
const inPlace = (threads: number): DrawRunner => ({ threads, plan: async (i) => planDocument(i), range: async (i) => drawRange(i) });

/** Stands in for the store: every entry drawn so far, by digest. */
class Store {
  private readonly entries = new Map<string, string>();
  keep(out: Rendered): void {
    for (const v of out.views) if (v.entryGz) this.entries.set(v.digest, new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(v.entryGz))));
  }
  /** The bundle a reader assembles: the shell with every view's entry. */
  bundle(out: Rendered): string {
    const shell = JSON.parse(out.shell) as Record<string, unknown>;
    return JSON.stringify({ ...shell, views: out.views.map((v) => JSON.parse(this.entries.get(v.digest)!) as unknown) });
  }
}

async function render(yaml: string, threads: number, store: Store, cached?: Readonly<Record<string, CachedView>>): Promise<Rendered> {
  const out = await drawDocument(inPlace(threads), { ...input(yaml), cached });
  if (out.kind !== 'rendered') throw new Error(`expected a render, got ${out.kind}`);
  store.keep(out);
  return out;
}

const cacheOf = (out: Rendered): Record<string, CachedView> =>
  Object.fromEntries(out.views.map((v: RangeView) => [v.id, { digest: v.digest, ...(v.anchors ? { anchors: v.anchors } : {}), score: v.score, width: v.width, height: v.height }]));
const drawn = (out: Rendered): string[] => out.views.filter((v) => v.entryGz !== undefined).map((v) => v.id);
const edit = (yaml: string): string => {
  const text = yaml.replace(/(\n {4}title: )([^\n]+)/, '$1$2 (edited)');
  expect(text).not.toBe(yaml);
  return text;
};

describe('a render', () => {
  test('carries the layout kit in its shell, so the viewer opens, folds, and zooms groups itself', async () => {
    const out = await render(SHOP, 1, new Store());
    const shell = JSON.parse(out.shell) as { kit?: { views: { id: string }[] }; views?: unknown };
    expect(shell.kit?.views.length).toBeGreaterThan(0);
    expect(shell.views).toBeUndefined();
  });

  test('a document drawn for the first time is one range', () => {
    const plan = planDocument(input(HARBOR));
    if (plan.kind !== 'planned') throw new Error(plan.kind);
    expect(splitRanges(plan.views, undefined, 4)).toEqual([{ from: 0, to: plan.views.length }]);
  });
});

describe('a render with the last render as its cache', () => {
  test('an unchanged document draws nothing and gives the same bundle', async () => {
    const store = new Store();
    const full = await render(SHOP, 1, store);
    const again = await render(SHOP, 1, store, cacheOf(full));
    expect(drawn(again)).toEqual([]);
    expect(store.bundle(again)).toBe(store.bundle(full));
  });

  test('a change to one view draws that view, and the result matches a full render of the new text', async () => {
    const store = new Store();
    const full = await render(SHOP, 1, store);
    const text = edit(SHOP);
    const fresh = await render(text, 1, store);
    const changed = await render(text, 1, store, cacheOf(full));
    expect(drawn(changed)).toContain(full.views[0]!.id);
    expect(drawn(changed).length).toBeLessThan(full.views.length);
    expect(store.bundle(changed)).toBe(store.bundle(fresh));
  });
});

describe('a render drawn in ranges side by side', () => {
  test('draws the same bundle as one pass in order', async () => {
    const store = new Store();
    const full = await render(HARBOR, 1, store);
    // Every view drawn again (a new release, say), from the last render's anchors.
    const stale = Object.fromEntries(Object.entries(cacheOf(full)).map(([id, v]) => [id, { ...v, digest: '' }]));
    const one = await render(HARBOR, 1, store, stale);
    const four = await render(HARBOR, 4, store, stale);
    expect(four.ranges).toBeGreaterThan(1);
    expect(four.redrawn).toBe(0);
    expect(drawn(four).length).toBe(full.views.length);
    expect(store.bundle(four)).toBe(store.bundle(one));
    expect(store.bundle(four)).toBe(store.bundle(full));
  });

  test('a range that started from the wrong anchors is drawn again, and the bundle is still the one pass in order draws', async () => {
    const store = new Store();
    const full = await render(HARBOR, 1, store);
    const cache = cacheOf(full);
    // The anchors the last render left are off by a little everywhere, as after a change that moved boxes.
    const wrong = Object.fromEntries(Object.entries(cache).map(([id, v]) => [id, { ...v, digest: '', ...(v.anchors ? { anchors: v.anchors.map(([n, x, y]): [string, number, number] => [n, x + 7, y]) } : {}) }]));
    const four = await render(HARBOR, 4, store, wrong);
    expect(four.ranges).toBeGreaterThan(1);
    expect(four.redrawn).toBeGreaterThan(0);
    expect(store.bundle(four)).toBe(store.bundle(full));
  });

  test('an edit drawn in ranges matches a fresh render of the new text', async () => {
    const store = new Store();
    const full = await render(HARBOR, 1, store);
    const text = edit(HARBOR);
    const fresh = await render(text, 1, store);
    const four = await render(text, 4, store, cacheOf(full));
    expect(store.bundle(four)).toBe(store.bundle(fresh));
  });
});

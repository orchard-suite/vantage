import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { loadModelFromFile } from '@vantage/model';
import { buildBundle } from '@vantage/render';
import type { Bundle, BundlePicture } from './bundle.ts';
import { Reshaper } from './reshape.ts';

const harbor = join(import.meta.dir, '..', '..', '..', 'examples', 'harbor', 'harbor.vantage.yaml');

/** The engine bundle as the build makes it, so the test talks to a real worker. */
async function engineText(): Promise<string> {
  const out = await Bun.build({ entrypoints: [join(import.meta.dir, 'engine-worker.ts')], target: 'browser', format: 'iife' });
  return out.outputs[0]!.text();
}

describe('reshaping a view in the reader', async () => {
  const { model } = loadModelFromFile(harbor);
  const bundle = buildBundle(model!, { embedFonts: false }) as unknown as Bundle;
  const shaper = new Reshaper(bundle, { text: await engineText() });
  const base = bundle.views.find((v) => v.id === 'subscriptions')!;
  const kind = (p: BundlePicture | undefined, id: string): string | undefined => p?.boxes.find((b) => b.id === id)?.kind;
  const box = (p: BundlePicture, id: string) => p.boxes.find((b) => b.id === id)!;
  afterAll(() => {
    const { kit: _, ...plain } = bundle;
    shaper.setBundle(plain);
  });

  test('groups can open, leaves cannot', () => {
    expect(shaper.canOpen('rg-prod-web')).toBe(true);
    expect(shaper.canOpen(base.boxes.find((b) => b.kind === 'leaf')!.id)).toBe(false);
  });

  test('a group opens in the worker, and opening a second keeps the first', async () => {
    expect(shaper.ready(base, undefined)).toBe(base);
    shaper.toggle(base, box(base, 'rg-prod-web'));
    expect(shaper.ready(base, undefined)).toBeUndefined();
    const one = await shaper.picture(base, undefined);
    expect(kind(one, 'rg-prod-web')).toBe('container');
    shaper.toggle(base, box(base, 'rg-test-web'));
    const two = await shaper.picture(base, undefined);
    expect(kind(two, 'rg-prod-web')).toBe('container');
    expect(kind(two, 'rg-test-web')).toBe('container');
  });

  test('a zoom lays out over the changes, and coming back finds them as they were', async () => {
    const zoomed = await shaper.picture(base, 'prod-sub');
    expect(kind(zoomed, 'devtest-sub')).toBe('collapsed');
    const back = shaper.ready(base, undefined);
    expect(kind(back, 'rg-prod-web')).toBe('container');
    expect(kind(back, 'rg-test-web')).toBe('container');
  });

  test('undoing every change is the view as authored, with no layout', async () => {
    const now = (await shaper.picture(base, undefined))!;
    shaper.toggle(base, box(now, 'rg-prod-web'));
    shaper.toggle(base, box(now, 'rg-test-web'));
    expect(shaper.ready(base, undefined)).toBe(base);
  });

  test('a depth is a change like any other, and the authored depth undoes it', async () => {
    const ctx = bundle.views.find((v) => v.id === 'context')!;
    shaper.setDepth(ctx, 1);
    expect(shaper.depth(ctx)).toBe(1);
    const deeper = await shaper.picture(ctx, undefined);
    expect(deeper!.boxes.length).toBeGreaterThan(ctx.boxes.length);
    shaper.setDepth(ctx, 0);
    expect(shaper.ready(ctx, undefined)).toBe(ctx);
  });
});

describe('carrying a reader\'s changes to a follower', () => {
  const { model } = loadModelFromFile(harbor);
  const { kit: _, ...bundle } = buildBundle(model!, { embedFonts: false }) as unknown as Bundle;
  const base = bundle.views.find((v) => v.id === 'subscriptions')!;

  test('changes read as plain lists, and adopting them reports whether the picture changes', () => {
    const leader = new Reshaper(bundle, undefined);
    const follower = new Reshaper(bundle, undefined);
    expect(leader.changes(base)).toBeUndefined();
    leader.toggle(base, base.boxes.find((b) => b.kind !== 'leaf')!);
    leader.setDepth(base, 2);
    const g = leader.changes(base)!;
    expect(g.detail).toBe(2);
    expect(g.open.length + g.shut.length).toBe(1);
    expect(follower.adopt(base, g)).toBe(true);
    expect(follower.adopt(base, g)).toBe(false);
    expect(follower.changes(base)).toEqual(g);
    expect(follower.adopt(base, undefined)).toBe(true);
    expect(follower.changes(base)).toBeUndefined();
  });
});

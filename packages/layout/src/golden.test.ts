/**
 * Golden layouts. Every example view is laid out and reduced to a stable
 * signature (box rects and edge points, rounded). A layout change that
 * moves anything in an example fails here until the golden is refreshed
 * with `bun run goldens`, which makes every engine change a deliberate,
 * reviewed one.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadModelFromFile } from '@vantage/model';
import { layoutView } from './layout.ts';
import { signature, GOLDEN_SETS, goldenPath } from './golden.ts';

const root = join(import.meta.dir, '..', '..', '..');

describe('golden layouts', () => {
  for (const set of GOLDEN_SETS) {
    test(set, () => {
      const file = goldenPath(root, set);
      if (!existsSync(file)) throw new Error(`no golden for ${set}; run: bun run goldens`);
      const golden = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
      const { model } = loadModelFromFile(join(root, 'examples', set));
      expect(model).toBeDefined();
      const actual: Record<string, string> = {};
      for (const v of model!.views) actual[v.id] = signature(layoutView(model!, v));
      for (const [view, sig] of Object.entries(golden)) {
        if (actual[view] !== sig) throw new Error(`layout of ${set} view ${view} changed; look at the picture, then run: bun run goldens`);
      }
      expect(Object.keys(actual).sort()).toEqual(Object.keys(golden).sort());
    });
  }
});

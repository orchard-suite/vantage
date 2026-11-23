/**
 * Every look value has one home. A color, a radius, a shadow, or a motion
 * value lives in `packages/render/src/tokens.ts` (the chrome and the hub
 * pages) or `packages/render/src/theme.ts` (the picture); a size the layout
 * keeps lives in `packages/layout/src/style.ts`. Everywhere else names it.
 * Comments are skipped: a doc comment may quote a value it explains.
 */
import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

const HOMES = new Set(['packages/render/src/tokens.ts', 'packages/render/src/theme.ts', 'packages/layout/src/style.ts']);

/** Files that hold a foreign format's own colors, never the look's. */
const FOREIGN = new Map([
  // CSS's named colors, as hex, for reading another tool's files.
  ['packages/import/src/css-colors.ts', 'the CSS named color table an import reads'],
]);

/** Top-level numbers in the layout and the renderer that are not sizes: counts, ratios, times, and budgets. */
const NOT_SIZES = new Map([
  ['packages/layout/src/scope.ts:DEPTH_CAP', 'how many levels deep a scope opens'],
  ['packages/layout/src/loop.ts:LOOP_MIN', 'how many boxes a path goes round'],
  ['packages/layout/src/legibility.ts:DETOUR', 'a ratio of route length to distance'],
  ['packages/layout/src/timeline.ts:DAY', 'milliseconds in a day'],
  ['packages/layout/src/timeline.ts:DAILY_TICKS_MAX_DAYS', 'a span in days'],
  ['packages/layout/src/timeline.ts:WEEKLY_TICKS_MAX_DAYS', 'a span in days'],
  ['packages/layout/src/timeline.ts:ORDER_SEARCH_MAX_ITEMS', 'a count of items'],
  ['packages/layout/src/text/measure.ts:FALLBACK', 'a width ratio for a glyph the tables lack'],
  ['packages/render/src/doc-coverage.ts:PROSE_WORDS', 'a count of words'],
  ['packages/render/src/doc-coverage.ts:LISTED', 'a count of rows'],
  ['packages/render/src/doc-pages.ts:LISTED', 'a count of rows'],
  ['packages/render/src/png.ts:PNG_PIXEL_BUDGET', 'a memory budget in pixels'],
  ['packages/render/src/png.ts:PNG_MIN_SCALE', 'a ratio'],
]);

function sources(pattern: string): string[] {
  return [...new Glob(pattern).scanSync(ROOT)].filter((f) => !f.endsWith('.test.ts') && !HOMES.has(f)).sort();
}

/** The file's lines with comments blanked, so a line number still points at the source. */
function code(text: string): string[] {
  const blanked = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return blanked.split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'));
}

const COLOR = /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])|\b(?:rgba?|hsla?)\(/;
const RADIUS = /border-radius:\s*(?!0[\s;}'"`]|var\(|inherit|50%)[0-9.]+(?:px|r?em)/;
/** A shadow with a blur: a layer whose third length is not zero. A ring (`0 0 0 2px`) draws an edge and is not a shadow. */
function blurred(line: string): boolean {
  for (const m of line.matchAll(/box-shadow:([^;}'"`]*)/g)) {
    for (const layer of m[1]!.split(/,(?![^(]*\))/)) {
      const n = layer.trim().replace(/^inset\s+/, '').split(/\s+/);
      if (n.length >= 3 && n.slice(0, 3).every((x) => /^-?[0-9.]+(?:px)?$/.test(x)) && parseFloat(n[2]!) !== 0) return true;
    }
  }
  return false;
}
const SHADOW = { test: blurred };
const MOTION = /(?:transition|animation)(?:-duration|-delay)?:[^;}'"`]*?(?<![\w.-])(?!0m?s\b)[0-9]*\.?[0-9]+m?s\b|cubic-bezier\(/;

async function hits(pattern: string, re: { test(line: string): boolean }, skip: ReadonlyMap<string, string> = new Map()): Promise<string[]> {
  const out: string[] = [];
  for (const f of sources(pattern)) {
    if (skip.has(f)) continue;
    code(await Bun.file(join(ROOT, f)).text()).forEach((l, i) => {
      if (re.test(l)) out.push(`${f}:${i + 1}`);
    });
  }
  return out;
}

const CHROME = 'packages/*/src/**/*.ts';

describe('one home for every look value', () => {
  test('colors live in tokens.ts or theme.ts', async () => {
    expect(await hits(CHROME, COLOR, FOREIGN)).toEqual([]);
  });

  test('radii live in tokens.ts', async () => {
    expect(await hits(CHROME, RADIUS)).toEqual([]);
  });

  test('shadows live in tokens.ts', async () => {
    expect(await hits(CHROME, SHADOW)).toEqual([]);
  });

  test('motion lives in tokens.ts', async () => {
    expect(await hits(CHROME, MOTION)).toEqual([]);
  });

  test('layout and render sizes live in style.ts', async () => {
    const out: string[] = [];
    for (const pattern of ['packages/layout/src/**/*.ts', 'packages/render/src/**/*.ts']) {
      for (const f of sources(pattern)) {
        code(await Bun.file(join(ROOT, f)).text()).forEach((l, i) => {
          const m = /^(?:export )?const ([A-Za-z_][\w]*)\s*(?::\s*number)?\s*=\s*-?[0-9][0-9_.]*\s*;/.exec(l);
          if (m && !NOT_SIZES.has(`${f}:${m[1]}`)) out.push(`${f}:${i + 1} ${m[1]}`);
        });
      }
    }
    expect(out).toEqual([]);
  });
});

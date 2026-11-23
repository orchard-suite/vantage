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

/** The code of a file with comments and string text blanked (template expressions kept), so a column still points at the source. */
function codeOnly(text: string): string[] {
  let out = '';
  const stack: ('code' | 'tpl')[] = ['code'];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!, next = text[i + 1];
    const top = stack[stack.length - 1];
    if (top === 'tpl') {
      if (c === '\\') { out += '  '; i++; continue; }
      if (c === '`') { stack.pop(); out += c; continue; }
      if (c === '$' && next === '{') { stack.push('code'); out += '${'; i++; continue; }
      out += c === '\n' ? '\n' : ' ';
      continue;
    }
    if (c === '/' && next === '/') { while (i < text.length && text[i] !== '\n') { out += ' '; i++; } out += '\n'; continue; }
    if (c === '/' && next === '*') { const end = text.indexOf('*/', i + 2); const chunk = text.slice(i, end + 2); out += chunk.replace(/[^\n]/g, ' '); i = end + 1; continue; }
    if (c === "'" || c === '"') { let j = i + 1; while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1; out += c + ' '.repeat(j - i - 1) + c; i = j; continue; }
    if (c === '`') { stack.push('tpl'); out += c; continue; }
    if (c === '{' && stack.length > 1) depth++;
    if (c === '}' && stack.length > 1) { if (depth === 0) { stack.pop(); out += c; continue; } depth--; }
    out += c;
  }
  return out.split('\n');
}

/**
 * Numbers in the layout engine that are not sizes, by what surrounds them.
 * Each pattern sees the line with the number under test written as `#`.
 * A non-integer is never checked: a size is whole pixels, a ratio or a
 * fraction along a line is not. 0, 1, and 2 are arithmetic.
 */
const NOT_A_SIZE: readonly { readonly file?: string; readonly re: RegExp; readonly why: string }[] = [
  { re: /for \(let \w+ = 0; \w+ <=? #/, why: 'how many times a loop runs' },
  { re: /\+\+ [<>]=? #/, why: 'a guard on how many times a loop runs' },
  { re: /\.(?:length|size)\s*(?:[<>]=?|===?|!==?|[-+*])\s*#/, why: 'a count' },
  { re: /\* #\) \/ \d+|\* \d+\) \/ #/, why: 'rounding to hundredths' },
  { re: /\b[sS]core\s*(?:[-+]?=)\s*[^;]*#|[sS]core\s*[<>]=?\s*#/, why: 'a placement or quality score' },
  { re: /\.slice\(0, #\)/, why: 'how many characters or items to keep' },
  { re: /wrapText\(.*, #(?:, \d+\.\d+)?\)/, why: 'how many lines text may wrap to' },
  { re: /% #/, why: 'a cycle length' },
  { re: /\/ #/, why: 'a fraction' },
  { file: 'arrange/flow.ts', re: /ROLE_RANK|rank >= #/, why: 'the rank of a role' },
  { file: 'explore.ts', re: /limit = #|internal >= #/, why: 'how many candidates, and how many inside' },
  { file: 'labels.ts', re: /far = k >= 2 \? #/, why: 'the penalty for a far spot' },
  { file: 'relation.ts', re: /n \+= #/, why: 'how many conflicts a touch counts as' },
  { file: 'route.ts', re: /\b\w+(?:Cost|Factor|Weight): #/, why: "the router's costs and factors" },
  { file: 'route.ts', re: /cells \* #|& #|>> #|> 90000 \? #/, why: 'four directions packed into a cell index, and the search window on a huge grid' },
  { file: 'ports.ts', re: /^(?=.*(?:atan2|mod\(|v % )).*#/, why: 'angles in degrees' },
  { file: 'timeline.ts', re: /crossings \* #|tangles \* #/, why: "the row order's costs" },
  { file: 'timeline.ts', re: /^(?=.*\b(?:step|setUTCDate|getUTCDay)\b).*#/, why: 'days in a week and a month' },
  { file: 'text/measure.ts', re: /maxLines = #/, why: 'how many lines text may wrap to' },
];

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

  test('the layout engine writes no size inline', async () => {
    const out: string[] = [];
    for (const f of sources('packages/layout/src/**/*.ts')) {
      const rel = f.replace('packages/layout/src/', '');
      codeOnly(await Bun.file(join(ROOT, f)).text()).forEach((l, i) => {
        const declared = /^(?:export )?const ([A-Za-z_]\w*)\s*(?::\s*number)?\s*=\s*-?[0-9][0-9_.]*\s*;/.exec(l);
        if (declared && NOT_SIZES.has(`${f}:${declared[1]}`)) return;
        for (const m of l.matchAll(/(?<![\w.$])\d+(?![\w.])/g)) {
          if (['0', '1', '2'].includes(m[0])) continue;
          const marked = `${l.slice(0, m.index)}#${l.slice(m.index! + m[0].length)}`;
          if (NOT_A_SIZE.some((a) => (!a.file || a.file === rel) && a.re.test(marked))) continue;
          out.push(`${f}:${i + 1} ${m[0]}`);
        }
      });
    }
    expect(out).toEqual([]);
  });
});

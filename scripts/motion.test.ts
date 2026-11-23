/**
 * Nothing on a page repaints forever. An animation runs a set number of
 * times and stops: an endless one keeps the reader's machine drawing for as
 * long as the tab is open. This walks every stylesheet the hub, the viewer,
 * and the kit send, as the TypeScript strings and files they live in.
 */
import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const SOURCES = ['packages/*/src/**/*.ts', 'packages/*/src/**/*.css', 'packages/*/src/**/*.html'];

function sources(): string[] {
  return SOURCES.flatMap((p) => [...new Glob(p).scanSync(ROOT)]).filter((f) => !f.endsWith('.test.ts'));
}

describe('motion', () => {
  test('no animation repeats forever', async () => {
    const found: string[] = [];
    for (const f of sources()) {
      const lines = (await Bun.file(join(ROOT, f)).text()).split('\n');
      lines.forEach((l, i) => {
        if (/\binfinite\b/.test(l) && /animation/.test(l)) found.push(`${f}:${i + 1}`);
      });
    }
    expect(found).toEqual([]);
  });
});

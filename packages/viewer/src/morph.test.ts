import { describe, expect, test } from 'bun:test';
import { uniqueBoxes } from './morph.ts';

describe('uniqueBoxes', () => {
  test('a box drawn once keeps its place', () => {
    const m = uniqueBoxes([{ id: 'a', x: 1 }, { id: 'b', x: 2 }]);
    expect(m.get('a')?.x).toBe(1);
    expect(m.get('b')?.x).toBe(2);
  });

  test('a box a page draws in several panels has no single place to slide to', () => {
    const m = uniqueBoxes([{ id: 'orrery', x: 10 }, { id: 'trellis', x: 20 }, { id: 'orrery', x: 900 }]);
    expect(m.has('orrery')).toBe(false);
    expect(m.get('trellis')?.x).toBe(20);
  });
});

import { describe, expect, test } from 'bun:test';
import { squarify } from './treemap.ts';

describe('squarify', () => {
  test('fills the frame, areas follow values, and nothing overlaps', () => {
    const values = [600, 300, 120, 80, 40, 10, 0];
    const tiles = squarify(values, (v) => v, 160, 70);
    expect(tiles.map((t) => t.item)).toEqual([600, 300, 120, 80, 40, 10]);
    const area = tiles.reduce((s, t) => s + t.w * t.h, 0);
    expect(area).toBeCloseTo(100 * 100, 3);
    for (const t of tiles) expect((t.w * t.h) / 10000).toBeCloseTo(t.item / 1150, 5);
    for (const a of tiles)
      for (const b of tiles) {
        if (a === b) continue;
        const apart = a.x + a.w <= b.x + 1e-9 || b.x + b.w <= a.x + 1e-9 || a.y + a.h <= b.y + 1e-9 || b.y + b.h <= a.y + 1e-9;
        expect(apart).toBe(true);
      }
  });

  test('keeps tiles near square in real units', () => {
    const tiles = squarify([5, 5, 5, 5], (v) => v, 100, 100);
    for (const t of tiles) expect(t.w / t.h).toBeCloseTo(1, 5);
  });

  test('an empty or zero list gives no tiles', () => {
    expect(squarify([], (v: number) => v, 10, 10)).toEqual([]);
    expect(squarify([0, 0], (v) => v, 10, 10)).toEqual([]);
  });
});

import { describe, expect, test } from 'bun:test';
import { arrangeGrid } from './grid.ts';
import { gutterWidth, type GutterEdge } from './gutter.ts';
import { DEFAULT_STYLE } from '../style.ts';

const box = (id: string) => ({ id, size: { w: 120, h: 40 } });
const line = (from: string, to: string, w = 0): GutterEdge => ({ from, to, label: { w, h: w ? 14 : 0 } });

describe('gutters hold the lines that cross them', () => {
  test('a gutter with no lines keeps the gap asked for', () => {
    const g = arrangeGrid([box('a'), box('b')], { mode: 'row', gap: 80, aspect: 1, traffic: { edges: [], style: DEFAULT_STYLE } });
    expect(g.placed[1]!.rect.x).toBe(200);
  });

  test('six labelled lines across one gutter widen it to a lane apiece beside the widest label', () => {
    const edges = ['a', 'b', 'c', 'd', 'e', 'f'].map(() => line('left', 'right', 110));
    const g = arrangeGrid([box('left'), box('right')], { mode: 'row', gap: 80, aspect: 1, traffic: { edges, style: DEFAULT_STYLE } });
    const gutter = g.placed[1]!.rect.x - 120;
    expect(gutter).toBe(gutterWidth(edges, 'x', DEFAULT_STYLE));
    expect(gutter).toBeGreaterThanOrEqual(110 + 5 * DEFAULT_STYLE.laneGap + 2 * DEFAULT_STYLE.edgeMargin);
  });

  test('a line widens every gutter it spans and no other', () => {
    const edges = [line('a', 'c', 60)];
    const g = arrangeGrid([box('a'), box('b'), box('c'), box('d')], { mode: 'row', gap: 20, aspect: 1, traffic: { edges, style: DEFAULT_STYLE } });
    const xs = g.placed.map((p) => p.rect.x);
    const w = gutterWidth(edges, 'x', DEFAULT_STYLE);
    expect(xs[1]! - 120).toBe(w);
    expect(xs[2]! - xs[1]! - 120).toBe(w);
    expect(xs[3]! - xs[2]! - 120).toBe(20);
  });

  test('a gap between rows makes room for label height, not width', () => {
    const edges = [line('top', 'bottom', 150)];
    expect(gutterWidth(edges, 'y', DEFAULT_STYLE)).toBeLessThan(gutterWidth(edges, 'x', DEFAULT_STYLE));
  });
});

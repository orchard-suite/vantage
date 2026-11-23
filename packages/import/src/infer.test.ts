import { describe, expect, test } from 'bun:test';
import { inferArrangements, type InferNode } from './infer.ts';

const leaf = (id: string, x: number, y: number, w = 100, h = 50): InferNode => ({ id, rect: { x, y, w, h }, children: [] });
const canvas = { x: 0, y: 0, w: 1000, h: 1000 };

describe('gesture inference', () => {
  test('a row, a column, and a grid', () => {
    const row: InferNode = { id: 'r', rect: { x: 0, y: 0, w: 500, h: 100 }, children: [leaf('a', 10, 25), leaf('b', 150, 27), leaf('c', 290, 23)] };
    const col: InferNode = { id: 'c', rect: { x: 600, y: 0, w: 150, h: 400 }, children: [leaf('d', 620, 20), leaf('e', 622, 120), leaf('f', 618, 220)] };
    const grid: InferNode = { id: 'g', rect: { x: 0, y: 500, w: 400, h: 300 }, children: [leaf('p', 10, 520), leaf('q', 150, 520), leaf('r2', 10, 620), leaf('s', 150, 620)] };
    const out = inferArrangements([row, col, grid], canvas, []);
    expect(out.arrange).toEqual([{ node: 'r', as: 'row' }, { node: 'c', as: 'column' }, { node: 'g', as: 'grid', columns: 2 }]);
    expect(out.notes).toHaveLength(3);
  });

  test('scattered children get no hint', () => {
    const node: InferNode = { id: 'n', rect: { x: 0, y: 0, w: 500, h: 500 }, children: [leaf('a', 10, 10), leaf('b', 200, 90), leaf('c', 60, 300)] };
    expect(inferArrangements([node], canvas, []).arrange).toEqual([]);
  });

  test('a hub among its spokes is a ring', () => {
    const kids = [leaf('hub', 200, 200), leaf('n', 200, 20), leaf('e', 400, 200), leaf('s', 200, 380), leaf('w', 0, 200)];
    const node: InferNode = { id: 'net', rect: { x: -20, y: -20, w: 560, h: 480 }, children: kids };
    const rels = [{ from: 'hub', to: 'n' }, { from: 'hub', to: 'e' }, { from: 's', to: 'hub' }, { from: 'w', to: 'hub' }];
    expect(inferArrangements([node], canvas, rels).arrange).toEqual([{ node: 'net', as: 'ring', center: 'hub' }]);
  });

  test('two halves with mirrored children are a mirror', () => {
    const left: InferNode = { id: 'l', rect: { x: 0, y: 0, w: 300, h: 300 }, children: [leaf('l1', 20, 40), leaf('l2', 20, 200)] };
    const right: InferNode = { id: 'r', rect: { x: 400, y: 0, w: 300, h: 300 }, children: [leaf('r1', 580, 40), leaf('r2', 580, 200)] };
    const out = inferArrangements([{ id: 'root2', rect: { x: 0, y: 0, w: 700, h: 300 }, children: [left, right] }], canvas, []);
    expect(out.arrange[0]).toEqual({ node: 'root2', as: 'mirror', order: ['l', 'r'] });
  });
});

import { describe, expect, test } from 'bun:test';
import { firstView, hasOverview, pickerOrder, pickerTree, withPicture, type Bundle, type BundleView } from './bundle.ts';

const view = (id: string, group?: string, hidden = false): BundleView => ({
  id,
  title: id,
  kind: 'relation',
  ...(group !== undefined ? { group } : {}),
  ...(hidden ? { hidden } : {}),
  svg: `<svg data-view="${id}"></svg>`,
  width: 10,
  height: 10,
  boxes: [{ id: 'a', name: 'A', kind: 'leaf', x: 0, y: 0, w: 1, h: 1 }],
  edges: [],
  metrics: { score: 100, crossings: 0, notes: [] },
});

describe('bundle helpers', () => {
  test('a document has an overview when it has a description or more than one view to pick', () => {
    const doc = (views: BundleView[], description?: string): Bundle => ({ title: 'T', theme: 'light', views, diagnostics: [], ...(description ? { description } : {}) });
    expect(hasOverview(doc([view('a')]))).toBe(false);
    expect(hasOverview(doc([view('a'), view('b', undefined, true)]))).toBe(false);
    expect(hasOverview(doc([view('a')], 'About it'))).toBe(true);
    expect(hasOverview(doc([view('a'), view('b')]))).toBe(true);
    expect(hasOverview(doc([], 'Still drawing'))).toBe(false);
  });

  test('picker order groups by first appearance and keeps document order inside a group', () => {
    const order = pickerOrder([view('a', 'One'), view('b', 'Two'), view('c', 'One'), view('d')]).map((v) => v.id);
    expect(order).toEqual(['a', 'c', 'b', 'd']);
  });

  test('parts stay out of the picker and the first view until asked for', () => {
    const views = [view('base', 'Parts', true), view('ctx', 'Overview'), view('more', 'Overview', true)];
    expect(pickerOrder(views).map((v) => v.id)).toEqual(['ctx']);
    expect(pickerOrder(views, true).map((v) => v.id)).toEqual(['base', 'ctx', 'more']);
    expect(firstView(views)?.id).toBe('ctx');
  });

  test('a group path nests folds and keeps document order inside each', () => {
    const tree = pickerTree([view('a', 'Workloads / Identity'), view('b', 'Workloads'), view('c', 'Workloads / Identity'), view('d'), view('e', 'Workloads / Billing')]);
    expect(tree.map((g) => g.name)).toEqual(['Workloads', 'Views']);
    const w = tree[0]!;
    expect(w.views.map((v) => v.id)).toEqual(['b']);
    expect(w.groups.map((g) => [g.name, g.path])).toEqual([['Identity', 'Workloads / Identity'], ['Billing', 'Workloads / Billing']]);
    expect(w.groups[0]!.views.map((v) => v.id)).toEqual(['a', 'c']);
  });

  test('withPicture swaps the picture and keeps the view identity', () => {
    const base = view('base');
    const next = withPicture(base, { svg: '<svg/>', width: 99, height: 98, boxes: [], edges: [] });
    expect(next.id).toBe('base');
    expect(next.width).toBe(99);
    expect(next.boxes).toEqual([]);
    expect(base.width).toBe(10);
  });
});

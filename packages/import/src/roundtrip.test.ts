import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { renderDrawio, renderVsdx } from '@vantage/export';
import { FileIconSource } from '@vantage/render';
import { layoutView, type Layout } from '@vantage/layout';
import { loadModelFromFile, loadModelFromText, type NodeInput } from '@vantage/model';
import { importDiagram, matchIconId } from './index.ts';
import { expectPinsHonoured } from './pins.test-helper.ts';

const harbor = join(import.meta.dir, '..', '..', '..', 'examples', 'harbor', 'harbor.vantage.yaml');

function flatten(nodes: readonly NodeInput[]): NodeInput[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
}

describe('round trip through our own draw.io export', () => {
  const { model } = loadModelFromFile(harbor);
  const relationViews = model!.views.filter((v) => v.kind === 'relation');
  const layouts: Layout[] = relationViews.map((v) => layoutView(model!, v));
  const xml = renderDrawio(layouts);
  const r = importDiagram(new TextEncoder().encode(xml), { filename: 'harbor.drawio' });

  test('every relation view comes back as a page with its boxes and labels', () => {
    expect(r.report.pages.map((p) => p.name)).toEqual(layouts.map((l) => l.title));
    const names = new Set(flatten(r.document.nodes).map((n) => n.name));
    for (const l of layouts) for (const b of l.boxes) expect(names.has(b.name.lines.join(' '))).toBe(true);
    const labels = new Set(r.document.relations!.map((x) => x.label).filter((x): x is string => x !== undefined));
    for (const l of layouts) for (const e of l.edges) if (e.label) expect(labels.has(e.label.lines.join(' '))).toBe(true);
    // Boxes drawn on several pages are one node.
    expect(r.report.counts.merged).toBeGreaterThan(10);
    expect(r.report.warnings).toEqual([]);
  });

  test('pins equal the exported geometry and the pinned layout honours them', () => {
    const loaded = loadModelFromText(r.yaml);
    expect(loaded.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    type R = { x: number; y: number; w: number; h: number };
    // The export writes child geometry relative to its parent at two decimals, so sums may drift by 0.01.
    const same = (a: R, b: R): boolean => Math.abs(a.x - b.x) < 0.02 && Math.abs(a.y - b.y) < 0.02 && Math.abs(a.w - b.w) < 0.02 && Math.abs(a.h - b.h) < 0.02;
    layouts.forEach((l, i) => {
      const view = r.document.views[i]!;
      if (view.kind !== 'relation') throw new Error('expected a relation view');
      // Every exported box is pinned where it was; notes and captions drawn beside the boxes add pins of their own.
      const pins = Object.values(view.pins!.nodes ?? {});
      for (const b of l.boxes) expect(pins.some((p) => same(p, b))).toBe(true);
      expectPinsHonoured(loaded.model!, view.id);
    });
  });
});

describe('icons survive our own exports', () => {
  const { model } = loadModelFromFile(harbor);
  const layouts: Layout[] = model!.views.filter((v) => v.kind === 'relation').map((v) => layoutView(model!, v));
  const icons = new FileIconSource();
  const ids = icons.list();
  const iconByName = new Map([...model!.nodes.values()].filter((n) => n.icon !== undefined).map((n) => [n.name, n.icon!]));

  test('draw.io: every icon comes back as the same id', () => {
    const r = importDiagram(new TextEncoder().encode(renderDrawio(layouts, { icons })), { filename: 'harbor.drawio', iconResolver: (h) => matchIconId(h, ids) });
    const back = flatten(r.document.nodes).filter((n) => iconByName.has(n.name));
    expect(back.length).toBeGreaterThan(5);
    for (const n of back) expect(n.icon).toBe(iconByName.get(n.name));
    expect(r.report.pictures.missed).toEqual([]);
    expect(Object.keys(r.assets)).toEqual([]);
  });

  test('vsdx: icons come back as pictures beside the document, each written once', () => {
    const r = importDiagram(renderVsdx(layouts, { icons }), { filename: 'harbor.vsdx' });
    const back = flatten(r.document.nodes).filter((n) => iconByName.has(n.name));
    expect(back.length).toBeGreaterThan(5);
    for (const n of back) expect(r.document.icons?.[n.icon ?? '']).toMatch(/^assets\/.+\.png$/);
    const distinct = new Set([...iconByName.values()]);
    expect(Object.keys(r.assets).length).toBeLessThanOrEqual(distinct.size * 6);
    expect(r.report.warnings).toEqual([]);
    expect(r.report.pictures.missed).toEqual([]);
    const loaded = loadModelFromText(r.yaml);
    expect(loaded.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

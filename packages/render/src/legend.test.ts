import { describe, expect, test } from 'bun:test';
import { loadModelFromText } from '@vantage/model';
import { layoutView } from '@vantage/layout';
import { renderSvg } from './render-svg.ts';

// A tall, narrow view: one column of boxes joined by three kinds of arrow, so the engine adds a legend of three rows.
const narrow = `
nodes:
  - { name: Web, type: web }
  - { name: API, type: api }
  - { name: Bus, type: queue }
  - { name: Identity, type: identity }
relations:
  - { from: web, to: api, label: calls, kind: sync, tags: [x] }
  - { from: api, to: bus, label: publishes, kind: async, tags: [x] }
  - { from: bus, to: identity, label: signs in, kind: auth, tags: [x] }
views:
  - { id: column, title: Column, direction: down, include: { tags: [x] } }
`;

describe('legend in a narrow view', () => {
  const { model } = loadModelFromText(narrow);
  const layout = layoutView(model!, model!.views[0]!);
  const legend = layout.extras!.find((e) => e.kind === 'legend');

  test('the layout wraps the items into as many columns as fit the view', () => {
    if (legend?.kind !== 'legend') throw new Error('no legend');
    expect(layout.width).toBeLessThan(360);
    expect(legend.items.map((i) => i.label)).toEqual(['Synchronous call', 'Asynchronous message', 'Authenticates with']);
    expect(legend.cols).toBe(1);
    expect(legend.rect.x + legend.rect.w).toBeLessThanOrEqual(layout.width);
  });

  test('the picture draws each item on its own row inside the legend box, none on top of another', () => {
    if (legend?.kind !== 'legend') throw new Error('no legend');
    const svg = renderSvg(layout);
    const group = /<g class="v-legend"[^]*?<\/g>/.exec(svg)![0];
    const rows = [...group.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]+)<\/text>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), label: m[3] }));
    expect(rows.map((r) => r.label)).toEqual(['Synchronous call', 'Asynchronous message', 'Authenticates with']);
    expect(new Set(rows.map((r) => r.x)).size).toBe(1);
    expect(new Set(rows.map((r) => r.y)).size).toBe(3);
    for (const r of rows) expect(r.y).toBeLessThan(legend.rect.y + legend.rect.h);
  });
});

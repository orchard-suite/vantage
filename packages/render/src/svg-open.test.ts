import { describe, expect, test } from 'bun:test';
import { loadModelFromText, type NodeOpenItem } from '@vantage/model';
import { layoutView } from '@vantage/layout';
import { renderSvg } from './render-svg.ts';
import { buildBundle } from './bundle.ts';

const item = (severity: NodeOpenItem['severity'], stale = false): NodeOpenItem => ({ kind: 'issue', title: `a ${severity}`, ...(severity ? { severity } : {}), source: 'jira', observed: '2026-11-01T00:00:00Z', ...(stale ? { stale: true } : {}) });

function model(opt: boolean) {
  const text = `title: T
nodes:
  - { id: a, name: A, type: api }
  - { id: b, name: B, type: database }
relations:
  - { from: a, to: b, label: writes, tags: [x] }
views:
  - { id: v, title: V, include: { tags: [x] }${opt ? ', openItems: true' : ''} }
`;
  const m = loadModelFromText(text, 'inline.vantage.yaml', (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === 'a' ? { ...n, openItems: [item('low'), item('critical')] } : { ...n, openItems: [item('medium', true)] })) })).model!;
  return { m, layout: layoutView(m, m.views[0]!) };
}

describe('open item badges', () => {
  test('a static picture draws none unless the view opts in; the badge counts and takes the worst color', () => {
    const off = model(false);
    expect(renderSvg(off.layout)).not.toContain('class="v-open');
    const on = model(true);
    const svg = renderSvg(on.layout);
    expect(svg).toContain('class="v-open" data-open="2" data-severity="critical"');
    expect(svg).toContain('#c62828');
    expect(svg).toContain('class="v-open v-open-stale" data-open="1" data-severity="medium"');
    expect(renderSvg(off.layout, { openItems: true })).toContain('data-open="2"');
  });

  test('the viewer bundle always draws them and carries the items on the box and the opt-in on the view', () => {
    const off = model(false);
    const bundle = buildBundle(off.m) as { views: { svg: string; openItems?: boolean; boxes: { id: string; openItems?: NodeOpenItem[] }[] }[] };
    expect(bundle.views[0]!.svg).toContain('data-open="2"');
    expect(bundle.views[0]!.openItems).toBeUndefined();
    expect(bundle.views[0]!.boxes.find((b) => b.id === 'a')?.openItems?.map((i) => i.severity)).toEqual(['low', 'critical']);
    expect((buildBundle(model(true).m) as { views: { openItems?: boolean }[] }).views[0]!.openItems).toBe(true);
  });

  test('the badge moves nothing', () => {
    const a = model(false).layout;
    const b = model(true).layout;
    expect(b.boxes.map((x) => [x.x, x.y, x.w, x.h])).toEqual(a.boxes.map((x) => [x.x, x.y, x.w, x.h]));
  });
});

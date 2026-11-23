import { describe, expect, test } from 'bun:test';
import { loadModelFromText } from '@vantage/model';
import { layoutView } from './layout.ts';
import { straighten } from './straighten.ts';
import { separate, PART } from './separate.ts';
import { assignPorts } from './ports.ts';
import { onFrame, rectToLine } from './legibility.ts';

function layoutOf(text: string, viewId: string) {
  const { model, diagnostics } = loadModelFromText(text);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return layoutView(model!, model!.views.find((v) => v.id === viewId)!);
}

describe('legibility checks', () => {
  test('a label is near its line when a segment runs along its side', () => {
    expect(rectToLine({ x: 0, y: 0, w: 40, h: 10 }, [{ x: -20, y: 14 }, { x: 80, y: 14 }])).toBe(4);
  });

  test('a rect lies on a frame only when it straddles a frame line', () => {
    const c = { x: 0, y: 0, w: 200, h: 100 };
    expect(onFrame({ x: 190, y: 40, w: 30, h: 10 }, c)).toBe(true);
    expect(onFrame({ x: 50, y: 40, w: 30, h: 10 }, c)).toBe(false);
    expect(onFrame({ x: 220, y: 40, w: 30, h: 10 }, c)).toBe(false);
  });
});

describe('straighten', () => {
  test('a short jog between two parallel runs is slid away', () => {
    const from = { x: 0, y: 0, w: 100, h: 60 }, to = { x: 300, y: 100, w: 100, h: 60 };
    const kinked = [{ x: 50, y: 60 }, { x: 50, y: 80 }, { x: 56, y: 80 }, { x: 56, y: 100 }];
    const out = straighten([{ id: 'e', points: kinked, from, to: { ...to, x: 6, y: 100 }, transparent: new Set() }], []).get('e')!;
    expect(out.every((p) => p.x === out[0]!.x)).toBe(true);
  });

  test('a jog is kept when sliding the run would cross a box', () => {
    const from = { x: 0, y: 0, w: 100, h: 60 }, to = { x: 6, y: 100, w: 100, h: 60 };
    const kinked = [{ x: 50, y: 60 }, { x: 50, y: 80 }, { x: 56, y: 80 }, { x: 56, y: 100 }];
    const walls = [{ id: 'w1', x: 53, y: 62, w: 6, h: 16 }, { id: 'w2', x: 47, y: 82, w: 6, h: 16 }];
    const out = straighten([{ id: 'e', points: kinked, from, to, transparent: new Set() }], walls).get('e')!;
    expect(out.length).toBe(4);
  });
});

describe('separate', () => {
  test('a run on the same line as another edge is slid a lane aside, and the runs either side stretch to meet it', () => {
    const routes = new Map([
      ['a', [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }]],
      ['b', [{ x: 400, y: 0 }, { x: 400, y: 100 }, { x: 260, y: 100 }, { x: 260, y: 200 }]],
    ]);
    separate(routes, new Map(), []);
    const ys = [...routes.values()].map((pts) => pts[1]!.y);
    expect(ys).toContain(100);
    expect(ys.some((y) => Math.abs(y - 100) === PART)).toBe(true);
  });

  test('a slide that would cross a box is not made', () => {
    const routes = new Map([
      ['a', [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }]],
      ['b', [{ x: 400, y: 0 }, { x: 400, y: 100 }, { x: 260, y: 100 }, { x: 260, y: 200 }]],
    ]);
    // Boxes just above and below the shared line, clear of every upright, so only the slide itself would cross them.
    const walls = [{ id: 'up', x: 50, y: 72, w: 100, h: 14 }, { id: 'down', x: 50, y: 114, w: 100, h: 14 }, { id: 'up2', x: 300, y: 72, w: 80, h: 14 }, { id: 'down2', x: 300, y: 114, w: 80, h: 14 }];
    separate(routes, new Map(), walls);
    expect([...routes.values()].every((pts) => pts[1]!.y === 100)).toBe(true);
  });
});

describe('straight ports', () => {
  const box = (x: number, y: number) => ({ x, y, w: 100, h: 60 });
  test('two boxes that face each other with room are joined at one height, even beside another port', () => {
    const ports = assignPorts([
      { edgeId: 'a', from: box(0, 0), to: box(300, 10), fromId: 'a', toId: 't' },
      { edgeId: 'b', from: box(0, 200), to: box(300, 10), fromId: 'b', toId: 't' },
    ], 'right');
    expect(ports.get('a')!.fromPoint.y).toBe(ports.get('a')!.toPoint.y);
    expect(Math.abs(ports.get('a')!.toPoint.y - ports.get('b')!.toPoint.y)).toBeGreaterThanOrEqual(16);
  });
});

const doc = (body: string): string => `vantage: 1
title: t
nodes:
  - { id: a, name: A }
  - { id: b, name: B }
  - { id: c, name: C }
  - { id: d, name: D }
  - { id: hub, name: Hub, type: group, children: [{ id: h1, name: H1 }, { id: h2, name: H2 }] }
relations:
  - { from: a, to: h1, label: records in, tags: [t] }
  - { from: b, to: h1, label: records in, tags: [t] }
  - { from: c, to: h1, label: records in, tags: [t] }
  - { from: h1, to: d, tags: [t] }
  - { from: d, to: h2, tags: [t] }
  - { from: h2, to: c, tags: [t] }
  - { from: c, to: a, tags: [t] }
${body}`;

describe('engine-owned readability', () => {
  test('a story path that goes round through four top-level boxes is laid out as a loop around the box it passes most', () => {
    const l = layoutOf(doc(`views:
  - id: v
    title: V
    include: { tags: [t] }
    paths:
      - steps:
          - { from: a, to: h1 }
          - { from: h1, to: d }
          - { from: d, to: h2 }
          - { from: h2, to: c }
          - { from: c, to: a }`), 'v');
    const hub = l.boxes.find((b) => b.id === 'hub')!;
    const cx = hub.x + hub.w / 2, cy = hub.y + hub.h / 2;
    for (const id of ['a', 'd', 'c']) {
      const b = l.boxes.find((x) => x.id === id)!;
      const inside = b.x + b.w > hub.x && b.x < hub.x + hub.w && b.y + b.h > hub.y && b.y < hub.y + hub.h;
      expect(inside).toBe(false);
    }
    const sides = new Set(['a', 'd', 'c'].map((id) => { const b = l.boxes.find((x) => x.id === id)!; return `${Math.sign(Math.round(b.x + b.w / 2 - cx))},${Math.sign(Math.round(b.y + b.h / 2 - cy))}`; }));
    expect(sides.size).toBe(3);
  });

  test('a long fact widens its box instead of ending in an ellipsis', () => {
    const l = layoutOf(`vantage: 1
title: t
nodes:
  - id: a
    name: A
    facts: ["Writes: sec_finding, plat_finding, plat_verdict, plat_pack, linked to their pillar and their owner and their deadline"]
views:
  - { id: v, title: V, include: { nodes: [a] } }`, 'v');
    expect(l.metrics.legibility.truncated).toBe(0);
  });

  test('a view that mixes line styles gets a legend of them unless the author turns it off', () => {
    const text = (legend: string) => `vantage: 1
title: t
nodes: [{ id: a, name: A }, { id: b, name: B }, { id: c, name: C }]
relations:
  - { from: a, to: b, tags: [t] }
  - { from: b, to: c, kind: async, tags: [t] }
views:
  - { id: v, title: V, include: { tags: [t] }${legend} }`;
    expect(layoutOf(text(''), 'v').extras?.some((x) => x.kind === 'legend')).toBe(true);
    expect(layoutOf(text(', legend: false'), 'v').extras?.some((x) => x.kind === 'legend')).toBe(false);
  });
});

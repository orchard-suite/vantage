import { describe, expect, test } from 'bun:test';
import { loadModelFromFile, loadModelFromText } from '@vantage/model';
import { layoutView } from './layout.ts';
import { arrangeFlow } from './arrange/flow.ts';
import { DEFAULT_ROUTER, OrthogonalRouter } from './route.ts';
import { textWidth, wrapText } from './text/measure.ts';
import { join } from 'node:path';

const shop = join(import.meta.dir, '..', '..', '..', 'examples', 'shop', 'shop.vantage.yaml');

function layoutOf(text: string, viewId: string) {
  const { model, diagnostics } = loadModelFromText(text);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const view = model!.views.find((v) => v.id === viewId)!;
  return layoutView(model!, view);
}

describe('flow arrangement', () => {
  test('layers sources before sinks and breaks cycles by reversing one edge', () => {
    const items = ['a', 'b', 'c'].map((id, i) => ({ id, role: 'compute' as const, order: i, externalIn: 0, externalOut: 0 }));
    const r = arrangeFlow(items, [
      { from: 'a', to: 'b', weight: 1 },
      { from: 'b', to: 'c', weight: 1 },
      { from: 'c', to: 'a', weight: 1 },
    ]);
    expect(r.layers).toEqual([['a'], ['b'], ['c']]);
    expect([...r.reversed]).toEqual(['c>a']);
  });

  test('an edge that skips a layer counts when ordering, so its end moves out of the way', () => {
    const items = ['b', 'a', 'm', 'e', 'f'].map((id, i) => ({ id, role: 'compute' as const, order: i, externalIn: 0, externalOut: 0 }));
    const r = arrangeFlow(items, [
      { from: 'a', to: 'm', weight: 1 },
      { from: 'm', to: 'e', weight: 1 },
      { from: 'm', to: 'f', weight: 1 },
      { from: 'b', to: 'f', weight: 1 },
    ]);
    expect(r.layers[2]).toEqual(['f', 'e']);
  });

  test('keeps author order as the tiebreaker inside a layer', () => {
    const items = ['hub', 'z', 'y', 'x'].map((id, i) => ({ id, role: 'compute' as const, order: i, externalIn: 0, externalOut: 0 }));
    const r = arrangeFlow(items, ['z', 'y', 'x'].map((to) => ({ from: 'hub', to, weight: 1 })));
    expect(r.layers).toEqual([['hub'], ['z', 'y', 'x']]);
  });

  test('entry points lead and exits trail even without internal edges', () => {
    const items = [
      { id: 'db', role: 'data' as const, order: 0, externalIn: 1, externalOut: 0 },
      { id: 'api', role: 'compute' as const, order: 1, externalIn: 1, externalOut: 1 },
      { id: 'edge', role: 'edge' as const, order: 2, externalIn: 1, externalOut: 0 },
    ];
    const r = arrangeFlow(items, [{ from: 'edge', to: 'api', weight: 1 }]);
    expect(r.layer.get('edge')).toBe(0);
    expect(r.layer.get('api')).toBe(1);
  });
});

describe('text', () => {
  test('measures with Inter metrics and wraps', () => {
    expect(textWidth('Orders API', 13, 'semibold')).toBeGreaterThan(60);
    const w = wrapText('A very long name that needs wrapping', 13, 'semibold', 120, 2);
    expect(w.lines.length).toBe(2);
    expect(w.lines[1]!.endsWith('…')).toBe(true);
  });
});

describe('router', () => {
  test('goes around a hard obstacle instead of through it', () => {
    const router = new OrthogonalRouter(
      [
        { id: 'a', x: 0, y: 0, w: 50, h: 30, hard: true },
        { id: 'block', x: 100, y: -10, w: 50, h: 50, hard: true },
        { id: 'b', x: 200, y: 0, w: 50, h: 30, hard: true },
      ],
      [{ x: 50, y: 15 }, { x: 200, y: 15 }],
    );
    const pts = router.route({ id: 'e', from: { x: 50, y: 15 }, to: { x: 200, y: 15 }, fromSide: 'right', toSide: 'left', transparent: new Set(['a', 'b']) });
    expect(pts[0]).toEqual({ x: 50, y: 15 });
    expect(pts[pts.length - 1]).toEqual({ x: 200, y: 15 });
    const throughBlock = pts.some((p, i) => i > 0 && p.y === 15 && pts[i - 1]!.y === 15 && Math.min(p.x, pts[i - 1]!.x) < 150 && Math.max(p.x, pts[i - 1]!.x) > 100);
    expect(throughBlock).toBe(false);
  });

  test('leaves a port straight for a margin before turning back along its own box', () => {
    // b sits below and left of a's right port, so the cheapest turn is down along a's border.
    const router = new OrthogonalRouter(
      [
        { id: 'a', x: 0, y: 0, w: 100, h: 60, hard: true },
        { id: 'b', x: 30, y: 300, w: 80, h: 40, hard: true },
      ],
      [{ x: 100, y: 30 }, { x: 70, y: 300 }],
    );
    const pts = router.route({ id: 'e', from: { x: 100, y: 30 }, to: { x: 70, y: 300 }, fromSide: 'right', toSide: 'top', transparent: new Set(['a', 'b']) });
    expect(pts[1]!.y).toBe(30);
    expect(pts[1]!.x - pts[0]!.x).toBeGreaterThanOrEqual(DEFAULT_ROUTER.stub);
  });

  test('steps off a box border instead of running along it', () => {
    const route = (borderFactor: number) =>
      new OrthogonalRouter(
        [
          { id: 'a', x: 0, y: 0, w: 40, h: 40, hard: true },
          { id: 'c', x: 20, y: 100, w: 180, h: 200, hard: false },
          { id: 'b', x: 0, y: 400, w: 40, h: 40, hard: true },
        ],
        [{ x: 20, y: 40 }, { x: 20, y: 400 }],
        { ...DEFAULT_ROUTER, borderFactor },
      ).route({ id: 'e', from: { x: 20, y: 40 }, to: { x: 20, y: 400 }, fromSide: 'bottom', toSide: 'top', transparent: new Set(['a', 'b']) });
    // Length run on c's left border, x=20 between y=100 and y=300.
    const onBorder = (pts: { x: number; y: number }[]) =>
      pts.reduce((n, p, i) => (i > 0 && p.x === 20 && pts[i - 1]!.x === 20 ? n + Math.max(0, Math.min(300, Math.max(p.y, pts[i - 1]!.y)) - Math.max(100, Math.min(p.y, pts[i - 1]!.y))) : n), 0);
    expect(onBorder(route(0))).toBe(200);
    expect(onBorder(route(DEFAULT_ROUTER.borderFactor))).toBe(0);
  });

  test('a second line keeps a lane away from the first instead of running beside it', () => {
    const lines = (crowdFactor: number) => {
      const router = new OrthogonalRouter(
        [
          { id: 'a', x: 0, y: 0, w: 200, h: 40, hard: true },
          { id: 'b', x: 0, y: 400, w: 200, h: 40, hard: true },
          { id: 'c', x: 300, y: 0, w: 40, h: 40, hard: true },
        ],
        [{ x: 100, y: 40 }, { x: 100, y: 400 }, { x: 320, y: 40 }, { x: 104, y: 400 }],
        { ...DEFAULT_ROUTER, crowdFactor, heuristicWeight: 1 },
      );
      router.route({ id: 'first', from: { x: 100, y: 40 }, to: { x: 100, y: 400 }, fromSide: 'bottom', toSide: 'top', transparent: new Set(['a', 'b']) });
      return router.route({ id: 'second', from: { x: 320, y: 40 }, to: { x: 104, y: 400 }, fromSide: 'bottom', toSide: 'top', transparent: new Set(['c', 'b']) });
    };
    // Length run at x=104, within a lane of the first line at x=100.
    const beside = (pts: { x: number; y: number }[]) => pts.reduce((n, p, i) => (i > 0 && p.x === 104 && pts[i - 1]!.x === 104 ? n + Math.abs(p.y - pts[i - 1]!.y) : n), 0);
    expect(beside(lines(0))).toBeGreaterThan(100);
    expect(beside(lines(DEFAULT_ROUTER.crowdFactor))).toBeLessThan(30);
  });
});

describe('relation views', () => {
  test('shows participants and ancestors only, with a badge for hidden siblings', () => {
    const l = layoutOf(
      `
nodes:
  - name: User
    type: actor
  - name: Cloud
    type: cloud
    children:
      - name: Api
        type: api
      - name: Db
        type: database
      - name: Unused
        type: cache
views:
  - id: v
    title: V
    relations:
      - { from: user, to: api, label: calls }
      - { from: api, to: db, label: reads }
`,
      'v',
    );
    expect(l.boxes.map((b) => b.id).sort()).toEqual(['api', 'cloud', 'db', 'user']);
    expect(l.boxes.find((b) => b.id === 'cloud')!.badge).toBe('+1 more');
    expect(l.edges).toHaveLength(2);
    expect(l.metrics.crossings).toBe(0);
    const user = l.boxes.find((b) => b.id === 'user')!, db = l.boxes.find((b) => b.id === 'db')!;
    expect(user.x).toBeLessThan(db.x);
  });

  test('lifts sibling fan-in to one container edge with a count', () => {
    const l = layoutOf(
      `
nodes:
  - name: Apps
    type: group
    children:
      - { name: A, type: service }
      - { name: B, type: service }
      - { name: C, type: service }
  - name: Vault
    type: secret
views:
  - id: v
    title: V
    relations:
      - { from: [a, b], to: vault, label: reads secrets }
      - { from: a, to: b, label: calls }
`,
      'v',
    );
    const lifted = l.edges.find((e) => e.to === 'vault')!;
    expect(lifted.from).toBe('apps');
    expect(lifted.members).toEqual(['a>vault', 'b>vault']);
    expect(lifted.label!.text).toBe('reads secrets (2 of 3)');
    expect(l.metrics.unconnected).toBe(0);
    expect(l.boxes.find((b) => b.id === 'apps')!.badge).toBe('+1 more');
  });

  test('collapse retargets relations and draws one box', () => {
    const l = layoutOf(
      `
nodes:
  - name: User
    type: actor
  - id: tier
    name: Tier
    type: group
    children:
      - { name: A, type: service }
      - { name: B, type: service }
views:
  - id: v
    title: V
    collapse: [tier]
    relations:
      - { from: user, to: [a, b], label: uses }
`,
      'v',
    );
    expect(l.boxes.map((b) => b.id).sort()).toEqual(['tier', 'user']);
    expect(l.boxes.find((b) => b.id === 'tier')!.kind).toBe('collapsed');
    expect(l.edges).toHaveLength(1);
    expect(l.edges[0]!.bundled).toBe(2);
  });

  test('is deterministic', () => {
    const { model } = loadModelFromFile(shop);
    const a = JSON.stringify(layoutView(model!, model!.views[5]!));
    const b = JSON.stringify(layoutView(model!, model!.views[5]!));
    expect(a).toBe(b);
  });

  test('the shop example has no arrows through boxes and no clipped labels', () => {
    const { model, diagnostics } = loadModelFromFile(shop);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    for (const view of model!.views) {
      const l = layoutView(model!, view);
      expect(l.metrics.edgeBoxCrossings).toBe(0);
      for (const e of l.edges) if (e.label) expect(e.label.lines.join(' ')).not.toContain('…');
      for (const b of l.boxes) {
        expect(b.w).toBeGreaterThan(0);
        expect(b.h).toBeGreaterThan(0);
      }
    }
  });
});

describe('sequence and flow views', () => {
  test('sequence columns fit the widest label between two lifelines', () => {
    const l = layoutOf(
      `
nodes:
  - { name: A, type: actor }
  - { name: B, type: service }
views:
  - id: s
    kind: sequence
    title: S
    steps:
      - { from: a, to: b, label: a really quite long message label that must fit, reply: ok }
`,
      's',
    );
    const [a, b] = l.boxes;
    expect(b!.x - a!.x).toBeGreaterThan(200);
    expect(l.extras!.filter((e) => e.kind === 'message')).toHaveLength(2);
    expect(l.extras!.some((e) => e.kind === 'activation')).toBe(true);
  });

  test('flow lanes keep each step in its lane band', () => {
    const l = layoutOf(
      `
nodes: []
views:
  - id: f
    kind: flow
    title: F
    lanes: [Dev, CI]
    steps:
      - { id: s1, text: Push, shape: start, lane: Dev }
      - { id: s2, text: Test, lane: CI }
      - { id: s3, text: Done, shape: end, lane: CI }
    edges:
      - { from: s1, to: s2 }
      - { from: s2, to: s3 }
`,
      'f',
    );
    const lanes = l.extras!.filter((e) => e.kind === 'lane');
    expect(lanes).toHaveLength(2);
    const dev = lanes[0]!, ci = lanes[1]!;
    const s1 = l.boxes.find((b) => b.id === 's1')!, s2 = l.boxes.find((b) => b.id === 's2')!;
    if (dev.kind !== 'lane' || ci.kind !== 'lane') throw new Error();
    expect(s1.x).toBeGreaterThanOrEqual(dev.rect.x);
    expect(s1.x + s1.w).toBeLessThanOrEqual(dev.rect.x + dev.rect.w);
    expect(s2.x).toBeGreaterThanOrEqual(ci.rect.x);
    expect(l.metrics.crossings).toBe(0);
  });
});

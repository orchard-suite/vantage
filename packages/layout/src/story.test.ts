import { describe, expect, test } from 'bun:test';
import { loadModelFromText } from '@vantage/model';
import { layoutView } from './layout.ts';
import { exploreLayouts } from './explore.ts';
import { arrangeFlow } from './arrange/flow.ts';
import { arrangeMatrix, arrangeMirror, arrangeRing } from './arrange/gesture.ts';

const doc = `
nodes:
  - { name: Users, type: users }
  - name: Azure
    type: cloud
    children:
      - { name: Front Door, type: gateway, note: Rules engine redirects legacy hosts. }
      - name: Prod
        type: subscription
        facts: ["Cost center: 3200", "Criticality: Medium"]
        children:
          - { name: Web, type: web, tags: [public] }
          - { name: API, type: api }
          - { name: DB, type: database }
      - name: Test
        type: subscription
        children:
          - { name: Web, id: web-t, type: web, tags: [public] }
          - { name: API, id: api-t, type: api }
          - { name: DB, id: db-t, type: database }
      - { name: Budget, type: note, value: "$3,000", subtitle: monthly }
  - name: Inventory
    type: group
    style: { frame: none }
    children:
      - { name: Key Vault, type: secret, size: icon }
      - { name: Monitor, type: monitoring, size: icon }
relations:
  - { from: users, to: front-door, label: browse, tags: [req] }
  - { from: front-door, to: [web, web-t], label: routes, tags: [req] }
  - { from: web, to: api, label: calls, tags: [req] }
  - { from: api, to: db, label: reads, kind: data, tags: [req] }
  - { from: web-t, to: api-t, label: calls, tags: [req] }
views:
  - id: mirror
    title: Environments
    include: { tags: [req], nodes: [budget] }
    legend: true
    arrange: [{ node: azure, as: mirror, divider: true, order: [prod, test] }]
    highlights: [{ nodes: [web, web-t], label: Public, style: band }]
    paths:
      - title: A request
        steps:
          - { from: users, to: front-door, text: The user opens the site. }
          - { from: front-door, to: web, text: Front Door routes to prod. }
          - { from: api, to: db, id: 3a, text: The API reads. }
          - { from: web, to: audit, label: logs to, text: The web app logs. }
    annotations:
      - { text: Only public entry., at: front-door, kind: callout }
      - { text: Why two subscriptions, kind: heading }
      - { text: Blast radius stays apart. }
  - id: ring
    title: Topology
    include: { tags: [req] }
    collapse: [prod, test]
    arrange: [{ node: azure, as: ring, center: front-door }]
  - id: tiers
    title: Tiers
    include: { tags: [req] }
    direction: down
    arrange: [{ node: prod, layers: [[db], [api], [web]] }]
  - id: inv
    title: Inventory
    include: { subtree: [inventory] }
  - id: poster
    kind: page
    title: Poster
    columns: 2
    panels:
      - { heading: Environments, text: Face to face., view: mirror, span: 2 }
      - { heading: Topology, view: ring }
      - { heading: Inventory, view: inv }
`;

function load() {
  const { model, diagnostics } = loadModelFromText(doc.replace('to: audit', 'to: db'));
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return model!;
}

describe('story layer', () => {
  test('model carries facts, value, size, note, and resolved paths', () => {
    const m = load();
    expect(m.nodes.get('prod')!.facts).toEqual([{ label: 'Cost center', value: '3200' }, { label: 'Criticality', value: 'Medium' }]);
    expect(m.nodes.get('budget')!.value).toBe('$3,000');
    expect(m.nodes.get('key-vault')!.size).toBe('icon');
    expect(m.nodes.get('front-door')!.note).toContain('legacy');
    const v = m.views.find((x) => x.id === 'mirror')!;
    if (v.kind !== 'relation') throw new Error();
    expect(v.paths[0]!.steps.map((s) => s.badge)).toEqual(['1', '2', '3a', '3']);
    expect(v.paths[0]!.color).toBe('blue');
    // The last step named an arrow the view did not have; the path added it.
    expect(v.relations.some((r) => r.label === 'logs to')).toBe(true);
    expect(v.narrative).toBe(true);
  });

  test('mirror flips every other half so they face each other, and draws a divider', () => {
    const m = load();
    const l = layoutView(m, m.views.find((x) => x.id === 'mirror')!);
    const box = (id: string) => l.boxes.find((b) => b.id === id)!;
    // Prod flows right (web before api before db), test flows left.
    expect(box('web').x).toBeLessThan(box('api').x);
    expect(box('api').x).toBeLessThan(box('db').x);
    expect(box('web-t').x).toBeGreaterThan(box('api-t').x);
    expect(l.extras!.some((e) => e.kind === 'line' && e.style === 'divider')).toBe(true);
  });

  test('notes, callouts, highlights, badges, narrative, and legend are drawn', () => {
    const m = load();
    const l = layoutView(m, m.views.find((x) => x.id === 'mirror')!);
    const kinds = l.extras!.map((e) => e.kind);
    expect(kinds).toContain('note');
    expect(kinds.filter((k) => k === 'badge').length).toBeGreaterThanOrEqual(6);
    expect(l.extras!.some((e) => e.kind === 'highlight' && e.label?.lines[0] === 'Public')).toBe(true);
    expect(l.extras!.some((e) => e.kind === 'text' && e.role === 'heading' && e.text.lines[0] === 'Why two subscriptions')).toBe(true);
    expect(l.extras!.some((e) => e.kind === 'legend')).toBe(true);
    const colored = l.edges.filter((e) => e.color === 'blue');
    expect(colored.length).toBeGreaterThanOrEqual(3);
    // The note is an obstacle: no edge passes through it.
    const note = l.extras!.find((e) => e.kind === 'note')!;
    if (note.kind !== 'note') throw new Error();
    for (const e of l.edges) for (const p of e.points) expect(p.x > note.rect.x && p.x < note.rect.x + note.rect.w && p.y > note.rect.y && p.y < note.rect.y + note.rect.h).toBe(false);
  });

  test('a note asked for the side an arrow leaves from moves aside so the arrow stays straight', () => {
    const { model: m, diagnostics } = loadModelFromText(`
nodes:
  - { name: Edge, type: vm, tags: [x] }
  - { name: Cluster, type: cluster, tags: [x] }
relations:
  - { from: edge, to: cluster, label: proxies to, tags: [x] }
views:
  - id: v
    title: V
    direction: down
    include: { tags: [x] }
    annotations:
      - { text: The one front door. Nothing on the router is forwarded for the web., at: edge, kind: callout, side: bottom }
`);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const l = layoutView(m!, m!.views[0]!);
    const edge = l.edges.find((e) => e.from === 'edge')!;
    expect(edge.points.length).toBe(2);
  });

  test('facts size the box and icon-only nodes have no frame', () => {
    const m = load();
    const l = layoutView(m, m.views.find((x) => x.id === 'inv')!);
    const kv = l.boxes.find((b) => b.id === 'key-vault')!;
    expect(kv.iconOnly).toBe(true);
    expect(kv.icon!.size).toBe(44);
    const inv = l.boxes.find((b) => b.id === 'inventory')!;
    expect(inv.frame).toBe('none');
    const t = layoutView(m, m.views.find((x) => x.id === 'tiers')!);
    const prod = t.boxes.find((b) => b.id === 'prod')!;
    expect(prod.texts!.length).toBe(2);
    expect(prod.inner!.y).toBeGreaterThan(50);
  });

  test('explicit layers put named children in their tier', () => {
    const m = load();
    const l = layoutView(m, m.views.find((x) => x.id === 'tiers')!);
    const box = (id: string) => l.boxes.find((b) => b.id === id)!;
    expect(box('db').y).toBeLessThan(box('api').y);
    expect(box('api').y).toBeLessThan(box('web').y);
    const items = ['a', 'b', 'c'].map((id, i) => ({ id, role: 'compute' as const, order: i, externalIn: 0, externalOut: 0 }));
    const r = arrangeFlow(items, [{ from: 'a', to: 'b', weight: 1 }], [], [['c'], ['a'], ['b']]);
    expect(r.layers).toEqual([['c'], ['a'], ['b']]);
  });

  test('ring puts the center in the middle of the others', () => {
    const items = ['hub', 'a', 'b', 'c', 'd'].map((id) => ({ id, size: { w: 100, h: 50 }, tags: [] }));
    const r = arrangeRing(items, 'hub', 20);
    const hub = r.placed.find((p) => p.id === 'hub')!.rect;
    const others = r.placed.filter((p) => p.id !== 'hub');
    const cx = hub.x + hub.w / 2, cy = hub.y + hub.h / 2;
    expect(others.some((p) => p.rect.y + p.rect.h <= hub.y)).toBe(true);
    expect(others.some((p) => p.rect.y >= hub.y + hub.h)).toBe(true);
    expect(Math.abs(others.reduce((a, p) => a + p.rect.x + p.rect.w / 2, 0) / others.length - cx)).toBeLessThan(2);
    expect(Math.abs(others.reduce((a, p) => a + p.rect.y + p.rect.h / 2, 0) / others.length - cy)).toBeLessThan(2);
    const m = load();
    const l = layoutView(m, m.views.find((x) => x.id === 'ring')!);
    expect(l.metrics.score).toBeGreaterThanOrEqual(90);
  });

  test('matrix places by tags, labels the axes, and drops empty rows', () => {
    const items = [
      { id: 'w', size: { w: 80, h: 40 }, tags: ['web', 'prod'] },
      { id: 'd', size: { w: 80, h: 40 }, tags: ['data', 'test'] },
      { id: 'x', size: { w: 80, h: 40 }, tags: [] },
    ];
    const r = arrangeMatrix(items, { rows: ['web', 'data', 'unused'], columns: ['prod', 'test'] }, 10, true, 13);
    const axis = r.extras.filter((e) => e.kind === 'text').map((e) => (e.kind === 'text' ? e.text.lines[0] : ''));
    expect(axis).toContain('web');
    expect(axis).toContain('Other');
    expect(axis).not.toContain('unused');
    const w = r.placed.find((p) => p.id === 'w')!.rect, d = r.placed.find((p) => p.id === 'd')!.rect;
    expect(w.x).toBeLessThan(d.x);
    expect(w.y).toBeLessThan(d.y);
    expect(r.extras.some((e) => e.kind === 'line')).toBe(true);
    const mir = arrangeMirror(items.slice(0, 2), 'right', 10, true);
    expect(mir.extras.filter((e) => e.kind === 'line').length).toBe(1);
  });

  test('page composes panels with headings and embedded views', () => {
    const m = load();
    const l = layoutView(m, m.views.find((x) => x.id === 'poster')!);
    const panels = l.extras!.filter((e) => e.kind === 'panel');
    expect(panels.length).toBe(3);
    const headings = l.extras!.filter((e) => e.kind === 'text' && e.role === 'heading').map((e) => (e.kind === 'text' ? e.text.lines[0] : ''));
    expect(headings).toContain('Topology');
    expect(l.boxes.filter((b) => b.id === 'front-door').length).toBe(2);
    expect(l.width).toBeGreaterThan(l.boxes.reduce((a, b) => Math.max(a, b.x + b.w), 0));
  });

  test('explore returns distinct scored candidates with hints', () => {
    const m = load();
    const v = m.views.find((x) => x.id === 'mirror')!;
    if (v.kind !== 'relation') throw new Error();
    const c = exploreLayouts(m, v, 4);
    expect(c.length).toBeGreaterThanOrEqual(3);
    expect(c[0]!.score).toBeGreaterThanOrEqual(c[c.length - 1]!.score);
    expect(c.some((x) => x.hints.direction === 'down')).toBe(true);
  });
});

import { describe, expect, test } from 'bun:test';
import { loadModelFromText, PROFILES, migrateDocument } from '@vantage/model';
import { layoutView, anchorsOf } from './layout.ts';
import { freeSpot } from './compose-pinned.ts';

const pinned = `
nodes:
  - { name: Browser, type: web }
  - name: Azure
    type: cloud
    children:
      - { name: Front Door, type: gateway }
      - { name: Web App, type: app }
      - { name: New Cache, type: cache }
relations:
  - { from: browser, to: front-door, label: https }
  - { from: front-door, to: web-app, label: routes }
  - { from: web-app, to: new-cache, label: caches }
views:
  - id: v
    title: V
    include: { tags: [] }
    relations:
      - { from: browser, to: front-door, label: https }
      - { from: front-door, to: web-app, label: routes }
      - { from: web-app, to: new-cache, label: caches }
    pins:
      nodes:
        browser: { x: 40, y: 200, w: 140, h: 60 }
        front-door: { x: 300, y: 80, w: 160, h: 60 }
        web-app: { x: 560, y: 200, w: 160, h: 60 }
      edges:
        "browser>front-door": [{ x: 180, y: 230 }, { x: 240, y: 230 }, { x: 240, y: 110 }, { x: 300, y: 110 }]
        "front-door>web-app": [{ x: 460, y: 110 }, { x: 640, y: 200 }]
`;

function load(text: string) {
  const { model, diagnostics } = loadModelFromText(text);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return model!;
}

describe('pins', () => {
  test('pinned boxes keep their geometry, pinned edges keep waypoints, unpinned boxes land beside their relations', () => {
    const m = load(pinned);
    const l = layoutView(m, m.views[0]!);
    const box = (id: string) => l.boxes.find((b) => b.id === id)!;
    // Relative geometry is exact; the whole picture may shift by a constant offset.
    const dx = box('browser').x - 40, dy = box('browser').y - 200;
    expect(box('front-door')).toMatchObject({ x: 300 + dx, y: 80 + dy, w: 160, h: 60 });
    expect(box('web-app')).toMatchObject({ x: 560 + dx, y: 200 + dy, w: 160, h: 60 });
    const diag = l.edges.find((e) => e.from === 'front-door' && e.to === 'web-app')!;
    expect(diag.points.map((p) => [p.x - dx, p.y - dy])).toEqual([[460, 110], [640, 200]]);
    const bent = l.edges.find((e) => e.from === 'browser' && e.to === 'front-door')!;
    expect(bent.points.length).toBe(4);
    // The container frames its pinned children and the new cache sits inside it, near the web app.
    const azure = box('azure'), cache = box('new-cache'), web = box('web-app');
    expect(cache.x).toBeGreaterThanOrEqual(azure.x);
    expect(cache.x + cache.w).toBeLessThanOrEqual(azure.x + azure.w);
    expect(Math.hypot(cache.x - web.x, cache.y - web.y)).toBeLessThan(300);
  });

  test('freeSpot avoids taken rects and prefers the side of the anchor', () => {
    const area = { x: 0, y: 0, w: 1000, h: 1000 };
    const anchor = { x: 100, y: 100, w: 100, h: 50 };
    const spot = freeSpot({ w: 80, h: 40 }, area, [anchor, { x: 220, y: 100, w: 80, h: 40 }], [anchor], 20);
    expect(spot.x + spot.w <= 200 || spot.x >= 320 || spot.y >= 170 || spot.y + spot.h <= 80).toBe(true);
    expect(spot).toMatchObject({ w: 80, h: 40 });
  });
});

describe('shapes, edge styles, profiles, versions', () => {
  test('shape overrides, straight and curved styles, heads, text and image nodes resolve and lay out', () => {
    const m = load(`
nodes:
  - { name: Start, type: component, shape: circle }
  - { name: Decide, type: component, shape: diamond }
  - { id: note, name: "Free text here", type: text }
  - { name: Logo, type: image, image: /tmp/none.svg, imageWidth: 40, imageHeight: 40 }
relations:
  - { from: start, to: decide, style: curved, heads: { to: open } }
  - { from: decide, to: note, style: straight, heads: { from: diamond, to: none } }
views:
  - id: v
    title: V
    include: { tags: [] }
    relations:
      - { from: start, to: decide, style: curved, heads: { to: open } }
      - { from: decide, to: note, style: straight, heads: { from: diamond, to: none } }
      - { from: note, to: logo }
`);
    expect(m.nodes.get('start')!.shape).toBe('circle');
    expect(m.nodes.get('note')!.style.frame).toBe('none');
    expect(m.nodes.get('logo')!.imageSize).toEqual({ w: 40, h: 40 });
    const l = layoutView(m, m.views[0]!);
    const start = l.boxes.find((b) => b.id === 'start')!;
    expect(Math.abs(start.w - start.h)).toBeLessThan(1);
    const straight = l.edges.find((e) => e.from === 'decide' && e.to === 'note')!;
    expect(straight.points.length).toBe(2);
    expect(straight.heads).toEqual({ from: 'diamond', to: 'none' });
    expect(l.edges.find((e) => e.from === 'start')!.style).toBe('curved');
    expect(l.boxes.find((b) => b.id === 'logo')!.image?.w).toBe(40);
  });

  test('profiles add vocabularies as data and local types extend them', () => {
    expect([...PROFILES.keys()].sort()).toEqual(['aws', 'azure', 'bpmn', 'k8s', 'uml']);
    const vendor = load(`
profiles: [azure]
nodes:
  - { name: Secrets, type: secret }
  - { name: Vault, type: keyvault }
  - { name: Plain, type: service }
views: []
`);
    expect(vendor.nodes.get('secrets')!.icon).toBe('azure/key-vaults');
    expect(vendor.nodes.get('vault')!.color).toBe('red');
    expect(vendor.nodes.get('plain')!.icon).toBe('generic/service');
    // A qualified profile type works without listing its profile, so a diagram can mix vendors.
    const mixed = load(`
types:
  Edge: { extends: aws.cloudfront, color: violet }
nodes:
  - { name: Vault, type: azure.keyvault }
  - { name: Ns, type: k8s.namespace }
  - { name: Cdn, type: Edge }
  - { name: Zone, type: dns }
views: []
`);
    expect(mixed.nodes.get('vault')!.icon).toBe('azure/key-vaults');
    expect(mixed.nodes.get('ns')!.icon).toBe('k8s/ns');
    expect(mixed.nodes.get('cdn')!.icon).toBe('aws/cloudfront');
    expect(mixed.nodes.get('cdn')!.color).toBe('violet');
    expect(mixed.nodes.get('zone')!.icon).toBe('generic/dns');
    const m = load(`
profiles: [bpmn]
types:
  Approval: { extends: usertask, color: amber }
nodes:
  - { name: Begin, type: startevent }
  - { name: Approve, type: Approval }
  - { name: Fork, type: exclusive }
views:
  - id: v
    title: V
    relations: [{ from: begin, to: approve }, { from: approve, to: fork }]
`);
    expect(m.nodes.get('begin')!.shape).toBe('circle');
    expect(m.nodes.get('approve')!.icon).toBe('generic/user');
    expect(m.nodes.get('approve')!.color).toBe('amber');
    expect(m.nodes.get('fork')!.shape).toBe('diamond');
    expect(m.nodes.get('fork')!.icon).toBeUndefined();
    const bad = loadModelFromText('profiles: [nope]\nnodes: []\n');
    expect(bad.diagnostics.some((d) => d.code === 'unknown-profile')).toBe(true);
  });

  test('language version: newer documents are refused, current ones pass', () => {
    expect(migrateDocument({ vantage: 1 }).error).toBeUndefined();
    expect(migrateDocument({ vantage: 9 }).error).toContain('vantage 9');
    const r = loadModelFromText('vantage: 9\nnodes: []\n');
    expect(r.diagnostics[0]?.code).toBe('language-version');
  });

  test('anchors from an earlier view order siblings in a later one', () => {
    const m = load(`
nodes:
  - name: Box
    type: group
    children:
      - { name: A, type: service }
      - { name: B, type: service }
      - { name: C, type: service }
views:
  - id: first
    title: First
    include: { subtree: [box] }
    arrange: [{ node: box, as: column, order: [c, b, a] }]
  - id: second
    title: Second
    include: { subtree: [box] }
    arrange: [{ node: box, as: column }]
`);
    const first = layoutView(m, m.views[0]!);
    const second = layoutView(m, m.views[1]!, undefined, anchorsOf(first));
    const ys = (l: typeof first) => ['a', 'b', 'c'].map((id) => l.boxes.find((b) => b.id === id)!.y);
    expect(ys(first)[2]).toBeLessThan(ys(first)[0]!);
    expect(ys(second)).toEqual(ys(first));
  });
});

describe('reparent', () => {
  test('a view may move nodes under another container or to the canvas without touching other views', () => {
    const m = loadModelFromText(`
nodes:
  - name: Platform
    type: group
    children:
      - { name: Vault, type: secret }
      - { name: Grafana, type: monitoring }
  - name: Apps
    type: group
    children:
      - { name: Portal, type: web }
views:
  - id: by-platform
    title: By platform
    relations: [{ from: portal, to: vault, label: reads }]
  - id: by-team
    title: By team
    reparent: { vault: apps, grafana: root }
    relations: [{ from: portal, to: vault, label: reads }, { from: portal, to: grafana, label: sends logs to }]
`).model!;
    const a = layoutView(m, m.views[0]!);
    const b = layoutView(m, m.views[1]!);
    expect(a.boxes.find((x) => x.id === 'vault')!.parentId).toBe('platform');
    expect(b.boxes.find((x) => x.id === 'vault')!.parentId).toBe('apps');
    expect(b.boxes.find((x) => x.id === 'grafana')!.parentId).toBeUndefined();
    expect(b.boxes.some((x) => x.id === 'platform')).toBe(false);
    // The model itself is untouched.
    expect(m.nodes.get('vault')!.parentId).toBe('platform');
  });
});

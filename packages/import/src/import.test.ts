import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadModelFromText, type NodeInput } from '@vantage/model';
import { detectFormat, formatReport, importDiagram, matchIconId } from './index.ts';
import { expectPinsHonoured } from './pins.test-helper.ts';

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(import.meta.dir, '..', 'fixtures', name)));

function flatten(nodes: readonly NodeInput[]): NodeInput[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
}

/** Facts and relation ends as the author wrote them; the parsed document normalises both. */
const factLines = (n: NodeInput): string[] => (n.facts ?? []).map((f) => (typeof f === 'string' ? f : `${f.label}: ${f.value}`));
const ends = (r: { from: string | string[]; to: string | string[] }): string => `${String(r.from)}>${String(r.to)}`;

describe('draw.io import', () => {
  test('flat page: nodes, parts, geometry containment, decoration, pins, edge pins', () => {
    const r = importDiagram(fixture('flat.drawio'), { filename: 'flat.drawio' });
    expect(r.report.format).toBe('drawio');
    expect(r.report.pages.map((p) => p.name)).toEqual(['Order Flow']);
    const all = flatten(r.document.nodes);
    const names = all.map((n) => n.name).sort();
    expect(names).toEqual(['API Gateway', 'Browser', 'Cache', 'Orders DB', 'Orders Service', 'Platform']);
    const browser = all.find((n) => n.name === 'Browser')!;
    expect(browser.subtitle).toBe('Chrome, Safari');
    expect(browser.color).toBe('blue');
    const gw = all.find((n) => n.name === 'API Gateway')!;
    expect(factLines(gw)).toEqual(['Region: west', 'SLA: 99.9%']);
    expect(gw.color).toBe('emerald');
    expect(gw.style?.fill).toBe('#d5e8d4');
    // Platform has no parent cell in the file; the boxes drawn inside it become its children.
    const platform = r.document.nodes.find((n) => n.name === 'Platform')!;
    expect(platform.children?.map((c) => c.name).sort()).toEqual(['API Gateway', 'Cache', 'Orders DB', 'Orders Service']);
    expect(all.find((n) => n.name === 'Orders DB')!.shape).toBe('cylinder');
    expect(all.find((n) => n.name === 'Cache')!.shape).toBe('circle');
    expect(r.report.pages[0]!.dropped).toEqual(['deco: decoration without text']);

    const rels = r.document.relations!;
    expect(rels.map((x) => x.label)).toEqual(['places order', 'routes', 'reads and writes', undefined]);
    const dashed = rels[3]!;
    expect(dashed.kind).toBe('async');
    expect(dashed.heads).toEqual({ from: 'none', to: 'open' });
    expect(dashed.style).toBe('straight');
    expect(rels[1]!.style).toBeUndefined();

    const view = r.document.views[0]!;
    if (view.kind !== 'relation') throw new Error('expected a relation view');
    expect(view.title).toBe('Order Flow');
    expect(view.pins!.nodes['browser']).toEqual({ x: 40, y: 200, w: 140, h: 60 });
    expect(view.pins!.nodes['platform']).toEqual({ x: 260, y: 40, w: 480, h: 360 });
    expect(view.pins!.edges!['browser>api-gateway']).toEqual([{ x: 180, y: 230 }, { x: 220, y: 230 }, { x: 220, y: 120 }, { x: 300, y: 120 }]);
    expect(view.pins!.edges!['api-gateway>orders-service']).toBeUndefined();
    expect(view.arrange).toEqual([{ node: 'platform', as: 'grid', columns: 2 }]);
    expect(r.report.hints).toHaveLength(1);
    expect(r.report.originalName).toBe('flat.original.drawio');

    const loaded = loadModelFromText(r.yaml);
    expect(loaded.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expectPinsHonoured(loaded.model!, 'order-flow');
  });

  test('compressed page with parent cells, grid, actor, text, image, legend', () => {
    const r = importDiagram(fixture('containers.drawio'), { filename: 'containers.drawio' });
    const cluster = r.document.nodes.find((n) => n.name === 'Cluster')!;
    expect(cluster.children?.map((c) => c.name)).toEqual(['Web', 'API', 'Worker', 'Redis', 'Postgres', 'Bus']);
    const all = flatten(r.document.nodes);
    expect(all.find((n) => n.name === 'Users')!.shape).toBe('person');
    const text = all.find((n) => n.type === 'text')!;
    expect(text.name).toBe('Backend overview');
    // A small embedded picture becomes a document icon backed by a file beside the document.
    const pictured = all.find((n) => n.icon?.startsWith('imported/'))!;
    expect(pictured.size).toBe('icon');
    const path = r.document.icons![pictured.icon!]!;
    expect(path).toMatch(/^assets\/[a-z0-9-]+\.png$/);
    expect(Buffer.from(r.assets[path]!.subarray(1, 4)).toString()).toBe('PNG');
    expect(r.report.pictures.kept).toHaveLength(1);
    expect(r.yaml).not.toContain('data:image');
    const view = r.document.views[0]!;
    if (view.kind !== 'relation') throw new Error('expected a relation view');
    expect(view.legend).toBe(true);
    expect(view.arrange).toEqual([{ node: 'cluster', as: 'grid', columns: 3 }]);
    expect(view.pins!.nodes['web']).toEqual({ x: 80, y: 100, w: 120, h: 60 });
    expect(r.report.pages[0]!.dropped.filter((d) => d.endsWith('legend'))).toHaveLength(3);
    expect(ends(r.document.relations!.find((x) => x.label === 'calls')!)).toBe('web>api');
    const loaded = loadModelFromText(r.yaml);
    expect(loaded.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expectPinsHonoured(loaded.model!, 'backend');
  });

  test('vendor library icons match our ids; a box wears the icon drawn inside it; misses are reported', () => {
    const ids = ['azure/app-services', 'azure/app-service-plans', 'azure/key-vaults', 'azure/function-apps', 'aws/lambda', 'aws/group-virtual-private-cloud-vpc', 'aws/group-vpc'];
    const r = importDiagram(fixture('vendor.drawio'), { filename: 'vendor.drawio', iconResolver: (h) => matchIconId(h, ids) });
    const all = flatten(r.document.nodes);
    const byName = (name: string): NodeInput => all.find((n) => n.name === name)!;
    expect(byName('Shop Web')).toMatchObject({ icon: 'azure/app-services', size: 'icon' });
    expect(byName('Secrets')).toMatchObject({ icon: 'azure/key-vaults', size: 'icon' });
    expect(byName('Prod VPC').icon).toBe('aws/group-vpc');
    expect(byName('Prod VPC').children?.map((c) => c.name)).toEqual(['Orders', 'Flux']);
    expect(byName('Orders')).toMatchObject({ icon: 'aws/lambda', size: 'icon' });
    expect(byName('Flux').icon).toBeUndefined();
    expect(byName('Billing API').icon).toBe('azure/function-apps');
    expect(r.report.pictures.matched).toHaveLength(5);
    expect(r.report.pictures.missed).toEqual(['no icon matched aws/quantum flux capacitor (Flux)']);
    expect(r.report.unmappedStyles.filter((u) => u.includes('aws4'))).toEqual([]);
    expect(r.report.warnings).toEqual([]);
    expect(Object.keys(r.assets)).toEqual([]);
    const view = r.document.views[0]!;
    if (view.kind !== 'relation') throw new Error('expected a relation view');
    // An icon node's pin leaves room for the caption the drawing kept outside the shape.
    expect(view.pins!.nodes['shop-web']!.h).toBe(86);
    const loaded = loadModelFromText(r.yaml);
    expect(loaded.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  test('swimlanes, curved and dashed edges, ER heads, diamond and hexagon', () => {
    const r = importDiagram(fixture('swimlanes.drawio'), { filename: 'swimlanes.drawio' });
    expect(r.document.nodes.map((n) => n.name)).toEqual(['Shop', 'Payments']);
    const shop = r.document.nodes[0]!;
    expect(shop.children?.map((c) => c.name)).toEqual(['Cart', 'Checkout', 'Paid?']);
    const all = flatten(r.document.nodes);
    expect(all.find((n) => n.name === 'Paid?')!.shape).toBe('diamond');
    expect(all.find((n) => n.name === 'Payment Provider')!.shape).toBe('hexagon');
    const rels = r.document.relations!;
    expect(rels.find((x) => x.label === 'pay')!.style).toBe('curved');
    expect(rels.find((x) => x.label === 'result')).toMatchObject({ kind: 'async', heads: { from: 'none', to: 'open' } });
    expect(rels.find((x) => x.label === 'records')!.heads).toEqual({ from: 'one', to: 'many' });
    const view = r.document.views[0]!;
    if (view.kind !== 'relation') throw new Error('expected a relation view');
    expect(view.arrange).toEqual([{ node: 'shop', as: 'row' }]);
    expect(Object.keys(view.pins!.edges!)).toEqual(['checkout>payment-provider']);
    const loaded = loadModelFromText(r.yaml);
    expect(loaded.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expectPinsHonoured(loaded.model!, 'checkout-lanes');
  });

  test('pageIndex picks one page and the report prints', () => {
    const r = importDiagram(fixture('flat.drawio'), { filename: 'flat.drawio', pageIndex: 0 });
    expect(r.report.pages).toHaveLength(1);
    expect(() => importDiagram(fixture('flat.drawio'), { filename: 'flat.drawio', pageIndex: 3 })).toThrow(/no page 3/);
    const text = formatReport(r.report);
    expect(text).toContain('Order Flow: 7 shapes, 4 connectors');
    expect(text).toContain('as: grid');
    expect(text).toContain('flat.original.drawio');
  });

  test('format detection', () => {
    expect(detectFormat(fixture('flat.drawio'), 'x.xml')).toBe('drawio');
    expect(() => detectFormat(new TextEncoder().encode('<svg/>'), 'x.svg')).toThrow(/not a draw.io file/);
    expect(() => detectFormat(new TextEncoder().encode('nope'), 'x.vsdx')).toThrow(/not a zip/);
  });
});

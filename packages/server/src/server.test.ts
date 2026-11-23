import { describe, expect, test } from 'bun:test';
import { createApp } from './app.ts';
import { validate, render, searchIcons, exportDocument } from './core.ts';
import { join } from 'node:path';

const shop = join(import.meta.dir, '..', '..', '..', 'examples', 'shop', 'shop.vantage.yaml');

describe('core', () => {
  test('validate reports views with metrics', () => {
    const v = validate({ file: shop });
    expect(v.ok).toBe(true);
    expect(v.views.map((x) => x.id)).toContain('requests');
    expect(v.views[0]!.metrics.score).toBeGreaterThan(0);
  });

  test('validate returns located errors for bad text', () => {
    const v = validate({ text: 'nodes:\n  - name: A\nviews:\n  - id: v\n    title: V\n    relations:\n      - { from: a, to: missing }\n' });
    expect(v.ok).toBe(false);
    expect(v.diagnostics[0]!.code).toBe('unknown-node');
    expect(v.diagnostics[0]!.line).toBe(7);
  });

  test('a hidden view is a part: out of default renders and exports, still reachable by name', async () => {
    const text = 'nodes:\n  - name: A\n  - name: B\nviews:\n  - id: base\n    title: Base\n    hidden: true\n    relations:\n      - { from: a, to: b }\n  - id: ctx\n    title: Context\n    extends: [base]\n';
    const v = validate({ text });
    expect(v.ok).toBe(true);
    expect(v.views.map((x) => [x.id, x.hidden ?? false])).toEqual([['base', true], ['ctx', false]]);
    expect(render({ text }).result!.viewId).toBe('ctx');
    expect(render({ text, view: 'base' }).result!.viewId).toBe('base');
    expect((await exportDocument({ text, format: 'drawio' })).result!.viewIds).toEqual(['ctx']);
    expect((await exportDocument({ text, format: 'drawio', views: ['base'] })).result!.viewIds).toEqual(['base']);
    expect(render({ text, format: 'html' }).result!.html).toContain('"hidden":true');
  });

  test('render produces svg, png and html', () => {
    expect(render({ file: shop, view: 'data' }).result!.svg).toContain('<svg');
    expect(render({ file: shop, view: 'data', format: 'png', scale: 1 }).result!.png!.length).toBeGreaterThan(1000);
    expect(render({ file: shop, format: 'html' }).result!.html).toContain('window.__VANTAGE__');
  });

  test('render takes a title block, transparency, and embedded fonts', () => {
    const svg = render({ file: shop, view: 'data', titleBlock: { title: 'Shop', published: '2026-10-28' }, transparent: true, embedFonts: true }).result!.svg;
    expect(svg).toContain('class="v-title-block"');
    expect(svg).not.toContain('class="v-canvas"');
    expect(svg).toContain('@font-face');
  });

  test('exportDocument writes pdf, drawio, and vsdx for chosen views', async () => {
    const pdf = (await exportDocument({ file: shop, format: 'pdf', views: ['context', 'data'], titleBlock: true, page: 'Letter' })).result!;
    expect(pdf.viewIds).toEqual(['context', 'data']);
    expect(pdf.contentType).toBe('application/pdf');
    expect(Buffer.from(pdf.bytes).toString('latin1').match(/\/Type \/Page\n/g)?.length).toBe(2);
    const drawio = (await exportDocument({ file: shop, format: 'drawio' })).result!;
    expect(Buffer.from(drawio.bytes).toString('utf8').match(/<diagram /g)?.length).toBe(validate({ file: shop }).views.filter((v) => v.kind !== 'doc').length);
    const vsdx = (await exportDocument({ file: shop, format: 'vsdx', views: ['data'] })).result!;
    expect(vsdx.bytes[0]).toBe(0x50);
    expect(vsdx.extension).toBe('vsdx');
    const bad = await exportDocument({ file: shop, format: 'pdf', views: ['nope'] });
    expect(bad.result).toBeUndefined();
    expect(bad.diagnostics.at(-1)!.code).toBe('unknown-view');
  });

  test('icon search', () => {
    expect(searchIcons('key vault', 'azure')).toContain('azure/key-vault');
  });
});

describe('http api', () => {
  const app = createApp({ file: shop });

  test('serves the viewer and the bundle', async () => {
    expect((await app.request('/')).status).toBe(200);
    const res = await app.request('/api/bundle');
    const bundle = (await res.json()) as { views: unknown[]; live: boolean };
    expect(bundle.views.length).toBe(11);
    expect(bundle.live).toBe(true);
  });

  test('renders by POST with metrics header', async () => {
    const res = await app.request('/api/render', { method: 'POST', body: JSON.stringify({ file: shop, view: 'context' }), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('svg');
    expect(JSON.parse(res.headers.get('x-vantage-metrics')!).score).toBeGreaterThan(50);
  });

  test('validates text and returns 422 for render of a broken document', async () => {
    const res = await app.request('/api/render', { method: 'POST', body: JSON.stringify({ text: 'nodes: [' }), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(422);
    const schema = (await (await app.request('/api/schema')).json()) as { properties: Record<string, unknown> };
    expect(schema.properties['views']).toBeDefined();
    expect((await (await app.request('/api/guide')).text())).toContain('Vantage authoring guide');
  });
});

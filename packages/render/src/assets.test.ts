import { describe, expect, test } from 'bun:test';
import { loadModelFromText } from '@vantage/model';
import { layoutView } from '@vantage/layout';
import { modelResources, pictureIcon, resourceDiagnostics } from './assets.ts';
import { MapAssetSource } from './hrefs.ts';
import { FileIconSource, LayeredIconSource, MapIconSource } from './icons/source.ts';
import { renderSvg } from './render-svg.ts';
import { renderPng } from './png.ts';

const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#c33"/></svg>';
const PNG = renderPng(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#3c3"/></svg>`, { scale: 1 }).bytes;
const enc = new TextEncoder();

const yaml = `
title: Assets
profiles: [azure]
icons:
  acme/logo: logo.svg
  acme/mark: mark.png
nodes:
  - { name: Acme, icon: acme/logo }
  - { name: Mark, icon: acme/mark }
  - { name: Vault, type: keyvault }
  - { name: Screen, type: image, image: shots/screen.png, imageWidth: 40, imageHeight: 30 }
  - { name: Ghost, icon: acme/ghost }
  - { name: Lost, type: image, image: lost.png }
relations:
  - { from: Acme, to: Vault }
views:
  - { id: main, kind: relation, title: Main, include: { nodes: [Acme, Mark, Vault, Screen, Ghost, Lost] } }
`;

describe('document assets', () => {
  const { model, diagnostics } = loadModelFromText(yaml, 'doc.vantage.yaml');
  const assets = new MapAssetSource({ 'logo.svg': enc.encode(LOGO), 'mark.png': PNG, 'shots/screen.png': PNG });
  const res = modelResources(model!, new FileIconSource(), assets);

  test('the icons block resolves, and its icons sit over the shipped packs', () => {
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(model!.icons.get('acme/logo')).toBe('logo.svg');
    expect(res.icons.get('acme/logo')).toContain('data:image/svg+xml;base64,');
    expect(res.icons.get('acme/mark')).toContain('data:image/png;base64,');
    expect(res.icons.has('azure/key-vaults')).toBe(true);
  });

  test('a custom icon is one picture inside a symbol, so its markup never reaches the page', () => {
    const hostile = pictureIcon(`data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"><script>alert(1)</script></svg>').toString('base64')}`);
    expect(hostile).not.toContain('script');
    expect(hostile).not.toContain('onload');
  });

  test('the svg draws custom icons and inlines pictures from the asset source', () => {
    const svg = renderSvg(layoutView(model!, model!.views[0]!), res);
    expect(svg).toContain('<symbol id="i-acme-logo"');
    expect(svg).toContain('<symbol id="i-azure-key-vaults"');
    expect(svg).toMatch(/<image href="data:image\/png;base64,[^"]+" x=/);
    expect(renderPng(svg, { scale: 1 }).bytes.byteLength).toBeGreaterThan(0);
  });

  test('unknown icons and missing files are warnings', () => {
    const found = resourceDiagnostics(model!, res).map((d) => `${d.code}: ${d.message}`);
    expect(found).toEqual(['unknown-icon: icon acme/ghost is not in any icon pack (ghost)', 'missing-asset: file lost.png is missing']);
  });

  test('a bad icon id is a schema error', () => {
    const bad = loadModelFromText('title: x\nicons:\n  Logo: logo.svg\nnodes: []\nviews: []\n');
    expect(bad.diagnostics.some((d) => d.severity === 'error' && d.message.includes('pack/name'))).toBe(true);
  });
});

describe('layered icons', () => {
  test('the first layer that has an id wins, and list merges every layer', () => {
    const icons = new LayeredIconSource([new MapIconSource({ 'a/x': 'first' }), new MapIconSource({ 'a/x': 'second', 'b/y': 'only' })]);
    expect(icons.get('a/x')).toBe('first');
    expect(icons.get('b/y')).toBe('only');
    expect(icons.list()).toEqual(['a/x', 'b/y']);
    expect(icons.has('c/z')).toBe(false);
  });
});

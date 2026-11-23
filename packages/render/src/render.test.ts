import { describe, expect, test } from 'bun:test';
import { loadModelFromFile } from '@vantage/model';
import { layoutView } from '@vantage/layout';
import { renderSvg } from './render-svg.ts';
import { titleBlockHeight } from './title-block.ts';
import { renderPng } from './png.ts';
import { FileIconSource } from './icons/source.ts';
import { symbolBody } from './icons/symbol.ts';
import { buildBundle } from './bundle.ts';
import { THEMES } from './theme.ts';
import { join } from 'node:path';

const shop = join(import.meta.dir, '..', '..', '..', 'examples', 'shop', 'shop.vantage.yaml');
const harbor = join(import.meta.dir, '..', '..', '..', 'examples', 'harbor', 'harbor.vantage.yaml');

describe('render', () => {
  const { model } = loadModelFromFile(shop);
  const icons = new FileIconSource();

  test('svg carries data attributes for every box and edge and inlines icons once', () => {
    const view = model!.views.find((v) => v.id === 'requests')!;
    const layout = layoutView(model!, view);
    const svg = renderSvg(layout, { icons });
    expect(svg.startsWith('<svg')).toBe(true);
    for (const b of layout.boxes) expect(svg).toContain(`data-id="${b.id}"`);
    for (const e of layout.edges) expect(svg).toContain(`data-from="${e.from}"`);
    expect(svg.match(/<symbol id="i-generic-api"/g)?.length).toBe(1);
    expect(svg).toContain('stroke="currentColor"');
  });

  test('png export renders text with embedded Inter', () => {
    const view = model!.views[0]!;
    const png = renderPng(renderSvg(layoutView(model!, view), { icons }), { scale: 1 }).bytes;
    expect(png.length).toBeGreaterThan(5000);
    expect(png[0]).toBe(0x89);
  });

  test('dark theme swaps the canvas', () => {
    const view = model!.views[0]!;
    const svg = renderSvg(layoutView(model!, view), { icons, theme: 'dark' });
    expect(svg).toContain('data-theme="dark"');
    expect(svg).toContain(`fill="${THEMES.dark.canvas}"`);
  });

  test('icon source resolves aliases and lists packs', () => {
    expect(icons.has('azure/aks')).toBe(true);
    expect(icons.has('generic/database')).toBe(true);
    expect(icons.has('nope/nothing')).toBe(false);
    expect(icons.list('k8s').length).toBeGreaterThan(20);
    const { body, viewBox } = symbolBody('<svg xmlns="x" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M0 0"/></svg>');
    expect(viewBox).toBe('0 0 24 24');
    expect(body).toBe('<g fill="none" stroke="currentColor"><path d="M0 0"/></g>');
  });

  test('bundle has one entry per view with boxes, edges, metrics', () => {
    const bundle = buildBundle(model!, { icons, embedFonts: false }) as { views: { id: string; boxes: unknown[]; edges: unknown[]; metrics: { score: number }; steps?: unknown[] }[] };
    expect(bundle.views.map((v) => v.id)).toEqual(model!.views.map((v) => v.id));
    const tour = bundle.views.find((v) => v.id === 'tour')!;
    expect(tour.steps).toHaveLength(3);
    expect(tour.boxes.length).toBeGreaterThan(3);
  });
});

interface Picture {
  svg: string;
  width: number;
  height: number;
  boxes: { id: string; kind: string; parentId?: string; facts?: { label: string; value: string }[]; bullets?: string[]; value?: string; note?: string }[];
  edges: { id: string; pathIds?: string[] }[];
}
interface TestView extends Picture {
  id: string;
  kind: string;
  detail?: number;
  depths?: number[];
  paths?: { id: string; color: string; steps: { from: string; to: string; badge: string; edgeId?: string; text?: string }[] }[];
  annotations?: { text: string; at?: string }[];
}

describe('bundle', () => {
  const { model } = loadModelFromFile(harbor);
  const bundle = buildBundle(model!, { embedFonts: false }) as { views: TestView[]; kit?: { views: { id: string }[]; nodes: { id: string }[] } };
  const view = (id: string): TestView => bundle.views.find((v) => v.id === id)!;

  test('the kit holds every relation view and every node, so the viewer can lay out any of them', () => {
    const relation = model!.views.filter((v) => v.kind === 'relation').map((v) => v.id);
    expect(bundle.kit?.views.map((v) => v.id)).toEqual(relation);
    expect(bundle.kit?.nodes.length).toBe(model!.nodes.size);
  });

  test('a relation view names the depths that change it, the authored one among them', () => {
    const ctx = view('context');
    expect(ctx.detail).toBe(0);
    expect(ctx.depths).toEqual([0, 1]);
    expect(view('subscriptions').depths).toBeUndefined();
  });

  test('paths resolve every step to a drawn edge that claims the path', () => {
    const access = view('access');
    expect(access.paths).toHaveLength(3);
    for (const p of access.paths!) {
      for (const s of p.steps) {
        expect(s.edgeId).toBeDefined();
        expect(access.edges.find((e) => e.id === s.edgeId)?.pathIds).toContain(p.id);
      }
    }
    expect(view('legacy-redirect').paths![0]!.steps.every((s) => s.text !== undefined)).toBe(true);
  });

  test('boxes carry facts, bullets, value, and note; views carry annotations', () => {
    const subs = view('subscriptions');
    const prod = subs.boxes.find((b) => b.id === 'prod-sub')!;
    expect(prod.facts?.some((f) => f.label === 'Cost center')).toBe(true);
    expect(view('context').annotations?.some((a) => a.at === 'pier9')).toBe(true);
    const all = bundle.views.flatMap((v) => v.boxes);
    expect(all.some((b) => b.bullets && b.bullets.length > 0)).toBe(true);
    expect(all.some((b) => b.note !== undefined)).toBe(true);
    expect(all.some((b) => b.value !== undefined)).toBe(true);
  });
});

/** WCAG relative luminance and contrast ratio for 6 digit hex colors. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('theme contrast', () => {
  const AA = 4.5;
  for (const theme of [THEMES.light, THEMES.dark]) {
    test(`${theme.name}: family text reads on its fills`, () => {
      for (const [name, f] of Object.entries(theme.families)) {
        expect(contrast(f.text, f.fill), `${name} text on fill`).toBeGreaterThanOrEqual(AA);
        expect(contrast(f.text, f.soft), `${name} text on soft`).toBeGreaterThanOrEqual(AA);
      }
    });
    test(`${theme.name}: ink, muted, and titles read on containers, lanes, and the canvas`, () => {
      const surfaces = [...theme.containerFills, theme.lane, theme.laneAlt, theme.canvas, theme.labelHalo];
      for (const s of surfaces) {
        expect(contrast(theme.ink, s), `ink on ${s}`).toBeGreaterThanOrEqual(AA);
        expect(contrast(theme.muted, s), `muted on ${s}`).toBeGreaterThanOrEqual(AA);
        expect(contrast(theme.containerTitle, s), `title on ${s}`).toBeGreaterThanOrEqual(AA);
      }
    });
  }
});

describe('title block', () => {
  const { model } = loadModelFromFile(shop);
  test('adds a header band and grows the svg by its height', () => {
    const layout = layoutView(model!, model!.views[0]!);
    const plain = renderSvg(layout);
    const block = { title: 'Shop', subtitle: 'Context', author: 'Platform team', updated: '2026-10-01', version: '1.2.0', link: 'https://example.com/shop', published: '2026-10-28' };
    const svg = renderSvg(layout, { titleBlock: block });
    expect(plain).toContain(`height="${layout.height}"`);
    expect(svg).toContain(`height="${layout.height + titleBlockHeight(block)}"`);
    expect(svg).toContain('class="v-title-block"');
    expect(svg).toContain('>Shop</text>');
    expect(svg).toContain('published 2026-10-28');
    expect(svg).toContain('<a href="https://example.com/shop">');
    expect(svg).toContain(`<g class="v-root" transform="translate(0,${titleBlockHeight(block)})">`);
  });
  test('an empty block adds nothing', () => {
    expect(titleBlockHeight({})).toBe(0);
    const layout = layoutView(model!, model!.views[0]!);
    expect(renderSvg(layout, { titleBlock: {} })).toBe(renderSvg(layout));
  });
});

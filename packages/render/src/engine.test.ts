import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { loadModelFromFile } from '@vantage/model';
import { layoutView, openedView } from '@vantage/layout';
import { buildBundle, bundleDraw, kitForView } from './bundle.ts';
import { Engine, type LayoutKit, type PictureRequest } from './engine.ts';
import { picture } from './picture.ts';

const harbor = join(import.meta.dir, '..', '..', '..', 'examples', 'harbor', 'harbor.vantage.yaml');

interface Pic {
  readonly svg: string;
  readonly boxes: readonly { readonly id: string; readonly kind: string; readonly parentId?: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number }[];
}

describe('layout engine', () => {
  const { model } = loadModelFromFile(harbor);
  const bundle = buildBundle(model!, { embedFonts: false }) as { kit: LayoutKit; views: (Pic & { id: string })[] };
  // The kit crosses to the browser as JSON, so the engine is built from a copy that went through it.
  const engine = new Engine(JSON.parse(JSON.stringify(bundle.kit)) as LayoutKit);
  const base = bundle.views.find((v) => v.id === 'subscriptions')!;
  const anchors = base.boxes.map((b): [string, number, number] => [b.id, b.x + b.w / 2, b.y + b.h / 2]);
  const draw = (req: PictureRequest): Pic => engine.picture(req) as unknown as Pic;
  const kind = (p: Pic, id: string): string | undefined => p.boxes.find((b) => b.id === id)?.kind;

  test('a zoom is the picture the server draws for the opened view, to the byte', () => {
    const view = model!.views.find((v) => v.id === 'subscriptions')!;
    if (view.kind !== 'relation') throw new Error('expected a relation view');
    const layout = layoutView(model!, openedView(model!, view, 'rg-prod-web'));
    const server = picture(layout, bundleDraw(model!)(layout));
    expect(engine.picture({ view: 'subscriptions', open: [], shut: [], zoom: 'rg-prod-web' })).toEqual(server);
  });

  test('groups open where they stand, side by side, and the rest stays as authored', () => {
    expect(kind(base, 'rg-prod-web')).toBe('collapsed');
    expect(kind(base, 'rg-test-web')).toBe('collapsed');
    const both = draw({ view: 'subscriptions', open: ['rg-prod-web', 'rg-test-web'], shut: [], anchors });
    expect(kind(both, 'rg-prod-web')).toBe('container');
    expect(kind(both, 'rg-test-web')).toBe('container');
    expect(both.boxes.some((b) => b.parentId === 'rg-prod-web')).toBe(true);
    expect(both.boxes.some((b) => b.parentId === 'rg-test-web')).toBe(true);
    // Unlike a zoom, nothing else folds.
    expect(kind(both, 'rg-prod-data')).toBe('collapsed');
    expect(kind(both, 'devtest-sub')).toBe('container');
  });

  test('a drawn group shuts where it stands', () => {
    const shut = draw({ view: 'subscriptions', open: [], shut: ['devtest-sub'], anchors });
    expect(kind(shut, 'devtest-sub')).toBe('collapsed');
    expect(shut.boxes.some((b) => b.id === 'rg-test-web')).toBe(false);
    expect(kind(shut, 'prod-sub')).toBe('container');
  });

  test('a zoom keeps what the reader opened inside it', () => {
    const zoomed = draw({ view: 'subscriptions', open: ['rg-prod-web', 'rg-test-web'], shut: [], zoom: 'prod-sub' });
    expect(kind(zoomed, 'rg-prod-web')).toBe('container');
    expect(kind(zoomed, 'devtest-sub')).toBe('collapsed');
  });

  test('a view the kit does not hold draws nothing', () => {
    expect(engine.picture({ view: 'nope', open: [], shut: [] })).toBeUndefined();
  });

  test('a kit for one view holds that view and the trees its boxes sit in, nothing else', () => {
    const one = kitForView(bundle.kit, 'network');
    expect(one.views.map((v) => v.id)).toEqual(['network']);
    const ids = new Set(one.nodes.map((n) => n.id));
    expect(ids.has('hub')).toBe(true);
    expect(one.nodes.length).toBeLessThan(bundle.kit.nodes.length);
    for (const n of one.nodes) if (n.parentId !== undefined) expect(ids.has(n.parentId)).toBe(true);
    expect(kitForView(bundle.kit, 'nope').nodes).toEqual([]);
  });
});

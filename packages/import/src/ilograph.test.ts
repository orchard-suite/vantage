import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadModelFromText } from '@vantage/model';
import { layoutView } from '@vantage/layout';
import { importDiagram, list } from './index.ts';
import { importIlograph } from './ilograph.ts';

const dir = join(import.meta.dir, '..', 'fixtures');
const read = (p: string): string | undefined => {
  try {
    return readFileSync(join(dir, p), 'utf8');
  } catch {
    return undefined;
  }
};
const icons: Record<string, string> = { 'Azure/Web/App Services.svg': 'azure/app-service', 'Azure/Databases/SQL Database.svg': 'azure/sql-database' };

describe('ilograph import', () => {
  const bytes = new Uint8Array(readFileSync(join(dir, 'shop.ilograph')));
  const r = importDiagram(bytes, { filename: 'shop.ilograph', readRelative: read, iconResolver: (h) => icons[h] });

  test('library resources become types and instances become typed nodes', () => {
    const types = r.document.types ?? {};
    expect(Object.keys(types).sort()).toEqual(['Lib.App', 'Lib.Cloud', 'Lib.Database', 'Lib.Gateway']);
    expect(types['Lib.App']!.icon).toBe('azure/app-service');
    expect(types['Lib.Database']!.color).toBe('emerald');
    const { model } = loadModelFromText(r.yaml);
    expect(model!.nodes.get('web')!.typeName).toBe('Lib.App');
    expect(model!.nodes.get('orders-db')!.style.plural).toBe(true);
    expect(model!.nodes.get('front-door')!.parentId).toBe('azure');
  });

  test('perspectives become views with extends, reparent, colors, and bracket expansion', () => {
    const { model, diagnostics } = loadModelFromText(r.yaml);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const ctx = model!.views.find((v) => v.id === 'context')!;
    if (ctx.kind !== 'relation') throw new Error();
    expect(ctx.question).toContain('Who uses the shop');
    expect(ctx.reparent).toEqual({ 'front-door': 'grp' });
    expect(ctx.relations.some((x) => x.from === 'shoppers' && x.to === 'front-door')).toBe(true);
    expect(ctx.relations.filter((x) => x.from === 'web').map((x) => x.to).sort()).toEqual(['health', 'orders']);
    expect(ctx.relations.find((x) => x.to === 'orders-db')!.color).toBe('amber');
    const base = model!.views.find((v) => v.id === 'base')!;
    expect(base.hidden).toBe(true);
    const l = layoutView(model!, ctx);
    expect(l.boxes.find((b) => b.id === 'front-door')!.parentId).toBe('grp');
  });

  test('sequences and walkthroughs come across', () => {
    const { model } = loadModelFromText(r.yaml);
    const seq = model!.views.find((v) => v.id === 'place-an-order')!;
    if (seq.kind !== 'sequence') throw new Error();
    expect(seq.steps[0]).toMatchObject({ from: 'shoppers', to: 'front-door', label: 'GET /' });
    expect(seq.steps[1]).toMatchObject({ from: 'front-door', to: 'web', reply: 'returns' });
    expect(seq.steps[2]).toMatchObject({ from: 'front-door', to: 'orders-db', kind: 'async' });
    expect(seq.steps[3]).toMatchObject({ opt: 'checkout' });
    const tour = model!.views.find((v) => v.id === 'context-tour')!;
    if (tour.kind !== 'walkthrough') throw new Error();
    expect(tour.steps[1]!.highlight).toEqual(['web', 'api']);
    expect(r.report.format).toBe('ilograph');
    expect(r.report.pages.length).toBe(3);
  });

  test('reference lists split on commas outside brackets and expand globs', () => {
    expect(list('a, b/[c, d]/e, f')).toEqual(['a', 'b/c/e', 'b/d/e', 'f']);
    expect(list('x/[*]')).toEqual(['x/*']);
  });

  test('a "::" path in a perspective name becomes the picker group and the leaf becomes the title', () => {
    const text = `resources:\n  - name: A\n  - name: B\nperspectives:\n  - name: Workloads::Identity::Code\n    relations:\n      - from: A\n        to: B\n`;
    const out = importIlograph(text, { filename: 'paths.ilograph' });
    const view = out.input.views![0]!;
    expect(view.title).toBe('Code');
    expect(view.group).toBe('Workloads / Identity');
    expect(view.hidden).toBeUndefined();
  });
});

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadModelFromFile } from '@vantage/model';
import { validate } from '@vantage/server';
import { observedFromFiles, observedTransform } from './observed.ts';

const root = join(import.meta.dir, '..', '..', '..', 'examples', 'shop');
const batch = join(root, 'live.batch.json');

describe('render --observed', () => {
  test('a file of batches builds one observed model', () => {
    const m = observedFromFiles([batch]);
    expect(Object.keys(m.entities)).toHaveLength(5);
    expect(Object.keys(m.items ?? {})).toHaveLength(8);
  });

  test('the transform lays open items over the bound boxes and marks old reports stale', () => {
    const model = loadModelFromFile(join(root, 'shop.vantage.yaml'), observedTransform([batch], 7, new Date('2026-11-06T04:00:00Z'))).model!;
    const api = model.nodes.get('orders-api');
    expect(api?.openItems?.map((i) => [i.kind, i.severity])).toEqual([['alert', 'critical'], ['issue', 'high']]);
    expect(model.nodes.get('web-app')?.openItems?.every((i) => i.stale)).toBe(true);
    expect(model.nodes.get('orders-api')?.facts.some((f) => f.label === 'repository')).toBe(true);
  });

  test('with no batches an observe block still adds its views, so a page may link them as on the hub', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vantage-observed-'));
    const file = join(dir, 'live.vantage.yaml');
    writeFileSync(file, ['title: Live', 'nodes:', '  - id: lab', '    name: The lab', '    observe: { source: orrery, types: [host], view: { title: Where it runs } }', 'views:', '  - { id: guide, kind: doc, title: Guide, text: "See [where it runs](view:lab-placement)." }', ''].join('\n'));
    expect(validate({ file }).diagnostics.some((d) => d.code === 'doc-unknown-target')).toBe(true);
    const v = validate({ file, transform: observedTransform([], 7) });
    expect(v.ok).toBe(true);
    expect(v.views.map((x) => x.id)).toContain('lab-placement');
  });
});

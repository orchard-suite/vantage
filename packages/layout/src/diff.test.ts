import { describe, expect, test } from 'bun:test';
import { loadModelFromText } from '@vantage/model';
import { layoutView } from './layout.ts';
import { diffLayouts } from './diff.ts';

const base = (extra: string, rel: string) => `
nodes:
  - { name: Web, type: web }
  - { name: API, type: api }
  - { name: DB, type: database }
${extra}
views:
  - id: v
    title: V
    relations:
      - { from: web, to: api, label: calls }
      ${rel}
`;

describe('visual diff', () => {
  test('reports appeared, vanished, and new arrows, and draws them', () => {
    const a = loadModelFromText(base('', '- { from: api, to: db, label: reads }')).model!;
    const b = loadModelFromText(base('  - { name: Cache, type: cache }', '- { from: api, to: cache, label: caches }')).model!;
    const d = diffLayouts(layoutView(a, a.views[0]!), layoutView(b, b.views[0]!));
    const kinds = d.changes.map((c) => c.kind).sort();
    expect(kinds).toContain('appeared');
    expect(kinds).toContain('vanished');
    expect(kinds).toContain('edge-appeared');
    expect(kinds).toContain('edge-vanished');
    expect(d.layout.extras!.some((e) => e.kind === 'highlight' && e.color === 'emerald')).toBe(true);
    expect(d.layout.extras!.some((e) => e.kind === 'text' && e.role === 'heading')).toBe(true);
    expect(d.layout.height).toBeGreaterThan(layoutView(b, b.views[0]!).height);
  });

  test('identical layouts report no changes', () => {
    const a = loadModelFromText(base('', '')).model!;
    const l = layoutView(a, a.views[0]!);
    expect(diffLayouts(l, l).changes).toEqual([]);
  });

  test('a new subtitle is a change, though nothing moved', () => {
    const a = loadModelFromText(base('', '- { from: api, to: db, label: reads }')).model!;
    const b = loadModelFromText(base('', '- { from: api, to: db, label: reads }').replace('{ name: DB, type: database }', '{ name: DB, type: database, subtitle: Postgres 17 }')).model!;
    const d = diffLayouts(layoutView(a, a.views[0]!), layoutView(b, b.views[0]!));
    expect(d.changes.map((c) => c.text)).toContain('DB now reads Postgres 17');
  });
});

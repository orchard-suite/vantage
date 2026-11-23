import { describe, expect, test } from 'bun:test';
import { loadModelFromText } from '@vantage/model';
import { layoutView } from './layout.ts';
import { driftLayout } from './drift.ts';

const doc = `
nodes:
  - name: Prod
    type: subscription
    bind: azure:subscription:1
    facts: ["Region: East US"]
    children:
      - { name: Web, type: app, bind: "azure:app:web" }
      - { name: API, type: api, bind: "azure:app:api" }
views:
  - id: v
    title: V
    relations: [{ from: web, to: api, label: calls }]
`;

describe('drift view', () => {
  test('frames missing and mismatched nodes, lists undeclared ones, and writes sentences', () => {
    const m = loadModelFromText(doc).model!;
    const base = layoutView(m, m.views[0]!);
    const d = driftLayout(base, [
      { kind: 'declared-not-observed', nodeId: 'api', bind: 'azure:app:api', missingSince: '2026-10-01T00:00:00Z' },
      { kind: 'fact-mismatch', nodeId: 'prod', label: 'Region', declared: 'East US', observed: 'West US 2' },
      { kind: 'observed-not-declared', containerId: 'prod', key: 'azure:app:worker', name: 'worker', type: 'app' },
    ]);
    expect(d.counts).toEqual({ missing: 1, undeclared: 1, mismatched: 1 });
    expect(d.sentences[0]).toContain('has not been observed since 2026-10-01');
    expect(d.sentences[1]).toContain('observed as West US 2');
    expect(d.sentences[2]).toContain('does not declare it');
    const hl = d.layout.extras!.filter((e) => e.kind === 'highlight');
    expect(hl.some((h) => h.kind === 'highlight' && h.color === 'red')).toBe(true);
    expect(hl.some((h) => h.kind === 'highlight' && h.color === 'amber')).toBe(true);
    expect(d.layout.extras!.filter((e) => e.kind === 'note').length).toBe(2);
    expect(d.layout.height).toBeGreaterThan(base.height);
  });

  test('no drift says so', () => {
    const m = loadModelFromText(doc).model!;
    const d = driftLayout(layoutView(m, m.views[0]!), []);
    expect(d.sentences).toEqual([]);
    expect(d.layout.extras!.some((e) => e.kind === 'text' && e.text.lines[0]!.startsWith('The document agrees'))).toBe(true);
  });
});

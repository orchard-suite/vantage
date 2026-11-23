import { describe, expect, test } from 'bun:test';
import { DocumentSchema, resolveModel } from '@vantage/model';
import type { Batch } from './batch.ts';
import { emptyObserved, mergeObserved } from './observed.ts';
import { drift, freshness, freshnessOf, overlayObserved } from './overlay.ts';

const t1 = '2026-10-20T10:00:00Z';
const batch: Batch = {
  source: 'kubectl',
  observed: t1,
  entities: [
    { id: 'namespace:relay', type: 'namespace', name: 'relay', facts: { phase: 'Active' } },
    { id: 'deployment:relay/relay', type: 'deployment', name: 'relay', parent: 'namespace:relay', subtitle: 'relay', facts: { replicas: 2, image: 'a:1', ready: 2 }, url: 'https://k8s.example.test/relay', description: 'from k8s' },
    { id: 'deployment:relay/worker', type: 'deployment', name: 'worker', parent: 'namespace:relay', facts: { replicas: 1 } },
    { id: 'secret:relay/tls', type: 'secret', name: 'tls', parent: 'namespace:relay', facts: {} },
    { id: 'deployment:other/x', type: 'deployment', name: 'x', parent: 'namespace:other', facts: {} },
  ],
  relations: [],
};
const model = mergeObserved(emptyObserved(), batch).model;

const doc = DocumentSchema.parse({
  title: 'Relay',
  nodes: [
    {
      id: 'ns',
      name: 'Relay namespace',
      bind: 'kubectl:namespace:relay',
      children: [
        { id: 'relay', name: 'Relay', type: 'service', bind: 'kubectl:deployment:relay/relay', facts: ['replicas: 3', 'owner: platform'], url: 'https://author.example.test' },
        { id: 'ghost', name: 'Ghost', bind: 'kubectl:deployment:relay/ghost' },
        { id: 'plain', name: 'Plain', subtitle: 'typed by hand' },
      ],
    },
    { id: 'tls', name: 'TLS secret', bind: 'kubectl:secret:relay/tls' },
  ],
});

describe('overlayObserved', () => {
  const out = overlayObserved(doc, model);
  const ns = out.nodes[0];
  const relay = ns?.children?.[0];

  test('fills facts the author did not write, keeps the author facts and url, fills subtitle and description, and sets provenance', () => {
    expect(relay?.facts).toEqual([
      { label: 'replicas', value: '3' },
      { label: 'owner', value: 'platform' },
      { label: 'image', value: 'a:1' },
      { label: 'ready', value: '2' },
    ]);
    expect(relay?.url).toBe('https://author.example.test');
    expect(relay?.subtitle).toBe('relay');
    expect(relay?.description).toBe('from k8s');
    expect(relay?.provenance).toEqual({ source: 'kubectl', sourceId: 'deployment:relay/relay', observed: t1, url: 'https://k8s.example.test/relay' });
    expect(ns?.provenance?.sourceId).toBe('namespace:relay');
  });

  test('leaves unbound and unmatched nodes alone and does not mutate the input', () => {
    expect(ns?.children?.[2]).toEqual(doc.nodes[0]?.children?.[2]);
    expect(ns?.children?.[1]?.provenance).toBeUndefined();
    expect(doc.nodes[0]?.children?.[0]?.provenance).toBeUndefined();
    expect(doc.nodes[0]?.children?.[0]?.facts).toHaveLength(2);
  });

  test('an untyped bound node takes the icon its source type matches; a typed one keeps its type icon', () => {
    expect(ns?.icon).toBe('k8s/ns');
    expect(out.nodes[1]?.icon).toBe('k8s/secret');
    expect(relay?.icon).toBeUndefined();
    expect(ns?.children?.[1]?.icon).toBeUndefined();
  });

  test('the overlaid document still resolves to a model carrying provenance', () => {
    const resolved = resolveModel(out);
    expect(resolved.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(resolved.nodes.get('relay')?.provenance?.source).toBe('kubectl');
    expect(resolved.nodes.get('relay')?.bind).toBe('kubectl:deployment:relay/relay');
  });
});

describe('freshness', () => {
  test('grades by age and missing state', () => {
    const now = new Date('2026-10-28T10:00:00Z');
    const graded = freshness(model, now, 7);
    expect(graded['kubectl:deployment:relay/relay']).toBe('stale');
    expect(freshness(model, now, 9)['kubectl:deployment:relay/relay']).toBe('fresh');
    const gone = mergeObserved(model, { source: 'kubectl', observed: '2026-10-27T10:00:00Z', entities: [], relations: [] }).model;
    expect(freshnessOf(gone.entities['kubectl:namespace:relay']!, now, 30)).toBe('missing');
  });
});

describe('drift', () => {
  test('reports declared but unobserved, observed but undeclared inside bound containers, and fact mismatches', () => {
    const d = drift(doc, model);
    expect(d.counts).toEqual({ declaredNotObserved: 1, observedNotDeclared: 1, factMismatch: 1 });
    expect(d.items).toContainEqual({ kind: 'declared-not-observed', nodeId: 'ghost', bind: 'kubectl:deployment:relay/ghost' });
    expect(d.items).toContainEqual({ kind: 'observed-not-declared', containerId: 'ns', containerBind: 'kubectl:namespace:relay', key: 'kubectl:deployment:relay/worker', name: 'worker', type: 'deployment' });
    expect(d.items).toContainEqual({ kind: 'fact-mismatch', nodeId: 'relay', bind: 'kubectl:deployment:relay/relay', label: 'replicas', declared: '3', observed: '2' });
    expect(d.items.some((i) => i.kind === 'observed-not-declared' && i.key === 'kubectl:secret:relay/tls')).toBe(false);
    expect(d.items.some((i) => i.kind === 'observed-not-declared' && i.key === 'kubectl:deployment:other/x')).toBe(false);
  });

  test('an entity that went missing is reported with when', () => {
    const gone = mergeObserved(model, { source: 'kubectl', observed: '2026-10-27T10:00:00Z', entities: batch.entities.filter((e) => e.id !== 'secret:relay/tls'), relations: [] }).model;
    const d = drift(doc, gone);
    expect(d.items).toContainEqual({ kind: 'declared-not-observed', nodeId: 'tls', bind: 'kubectl:secret:relay/tls', missingSince: '2026-10-27T10:00:00Z' });
  });
});

describe('display facts', () => {
  const shown = mergeObserved(emptyObserved(), {
    source: 'orrery',
    observed: t1,
    entities: [
      {
        id: 'app:auth',
        type: 'app',
        name: 'auth',
        facts: { cost_last_month_cents: 115207, region: 'eastus', health: 'green' },
        display: [
          { fact: 'cost_last_month_cents', label: 'Cost last month', value: '$1,152' },
          { fact: 'region', label: 'Region', value: 'eastus' },
          { fact: 'health', label: 'Health', value: 'green' },
        ],
      },
    ],
    relations: [],
  }).model;
  const bound = (facts: string[]) => DocumentSchema.parse({ title: 'Shop', nodes: [{ id: 'auth', name: 'Auth', bind: 'orrery:app:auth', facts }] });

  test('a bound box shows the source labels and values in its order, not the raw keys', () => {
    expect(overlayObserved(bound([]), shown).nodes[0]?.facts).toEqual([
      { label: 'Cost last month', value: '$1,152' },
      { label: 'Region', value: 'eastus' },
      { label: 'Health', value: 'green' },
    ]);
  });

  test('an author fact wins over the observed one it names, by key or by label', () => {
    const facts = overlayObserved(bound(['region: westus', 'Health: fine']), shown).nodes[0]?.facts;
    expect(facts).toEqual([
      { label: 'region', value: 'westus' },
      { label: 'Health', value: 'fine' },
      { label: 'Cost last month', value: '$1,152' },
    ]);
  });

  test('drift compares a declared fact by its key, or by the label the source shows it under', () => {
    const d = drift(bound(['region: westus', 'Cost last month: $1,152', 'Health: amber']), shown);
    expect(d.items.filter((i) => i.kind === 'fact-mismatch')).toEqual([
      { kind: 'fact-mismatch', nodeId: 'auth', bind: 'orrery:app:auth', label: 'region', declared: 'westus', observed: 'eastus' },
      { kind: 'fact-mismatch', nodeId: 'auth', bind: 'orrery:app:auth', label: 'Health', declared: 'amber', observed: 'green' },
    ]);
  });
});


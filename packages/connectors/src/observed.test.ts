import { describe, expect, test } from 'bun:test';
import type { Batch } from './batch.ts';
import { memoryLogger } from './connector.ts';
import { emptyObserved, mergeObserved, presentEntities } from './observed.ts';

const t1 = '2026-10-28T10:00:00Z';
const t2 = '2026-10-29T10:00:00Z';
const t3 = '2026-10-30T10:00:00Z';

const first: Batch = {
  source: 'kubectl',
  observed: t1,
  entities: [
    { id: 'deployment:relay/relay', type: 'deployment', name: 'relay', parent: 'namespace:relay', facts: { replicas: 2, image: 'a:1' }, url: 'https://k8s.example.test/relay' },
    { id: 'service:relay/relay', type: 'service', name: 'relay', parent: 'namespace:relay', facts: {} },
  ],
  relations: [{ from: 'service:relay/relay', to: 'deployment:relay/relay', label: 'routes to', kind: 'sync' }],
};

describe('mergeObserved', () => {
  test('a full batch drops what went missing longer ago than the retention, and keeps what went missing since', () => {
    const service = first.entities[1]!;
    const { model: m1 } = mergeObserved(emptyObserved(), first);
    const { model: m2 } = mergeObserved(m1, { ...first, observed: t2, entities: [service], relations: [] }, undefined, { retainMissingDays: 1 });
    expect(m2.entities['kubectl:deployment:relay/relay']?.missingSince).toBe(t2);
    const { model: m3 } = mergeObserved(m2, { ...first, observed: t3, entities: [service], relations: [] }, undefined, { retainMissingDays: 1 });
    expect(m3.entities['kubectl:deployment:relay/relay']?.missingSince).toBe(t2);
    const later = '2026-10-31T10:00:01Z';
    const { model: m4 } = mergeObserved(m3, { ...first, observed: later, entities: [service], relations: [] }, undefined, { retainMissingDays: 1 });
    expect(Object.keys(m4.entities)).toEqual(['kubectl:service:relay/relay']);
    expect(Object.keys(m4.relations)).toEqual([]);
    const { model: partial } = mergeObserved(m3, { ...first, observed: later, entities: [], relations: [], partial: true }, undefined, { retainMissingDays: 1 });
    expect(Object.keys(partial.entities).length).toBe(2);
  });

  test('first batch: everything appears with provenance and timestamps', () => {
    const log = memoryLogger();
    const { model, changes } = mergeObserved(emptyObserved(), first, log);
    expect(changes.appeared).toEqual(['kubectl:deployment:relay/relay', 'kubectl:service:relay/relay']);
    expect(changes.vanished).toEqual([]);
    expect(changes.relations.appeared).toEqual(['kubectl:service:relay/relay>deployment:relay/relay#routes to#sync']);
    const relay = model.entities['kubectl:deployment:relay/relay'];
    expect(relay).toMatchObject({ source: 'kubectl', id: 'deployment:relay/relay', firstObserved: t1, observed: t1, provenance: { source: 'kubectl', sourceId: 'deployment:relay/relay', observed: t1, url: 'https://k8s.example.test/relay' } });
    expect(relay?.missingSince).toBeUndefined();
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
    expect(log.records.find((r) => r.message === 'observed merge')?.fields).toMatchObject({ appeared: 2, entitiesAfter: 2, relationsAppeared: 1 });
  });

  test('a full batch marks what it left out as missing and reports fact and field changes', () => {
    const { model: m1 } = mergeObserved(emptyObserved(), first);
    const second: Batch = { ...first, observed: t2, entities: [{ ...first.entities[0]!, name: 'relay-v2', facts: { replicas: 3, image: 'a:1', strategy: 'RollingUpdate' } }], relations: [] };
    const { model: m2, changes } = mergeObserved(m1, second);
    expect(changes.appeared).toEqual([]);
    expect(changes.vanished).toEqual(['kubectl:service:relay/relay']);
    expect(changes.relations.vanished).toHaveLength(1);
    expect(changes.facts).toEqual([
      { key: 'kubectl:deployment:relay/relay', fact: 'replicas', before: 2, after: 3 },
      { key: 'kubectl:deployment:relay/relay', fact: 'strategy', before: undefined, after: 'RollingUpdate' },
    ]);
    expect(changes.fields).toEqual([{ key: 'kubectl:deployment:relay/relay', field: 'name', before: 'relay', after: 'relay-v2' }]);
    expect(m2.entities['kubectl:service:relay/relay']?.missingSince).toBe(t2);
    expect(m2.entities['kubectl:deployment:relay/relay']).toMatchObject({ firstObserved: t1, observed: t2 });
    expect(m1.entities['kubectl:service:relay/relay']?.missingSince).toBeUndefined();
  });

  test('a partial batch never marks anything missing; a returning entity is reported', () => {
    const { model: m1 } = mergeObserved(emptyObserved(), first);
    const { model: m2 } = mergeObserved(m1, { ...first, observed: t2, entities: [first.entities[0]!], relations: [] });
    expect(m2.entities['kubectl:service:relay/relay']?.missingSince).toBe(t2);
    const { model: m3, changes: c3 } = mergeObserved(m2, { source: 'kubectl', observed: t3, partial: true, entities: [first.entities[1]!], relations: [] });
    expect(c3.returned).toEqual(['kubectl:service:relay/relay']);
    expect(c3.vanished).toEqual([]);
    expect(m3.entities['kubectl:service:relay/relay']?.missingSince).toBeUndefined();
    expect(m3.entities['kubectl:deployment:relay/relay']?.observed).toBe(t2);
    expect(presentEntities(m2, 'kubectl').map((e) => e.id)).toEqual(['deployment:relay/relay']);
  });

  test('other sources are untouched by a full batch', () => {
    const { model: m1 } = mergeObserved(emptyObserved(), first);
    const { model: m2, changes } = mergeObserved(m1, { source: 'cloudflare', observed: t2, entities: [{ id: 'zone:1', type: 'zone', name: 'example.test' }], relations: [] });
    expect(changes.vanished).toEqual([]);
    expect(Object.keys(m2.entities).sort()).toEqual(['cloudflare:zone:1', 'kubectl:deployment:relay/relay', 'kubectl:service:relay/relay']);
    expect(m2.entities['kubectl:service:relay/relay']?.missingSince).toBeUndefined();
  });
});

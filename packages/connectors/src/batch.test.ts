import { describe, expect, test } from 'bun:test';
import { BatchSchema, batchJsonSchema, entityKey, mergeBatches, relationKey } from './batch.ts';

const spec = {
  source: 'orrery',
  observed: '2026-10-28T10:00:00Z',
  entities: [
    { id: 'k8s-deployment:relay', type: 'workload', name: 'Relay', parent: 'k8s-namespace:relay', facts: { image: 'ghcr.example.test/relay:1.4.2', replicas: 1 }, url: 'https://hub.example.test/e/k8s-deployment:relay', tags: ['workload'] },
  ],
  relations: [{ from: 'k8s-deployment:relay', to: 'k8s-service:relay', label: 'serves through', kind: 'sync' }],
};

describe('batch schema', () => {
  test('accepts the push shape from the spec', () => {
    const b = BatchSchema.parse(spec);
    expect(b.entities[0]?.facts).toEqual({ image: 'ghcr.example.test/relay:1.4.2', replicas: 1 });
    expect(b.relations[0]?.kind).toBe('sync');
  });

  test('rejects unknown fields, bad timestamps, and unknown kinds', () => {
    expect(BatchSchema.safeParse({ ...spec, extra: 1 }).success).toBe(false);
    expect(BatchSchema.safeParse({ ...spec, observed: 'yesterday' }).success).toBe(false);
    expect(BatchSchema.safeParse({ ...spec, relations: [{ from: 'a', to: 'b', kind: 'teleport' }] }).success).toBe(false);
    expect(BatchSchema.safeParse({ ...spec, entities: [{ id: 'a', type: 't', name: 'n', facts: { nested: { deep: [1, 'x', null] } } }] }).success).toBe(true);
  });

  test('exports JSON Schema', () => {
    const js = batchJsonSchema();
    expect(js.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(JSON.stringify(js)).toContain('"entities"');
  });

  test('keys and mergeBatches', () => {
    expect(entityKey('orrery', 'a:b')).toBe('orrery:a:b');
    expect(relationKey('s', { from: 'a', to: 'b', label: 'x' })).toBe('s:a>b#x#');
    const merged = mergeBatches(
      [
        { source: 's', observed: '2026-10-28T10:00:00Z', partial: true, entities: [{ id: 'a', type: 't', name: 'A' }], relations: [{ from: 'a', to: 'b' }] },
        { source: 's', observed: '2026-10-28T10:00:01Z', partial: true, entities: [{ id: 'a', type: 't', name: 'A2' }, { id: 'b', type: 't', name: 'B' }], relations: [{ from: 'a', to: 'b' }] },
      ],
      '2026-10-28T10:00:02Z',
    );
    expect(merged.partial).toBeUndefined();
    expect(merged.entities.map((e) => e.name)).toEqual(['A2', 'B']);
    expect(merged.relations).toHaveLength(1);
    expect(() => mergeBatches([{ ...merged, source: 'x' }, merged], '2026-10-28T10:00:02Z')).toThrow('sources differ');
  });
});

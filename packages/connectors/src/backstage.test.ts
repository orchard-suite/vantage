import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { backstageJsonSchema, convertBackstage, normalizeRef } from './backstage.ts';

const catalog = JSON.parse(readFileSync(`${import.meta.dir}/fixtures/backstage-catalog.json`, 'utf8')) as unknown;

describe('backstage conversion', () => {
  const { batch, warnings } = convertBackstage(catalog, 'backstage', '2026-10-28T10:00:00Z');
  const byId = new Map(batch.entities.map((e) => [e.id, e]));
  const pairs = (label: string) => batch.relations.filter((r) => r.label === label).map((r) => `${r.from}>${r.to}`).sort();

  test('ids are entity refs; kind and spec.type become the source type', () => {
    expect(warnings).toEqual([]);
    expect(batch.source).toBe('backstage');
    expect(byId.get('component:default/checkout')).toMatchObject({ type: 'component:service', name: 'Checkout', subtitle: 'checkout', parent: 'system:default/shop', url: 'https://docs.example.test/checkout', tags: ['go', 'critical'], description: 'Takes payment' });
    expect(byId.get('system:default/shop')).toMatchObject({ type: 'system', parent: 'domain:default/commerce' });
    expect(byId.get('user:default/oncall-bot')?.type).toBe('user');
    expect(byId.get('component:default/checkout-worker')?.parent).toBe('component:default/checkout');
  });

  test('annotations, labels, and well-known spec fields become facts', () => {
    expect(byId.get('component:default/checkout')?.facts).toEqual({
      'backstage.io/source-location': 'url:https://git.example.test/org/checkout',
      'pagerduty.com/service-id': 'P1',
      'label.tier': '1',
      type: 'service',
      lifecycle: 'production',
      owner: 'group:default/payments',
      system: 'shop',
    });
    expect(byId.get('api:default/checkout-api')?.facts?.definition).toBeUndefined();
    expect(byId.get('group:default/platform')?.facts).toEqual({ type: 'team', children: ['payments'] });
  });

  test('spec lists and the relations block become arrows; inverse types flip and duplicates fold', () => {
    expect(pairs('depends on')).toEqual(['component:default/checkout>component:default/ledger', 'component:default/checkout>resource:default/orders-db', 'component:default/storefront>component:default/checkout']);
    expect(pairs('provides')).toEqual(['component:default/checkout>api:default/checkout-api', 'component:default/ledger>api:default/ledger-api']);
    expect(pairs('consumes')).toEqual(['component:default/checkout>api:default/ledger-api', 'component:default/storefront>api:default/checkout-api']);
    expect(pairs('owned by').filter((p) => p.startsWith('component:default/checkout>'))).toEqual(['component:default/checkout>group:default/payments']);
    expect(pairs('part of')).toContain('component:default/checkout>system:default/shop');
    expect(pairs('part of')).toContain('system:default/shop>domain:default/commerce');
    expect(pairs('part of')).toContain('component:default/checkout-worker>component:default/checkout');
  });

  test('normalizeRef fills kind and namespace', () => {
    expect(normalizeRef('ledger', 'component')).toBe('component:default/ledger');
    expect(normalizeRef('API:Team/Ledger-API', 'component')).toBe('api:team/ledger-api');
    expect(normalizeRef('resource:orders-db', 'component', 'shop')).toBe('resource:shop/orders-db');
  });

  test('a single document and duplicates', () => {
    const one = convertBackstage({ apiVersion: 'backstage.io/v1alpha1', kind: 'Component', metadata: { name: 'solo' }, spec: { type: 'library' } }, 's', '2026-10-28T10:00:00Z');
    expect(one.batch.entities).toHaveLength(1);
    expect(one.batch.relations).toEqual([]);
    const dup = convertBackstage([one.batch.entities[0] && { apiVersion: 'backstage.io/v1alpha1', kind: 'Component', metadata: { name: 'solo' } }, { apiVersion: 'backstage.io/v1alpha1', kind: 'Component', metadata: { name: 'solo', title: 'Second' } }], 's', '2026-10-28T10:00:00Z');
    expect(dup.warnings).toEqual(['duplicate entity component:default/solo; the later document wins']);
    expect(dup.batch.entities.map((e) => e.name)).toEqual(['Second']);
    expect(() => convertBackstage({ apiVersion: 'backstage.io/v1beta9', kind: 'Component', metadata: { name: 'x' } }, 's', '2026-10-28T10:00:00Z')).toThrow();
  });

  test('exports JSON Schema', () => {
    expect(JSON.stringify(backstageJsonSchema())).toContain('backstage.io/v1alpha1');
  });
});

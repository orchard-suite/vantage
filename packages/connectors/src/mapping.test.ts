import { describe, expect, test } from 'bun:test';
import type { Batch } from './batch.ts';
import { memoryLogger } from './connector.ts';
import { applyMapping, MappingSchema, mappingJsonSchema } from './mapping.ts';

const batch: Batch = {
  source: 'azure-resource-graph',
  observed: '2026-10-28T10:00:00Z',
  entities: [
    { id: 'app', type: 'microsoft.web/sites', name: 'app-shop', facts: { location: 'eastus2', subscriptionId: 'sub-1', resourceGroup: 'rg-web', sku: { name: 'P1v3' }, tags: { env: 'prod' } } },
    { id: 'db', type: 'microsoft.sql/servers/databases', name: 'shopdb', parent: 'given', facts: { location: 'eastus2', sku: { name: 'GP_S_Gen5' } } },
    { id: 'lock', type: 'microsoft.authorization/locks', name: 'do-not-delete', facts: {} },
    { id: 'odd', type: 'microsoft.unknown/things', name: 'thing', facts: { location: 'westus' } },
  ],
  relations: [
    { from: 'app', to: 'db', label: 'reads' },
    { from: 'lock', to: 'app', label: 'locks' },
  ],
};

const mapping = MappingSchema.parse({
  source: 'azure-resource-graph',
  profile: 'infra',
  types: { 'microsoft.web/sites': 'app', 'microsoft.sql/servers/databases': 'database' },
  facts: { location: 'Region', 'sku.name': 'SKU', 'tags.env': 'Environment' },
  parent: { resourceGroup: 'azure:resourcegroup:{subscriptionId}/{resourceGroup}', subscription: 'azure:subscription:{{subscriptionId}}' },
  drop: ['microsoft.authorization/locks'],
});

describe('applyMapping', () => {
  test('maps types, flattens facts to labels, fills parents, drops, and warns on unknown types', () => {
    const log = memoryLogger();
    const { batch: out, warnings } = applyMapping(batch, mapping, log);
    expect(out.entities.map((e) => `${e.id}:${e.type}`)).toEqual(['app:app', 'db:database', 'odd:microsoft.unknown/things']);
    expect(out.entities[0]).toMatchObject({ parent: 'azure:resourcegroup:sub-1/rg-web', facts: { Region: 'eastus2', SKU: 'P1v3', Environment: 'prod' } });
    expect(out.entities[1]).toMatchObject({ parent: 'given', facts: { Region: 'eastus2', SKU: 'GP_S_Gen5' } });
    expect(out.entities[2]?.parent).toBeUndefined();
    expect(out.relations).toEqual([{ from: 'app', to: 'db', label: 'reads' }]);
    expect(warnings).toEqual(['unknown type microsoft.unknown/things on 1 entities; passed through']);
    expect(log.records.filter((r) => r.level === 'warn')).toHaveLength(1);
    expect(log.records.find((r) => r.message === 'mapping applied')?.fields).toMatchObject({ entities: 3, dropped: 1, warnings: 1 });
  });

  test('name template and source mismatch', () => {
    const { batch: out, warnings } = applyMapping(batch, { ...mapping, source: 'other', name: '{{name}} ({{location}})', facts: undefined, parent: undefined, drop: [] }, undefined);
    expect(out.entities[0]?.name).toBe('app-shop (eastus2)');
    expect(out.entities[0]?.facts).toEqual(batch.entities[0]?.facts);
    expect(warnings[0]).toContain('mapping is for source other');
    expect(warnings).toContain('name template missing location on lock');
  });

  test('a vendor profile maps the source types its matches name, and the table still wins', () => {
    const { batch: out, warnings } = applyMapping(batch, MappingSchema.parse({ source: 'azure-resource-graph', profile: 'azure', types: { 'microsoft.sql/servers/databases': 'database' } }));
    expect(out.entities.map((e) => `${e.id}:${e.type}`)).toEqual(['app:appservice', 'db:database', 'lock:microsoft.authorization/locks', 'odd:microsoft.unknown/things']);
    expect(warnings).toHaveLength(2);
  });

  test('schema and JSON Schema', () => {
    expect(MappingSchema.safeParse({ source: 's', profile: 'p', nope: 1 }).success).toBe(false);
    expect(MappingSchema.parse({ source: 's', profile: 'p' })).toEqual({ source: 's', profile: 'p', types: {}, drop: [] });
    expect(JSON.stringify(mappingJsonSchema())).toContain('"profile"');
  });
});

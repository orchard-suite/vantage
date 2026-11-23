import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { OrreryBlueprintDef } from './display.ts';
import { foldEdges, OrreryEdgeSchema } from './edges.ts';
import type { OrreryEntity } from './entity.ts';

const read = <T>(name: string): T => JSON.parse(readFileSync(`${import.meta.dir}/fixtures/${name}`, 'utf8')) as T;
const records = read<{ entities: OrreryEntity[] }>('estate-entities-sw_connection.json').entities;
const defs = read<OrreryBlueprintDef>('estate-blueprint-sw_connection.json').fields ?? {};
const edge = OrreryEdgeSchema.parse({ from: ['app', 'gateway', 'service'], to: ['to_database', 'to_storage', 'to_app'], label: 'kind', health: 'health', unresolved: 'host' });

const auth = 'azure_app_service:/subscriptions/0000/resourcegroups/rg-shop-prod/providers/microsoft.web/sites/shop-auth-prod';
const web = 'azure_app_service:/subscriptions/0000/resourcegroups/rg-shop-prod/providers/microsoft.web/sites/shop-web-prod';
const db = 'azure_database:/subscriptions/0000/resourcegroups/rg-data/providers/microsoft.sql/servers/shop-sql/databases/shop-prod';

describe('orrery edges', () => {
  const folded = foldEdges('sw_connection', edge, records, ['evidence', 'setting_names', 'calls_7d'], defs, 'data');

  test('folds records between the same pair into one arrow that lists every evidence, setting name, and call count', () => {
    const arrow = folded.relations.find((r) => r.from === auth && r.to === db);
    expect(arrow).toEqual({ from: auth, to: db, label: 'sql', kind: 'data', tags: ['sw_connection'], description: 'Evidence: setting, telemetry. Setting names: SQL_CONNECTION. Calls in 7 days: 2,043.' });
  });

  test('starts at the first from relation with a target, so code evidence starts at its service', () => {
    expect(folded.relations.find((r) => r.from === 'service:auth')).toMatchObject({ to: db, description: 'Evidence: code. Setting names: ConnectionStrings:Shop, SQL_CONNECTION.' });
  });

  test('runs a record that reaches nothing, or is amber, to an unresolved stub named by its host', () => {
    expect(folded.relations.filter((r) => r.from === web).map((r) => [r.to, r.label])).toEqual([
      ['unresolved:kv-shop.vault.example.net', 'keyvault'],
      ['unresolved:legacy.example.net', 'http'],
    ]);
    expect(folded.entities).toEqual([
      { id: 'unresolved:legacy.example.net', type: 'unresolved', name: 'legacy.example.net', subtitle: 'unresolved', facts: { health: 'amber' }, tags: ['sw_connection', 'unresolved'], description: 'Nothing in the catalog matches what this reaches yet.' },
      { id: 'unresolved:kv-shop.vault.example.net', type: 'unresolved', name: 'kv-shop.vault.example.net', subtitle: 'unresolved', facts: { health: 'amber' }, tags: ['sw_connection', 'unresolved'], description: 'Nothing in the catalog matches what this reaches yet.' },
    ]);
  });

  test('leaves out a record with no from, and one that reaches only what the reader may not see, and counts them', () => {
    expect(folded.relations.some((r) => r.to.includes('hidden') || r.to.includes('secret.example.net'))).toBe(false);
    expect(folded.counts).toEqual({ records: 7, skipped: 2, arrows: 4, unresolved: 2 });
  });

  test('describes every field the records carry when none are named', () => {
    const all = foldEdges('sw_connection', edge, records.slice(0, 2), undefined, defs, undefined);
    expect(all.relations).toHaveLength(1);
    expect(all.relations[0]!.description).toBe('Host: shop-sql.database.example.net. Kind: sql. Evidence: setting, telemetry. Setting names: SQL_CONNECTION. Health: green. Calls in 7 days: 2,043.');
    expect(all.relations[0]!.kind).toBeUndefined();
  });
});

/**
 * Where the scope tree comes from, a setting of the organization
 * (VAN-3017): the hub, where authors keep it, or the catalog, where the
 * catalog connector named here reads the organization's own kinds and the
 * hub keeps a copy no edit changes.
 */
import { z } from 'zod';
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';

/** The core kinds of an organization's tree in the catalog, the default of what a catalog fill reads. */
export const CORE_KINDS = ['organization', 'department', 'team', 'program'] as const;

export const CatalogSettingSchema = z
  .object({
    connector: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'a connector is workspace/connector, such as platform/catalog').describe('The catalog connector that reads the tree, as workspace/connector'),
    kinds: z.array(z.string().min(1)).min(1).default([...CORE_KINDS]).describe("The kinds that are scopes, in the estate's own words"),
    steward: z.record(z.string(), z.string().min(1)).default({}).describe('Kind to the relation that names its steward, such as { team: lead }'),
    facets: z.string().min(1).default('facets').describe("The field that holds a scope's facets"),
  })
  .strict();

export type CatalogSetting = z.output<typeof CatalogSettingSchema>;

export type ScopeSetting = { readonly source: 'hub' } | { readonly source: 'catalog'; readonly catalog: CatalogSetting };

const StoredSchema = z.union([z.object({ source: z.literal('hub') }).strict(), z.object({ source: z.literal('catalog'), catalog: CatalogSettingSchema }).strict()]);

const KEY = 'scopes';

/** The organization's setting; an organization that never chose keeps its tree in the hub. */
export async function scopeSetting(db: Db, orgId: string): Promise<ScopeSetting> {
  const row = await maybe<{ settings: Record<string, unknown> }>(db, 'select settings from orgs where id = $1', [orgId]);
  const parsed = StoredSchema.safeParse(row?.settings[KEY]);
  return parsed.success ? parsed.data : { source: 'hub' };
}

export async function setScopeSetting(db: Db, orgId: string, setting: ScopeSetting): Promise<void> {
  await db.query('update orgs set settings = jsonb_set(settings, $2, $3::jsonb) where id = $1', [orgId, `{${KEY}}`, JSON.stringify(setting)]);
}

export const sameSetting = (a: ScopeSetting, b: ScopeSetting): boolean => JSON.stringify(a) === JSON.stringify(b);

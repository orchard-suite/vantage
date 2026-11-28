/**
 * The estate's settings for its standards (VAN-3018), a setting of the
 * organization: the binding words a line may use, who a line may bind,
 * whether a scope's own changes wait for its steward, the words that may
 * not leave the estate, the packs each scope adopts, the clash rule for
 * open conflicts, and the kind the hub files its checking into.
 */
import { z } from 'zod';
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { PackSchema } from './model.ts';

export const DEFAULT_BINDINGS = ['must', 'should', 'may'] as const;
export const DEFAULT_BINDS = ['people', 'agents', 'systems'] as const;
export const CLASH_RULES = ['hold', 'stricter', 'ranked'] as const;
export type ClashRule = (typeof CLASH_RULES)[number];

const Words = z.array(z.string().trim().min(1).max(40)).min(1).max(20);

export const StandardSettingSchema = z
  .object({
    bindings: Words.default([...DEFAULT_BINDINGS]).describe('The binding words a line may use'),
    binds: Words.default([...DEFAULT_BINDS]).describe('Who a line may bind'),
    steward_gate: z.boolean().default(false).describe("Whether a scope's own changes wait for its steward before they publish"),
    withhold: z.array(z.string().trim().min(2).max(120)).max(200).default([]).describe('Words that may not leave the estate; an edition that holds one is refused'),
    packs: z.record(z.string().min(1), z.array(PackSchema).max(50)).default({}).describe('Scope id, or estate, to the packs it adopts'),
    clash: z.enum(CLASH_RULES).default('hold').describe('What holds while a conflict waits for its ruling: hold (both lines, and the work that needs the ruling waits), stricter, or ranked'),
    ranked: z.array(z.string().trim().min(1).max(120)).max(50).default([]).describe('Scope ids in order, first wins, for clash: ranked'),
    checks: z.string().trim().toUpperCase().optional().describe('The kind, by prefix, the hub files its checking items into; with none it files nothing'),
  })
  .strict();

export type StandardSetting = z.output<typeof StandardSettingSchema>;

const KEY = 'standard';

/** The organization's setting; one that never chose has the defaults. */
export async function standardSetting(db: Db, orgId: string): Promise<StandardSetting> {
  const row = await maybe<{ settings: Record<string, unknown> }>(db, 'select settings from orgs where id = $1', [orgId]);
  const parsed = StandardSettingSchema.safeParse(row?.settings[KEY] ?? {});
  return parsed.success ? parsed.data : StandardSettingSchema.parse({});
}

export async function setStandardSetting(db: Db, orgId: string, setting: StandardSetting): Promise<void> {
  await db.query('update orgs set settings = jsonb_set(settings, $2, $3::jsonb) where id = $1', [orgId, `{${KEY}}`, JSON.stringify(setting)]);
}

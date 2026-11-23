/**
 * Language versioning. `vantage: N` names the version a document was written
 * for. Older documents are migrated forward before validation; newer ones
 * are refused with a clear message. Every breaking change adds a migration
 * here and bumps CURRENT_VERSION.
 */
export const CURRENT_VERSION = 1;

export interface Migration {
  readonly from: number;
  readonly to: number;
  readonly describe: string;
  readonly apply: (raw: Record<string, unknown>) => Record<string, unknown>;
}

/** Ordered oldest to newest. Empty until the first breaking change. */
export const MIGRATIONS: readonly Migration[] = [];

export interface MigrateResult {
  readonly raw: Record<string, unknown>;
  readonly from: number;
  readonly applied: readonly string[];
  readonly error?: string;
}

export function migrateDocument(raw: Record<string, unknown>): MigrateResult {
  const declared = raw['vantage'];
  const from = typeof declared === 'number' ? declared : CURRENT_VERSION;
  if (from > CURRENT_VERSION) {
    return { raw, from, applied: [], error: `this document is written for vantage ${from}; this engine understands up to ${CURRENT_VERSION}. Update Vantage.` };
  }
  let current = raw;
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (m.from < from) continue;
    current = { ...m.apply(current), vantage: m.to };
    applied.push(m.describe);
  }
  return { raw: current, from, applied };
}

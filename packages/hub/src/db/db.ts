/**
 * The one database interface the hub codes against. Postgres at runtime
 * and PGlite in tests both implement it; nothing else touches a driver.
 */
export type Row = Record<string, unknown>;

export interface Db {
  query<T extends object = Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  /** Runs a script of several statements with no parameters (migrations). */
  exec(text: string): Promise<void>;
  /** Runs `fn` in one transaction; the Db it receives is bound to that transaction. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  /** Subscribes to a NOTIFY channel; resolves to the unsubscribe function. */
  listen(channel: string, handler: (payload: string) => void): Promise<() => Promise<void>>;
  notify(channel: string, payload: string): Promise<void>;
  close(): Promise<void>;
}

/** Returns the first row or throws; for queries that must match. */
export async function one<T extends object>(db: Db, text: string, params: readonly unknown[] = []): Promise<T> {
  const rows = await db.query<T>(text, params);
  const row = rows[0];
  if (!row) throw new Error(`query returned no rows: ${text.slice(0, 80)}`);
  return row;
}

export async function maybe<T extends object>(db: Db, text: string, params: readonly unknown[] = []): Promise<T | undefined> {
  return (await db.query<T>(text, params))[0];
}

/** Channel names stay short, lower case (LISTEN folds identifiers), and safe. */
export function channelName(prefix: string, id: string): string {
  return `${prefix}_${id.replace(/[^a-zA-Z0-9_]/g, '_')}`.toLowerCase().slice(0, 63);
}

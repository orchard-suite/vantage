/**
 * Closes each test's databases when the test ends. An in-memory Postgres
 * holds about 250 MB, and a process holds about ninety before the next one
 * fails to start; left to the garbage collector, a run passes or fails by
 * when it collects. `test-hooks.ts`, which `bunfig.toml` preloads, opens and
 * closes a scope around every test. A database opened outside a test (in a
 * beforeAll, or in a script run outside the test runner) lives until the
 * process ends.
 */
interface Closable {
  close(): Promise<void>;
}

let scope: Closable[] | undefined;

/** Hands a test's database to the scope of the test that opened it. */
export function scoped<T extends Closable>(db: T): T {
  scope?.push(db);
  return db;
}

export function openScope(): void {
  scope = [];
}

export async function closeScope(): Promise<void> {
  const opened = scope ?? [];
  scope = undefined;
  await Promise.all(opened.map((db) => db.close().catch(() => undefined)));
}

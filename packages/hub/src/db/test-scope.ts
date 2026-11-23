/**
 * Closes each test's databases when the test ends. An in-memory Postgres
 * holds about 250 MB, and a process holds about ninety before the next one
 * fails to start; left to the garbage collector, a run passes or fails by
 * when it collects. `bunfig.toml` preloads this file, so its hooks wrap
 * every test. A database opened outside a test (in a beforeAll) lives until
 * the process ends.
 */
import { afterEach, beforeEach } from 'bun:test';

interface Closable {
  close(): Promise<void>;
}

let scope: Closable[] | undefined;

/** Hands a test's database to the scope of the test that opened it. */
export function scoped<T extends Closable>(db: T): T {
  scope?.push(db);
  return db;
}

beforeEach(() => {
  scope = [];
});

afterEach(async () => {
  const opened = scope ?? [];
  scope = undefined;
  await Promise.all(opened.map((db) => db.close().catch(() => undefined)));
});

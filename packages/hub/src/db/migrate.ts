/**
 * Numbered SQL migrations from packages/hub/migrations, applied in order
 * and recorded in schema_migrations. Idempotent: a second run applies
 * nothing and says so.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.ts';
import type { Logger } from '../log.ts';

export const MIGRATIONS_DIR = join(import.meta.dir, '..', '..', 'migrations');

export interface Migration {
  readonly name: string;
  readonly sql: string;
}

export function readMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

export async function migrate(db: Db, log: Logger, dir: string = MIGRATIONS_DIR): Promise<{ applied: string[]; skipped: number }> {
  log.info('migrate.start', { dir });
  // Every step takes the same transaction lock, so two processes migrating at once (two pods
  // starting, a release job and a stray init container) apply each migration exactly once.
  const lock = "select pg_advisory_xact_lock(hashtext('vantage.migrate'))";
  await db.transaction(async (tx) => {
    await tx.query(lock);
    await tx.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  });
  const applied: string[] = [];
  let skipped = 0;
  for (const m of readMigrations(dir)) {
    const ran = await db.transaction(async (tx) => {
      await tx.query(lock);
      if ((await tx.query('select 1 as x from schema_migrations where name = $1', [m.name])).length) return false;
      await tx.exec(m.sql);
      await tx.query('insert into schema_migrations (name) values ($1)', [m.name]);
      return true;
    });
    if (!ran) {
      skipped++;
      log.debug('migrate.skip', { name: m.name });
      continue;
    }
    applied.push(m.name);
    log.info('migrate.applied', { name: m.name });
  }
  log.info('migrate.end', { applied: applied.length, skipped });
  return { applied, skipped };
}

/** The migration that retires alignment moves what it said into the record's Context (VAN-3018). */
import { expect, test } from 'bun:test';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectPglite } from '../db/pglite.ts';
import { migrate, MIGRATIONS_DIR, readMigrations } from '../db/migrate.ts';
import { silentLogger } from '../log.ts';

test('a record that named an outside standard keeps it as the last paragraph of its Context', async () => {
  const before = mkdtempSync(join(tmpdir(), 'vantage-migrate-'));
  for (const m of readMigrations().filter((x) => x.name < '0038')) copyFileSync(join(MIGRATIONS_DIR, m.name), join(before, m.name));
  const db = connectPglite();
  await migrate(db, silentLogger, before);
  await db.query("insert into orgs (id, name, slug) values ('o', 'Acme', 'acme')");
  await db.query("insert into workspaces (id, org_id, kind, name, slug) values ('w', 'o', 'team', 'Shop', 'shop')");
  await db.query(`insert into decision_registries (id, org_id, workspace_id, prefix, name, categories) values ('r', 'o', 'w', 'SHOP', 'Shop', '[{"digit": 2, "name": "Security"}]')`);
  const row = (id: string, number: number, context: string, alignment: unknown) =>
    db.query("insert into decisions (id, org_id, registry_id, number, category, title, status, updated_on, context, alignment) values ($1, 'o', 'r', $2, 2, 'T', 'accepted', '2026-11-01', $3, $4)", [id, number, context, alignment === null ? null : JSON.stringify(alignment)]);
  await row('a', 2001, 'Two apps wrote orders.', { stance: 'departs', rule: 'R-12', note: 'one writer is enough' });
  await row('b', 2002, '', { stance: 'new-ground' });
  await row('c', 2003, 'Nothing to move.', null);
  await migrate(db, silentLogger);
  const got = await db.query<{ id: string; context: string; position: unknown }>('select id, context, position from decisions order by id');
  expect(got).toEqual([
    { id: 'a', context: 'Two apps wrote orders.\n\nStandard: departs from R-12: one writer is enough.', position: null },
    { id: 'b', context: 'Standard: new ground.', position: null },
    { id: 'c', context: 'Nothing to move.', position: null },
  ]);
  expect((await db.query("select 1 as x from information_schema.columns where table_name = 'decisions' and column_name = 'alignment'")).length).toBe(0);
  await db.close();
});

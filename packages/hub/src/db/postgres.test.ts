import { describe, expect, test } from 'bun:test';
import { connectPostgres } from './postgres.ts';
import { silentLogger } from '../log.ts';
import { migrate, readMigrations } from './migrate.ts';
import type { Db } from './db.ts';

const url = process.env['VANTAGE_TEST_DATABASE_URL'];

describe.if(Boolean(url))('postgres driver', () => {
  test('json text parameters land as objects, not double-encoded strings', async () => {
    const db = connectPostgres(url!, silentLogger);
    await db.exec('create temporary table if not exists t_json (payload jsonb)');
    await db.query('insert into t_json (payload) values ($1)', [JSON.stringify({ a: 1 })]);
    const rows = await db.query<{ payload: { a: number } }>('select payload from t_json');
    expect(rows[0]!.payload.a).toBe(1);
    const got: string[] = [];
    const un = await db.listen('t_json_chan', (p) => got.push(p));
    await db.notify('t_json_chan', 'x');
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toEqual(['x']);
    await un();
    await db.close();
  });

  test('a notify inside a transaction arrives once the transaction commits', async () => {
    const db = connectPostgres(url!, silentLogger);
    const got: string[] = [];
    const un = await db.listen('t_tx_chan', (p) => got.push(p));
    await db.transaction(async (tx) => {
      await tx.notify('t_tx_chan', 'committed');
      await new Promise((r) => setTimeout(r, 100));
      // A listener told now would look for rows this transaction has not committed.
      expect(got).toEqual([]);
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toEqual(['committed']);
    await un();
    await db.close();
  });

  test('a password source signs in every connection, the listener included', async () => {
    const admin = connectPostgres(url!, silentLogger);
    const role = `vantage_token_${Date.now().toString(36)}`;
    await admin.exec(`create role ${role} login password 'first-token'`);
    const target = new URL(url!);
    target.username = role;
    target.password = '';
    let asked = 0;
    const db = connectPostgres(target.toString(), silentLogger, { max: 2, password: async () => (asked++, 'first-token') });
    try {
      const rows = await db.query<{ who: string }>('select current_user as who');
      expect(rows[0]!.who).toBe(role);
      const got: string[] = [];
      const un = await db.listen('t_token_chan', (p) => got.push(p));
      await db.notify('t_token_chan', 'x');
      await new Promise((r) => setTimeout(r, 100));
      expect(got).toEqual(['x']);
      // The pool's connection and the listener's own connection each asked.
      expect(asked).toBeGreaterThanOrEqual(2);
      await un();
      const wrong = connectPostgres(target.toString(), silentLogger, { max: 1, password: async () => 'expired-token' });
      await expect(wrong.query('select 1')).rejects.toThrow();
      await wrong.close();
    } finally {
      await db.close();
      await admin.exec(`drop role ${role}`);
      await admin.close();
    }
  });

  test('two processes migrating one fresh database apply each migration exactly once', async () => {
    const admin = connectPostgres(url!, silentLogger);
    const name = `vantage_migrate_${Date.now().toString(36)}`;
    await admin.exec(`create database ${name}`);
    const target = new URL(url!);
    target.pathname = `/${name}`;
    const a = connectPostgres(target.toString(), silentLogger);
    const b = connectPostgres(target.toString(), silentLogger);
    try {
      const [ra, rb] = await Promise.all([migrate(a, silentLogger), migrate(b, silentLogger)]);
      const all = readMigrations().map((m) => m.name);
      expect([...ra.applied, ...rb.applied].sort()).toEqual(all);
      expect(ra.skipped + rb.skipped).toBe(all.length);
    } finally {
      await a.close();
      await b.close();
      await admin.exec(`drop database ${name}`);
      await admin.close();
    }
  });
});


/** Ends every other session running `marker` once it has started. */
async function killWhenRunning(admin: Db, marker: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const rows = await admin.query<{ n: number }>("select count(pg_terminate_backend(pid))::int as n from pg_stat_activity where query like $1 and pid <> pg_backend_pid()", [`%${marker}%`]);
    if (rows[0]!.n > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`no session ran ${marker}`);
}

describe.if(Boolean(url))('a session ended under a query', () => {
  test('a read is sent again, a write is not, and a transaction runs again whole', async () => {
    const admin = connectPostgres(url!, silentLogger);
    const db = connectPostgres(url!, silentLogger);
    const table = `t_drop_${Date.now().toString(36)}`;
    await admin.exec(`create table ${table} (n int)`);
    try {
      const [read] = await Promise.all([db.query<{ x: number }>('select 1 as x from pg_sleep(0.5) /* read-marker */'), killWhenRunning(admin, 'read-marker')]);
      expect(read).toEqual([{ x: 1 }]);

      const write = db.query(`insert into ${table} select 1 from pg_sleep(0.5) /* write-marker */`);
      await killWhenRunning(admin, 'write-marker');
      // The driver reports a query in flight on a dead connection as `write CONNECTION_CLOSED`.
      expect(await write.then(() => 'ran', (e: { code?: string }) => e.code)).toBe('CONNECTION_CLOSED');

      let runs = 0;
      const tx = db.transaction(async (t) => {
        runs++;
        await t.query(`insert into ${table} values (2)`);
        await t.query('select pg_sleep(0.5) /* tx-marker */');
      });
      await Promise.all([tx, killWhenRunning(admin, 'tx-marker')]);
      expect(runs).toBe(2);
      expect(await admin.query(`select n from ${table} order by n`)).toEqual([{ n: 2 }]);
    } finally {
      await admin.exec(`drop table ${table}`);
      await db.close();
      await admin.close();
    }
  }, 20_000);
});

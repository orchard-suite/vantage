import { describe, expect, test } from 'bun:test';
import { connectPglite } from './pglite.ts';
import { cpSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, MIGRATIONS_DIR } from './migrate.ts';
import { silentLogger } from '../log.ts';

describe('db', () => {
  test('migrations apply once and the seed org exists', async () => {
    const db = connectPglite();
    const first = await migrate(db, silentLogger);
    expect(first.applied.length).toBeGreaterThan(0);
    const second = await migrate(db, silentLogger);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toBe(first.applied.length);
    const orgs = await db.query<{ id: string }>('select id from orgs');
    expect(orgs.map((o) => o.id)).toEqual(['default']);
    await db.close();
  });

  test('listen receives notify and transactions roll back on error', async () => {
    const db = connectPglite();
    await migrate(db, silentLogger);
    const got: string[] = [];
    const un = await db.listen('t_chan', (p) => got.push(p));
    await db.notify('t_chan', 'hello');
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toEqual(['hello']);
    await un();
    await expect(
      db.transaction(async (tx) => {
        await tx.query("insert into teams (id, org_id, name, slug) values ('t1', 'default', 'T', 't')");
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.query('select id from teams')).toEqual([]);
    await db.close();
  });
  test('the viewer layout migration drops drawn-ahead pictures, queues their files, and redraws every document', async () => {
    const db = connectPglite();
    const before = mkdtempSync(join(tmpdir(), 'vantage-migrations-'));
    for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f < '0011')) cpSync(join(MIGRATIONS_DIR, f), join(before, f));
    await migrate(db, silentLogger, before);
    await db.query("insert into workspaces (id, org_id, kind, name, slug) values ('w1', 'default', 'team', 'W', 'w')");
    await db.query("insert into documents (id, org_id, workspace_id, name, slug, head_version_id) values ('d1', 'default', 'w1', 'D', 'd', 'v1'), ('d2', 'default', 'w1', 'Empty', 'e', null)");
    await db.query("insert into artifacts (id, org_id, version_hash, view_id, kind, blob_key, bytes, content_type) values ('a1', 'default', 'h', '', 'bundle', 'h/r/bundle.json.gz', 1, 'application/json'), ('a2', 'default', 'h', 'main', 'variants', 'h/r/main.variants.json.gz', 1, 'application/json')");
    const after = await migrate(db, silentLogger);
    expect(after.applied).toEqual(readdirSync(MIGRATIONS_DIR).filter((f) => f >= '0011' && f.endsWith('.sql')).sort());
    expect((await db.query<{ kind: string }>('select kind from artifacts')).map((a) => a.kind)).toEqual(['bundle']);
    const jobs = await db.query<{ kind: string; payload: Record<string, unknown> }>('select kind, payload from jobs order by kind');
    expect(jobs).toEqual([
      { kind: 'drop-files', payload: { keys: ['h/r/main.variants.json.gz'] } },
      { kind: 'overlay', payload: { documentId: 'd1', reason: 'viewer lays out in the browser' } },
    ]);
    await expect(db.query("insert into artifacts (id, org_id, version_hash, view_id, kind, blob_key, bytes, content_type) values ('a3', 'default', 'h', 'x', 'variants', 'k', 1, 'application/json')")).rejects.toThrow();
    await db.close();
  });

  test('the document creator migration names the author of the oldest kept version, or no one', async () => {
    const db = connectPglite();
    const before = mkdtempSync(join(tmpdir(), 'vantage-migrations-'));
    for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f < '0017')) cpSync(join(MIGRATIONS_DIR, f), join(before, f));
    await migrate(db, silentLogger, before);
    await db.query("insert into users (id, org_id, subject) values ('u1', 'default', 'one'), ('u2', 'default', 'two')");
    await db.query("insert into workspaces (id, org_id, kind, name, slug) values ('w1', 'default', 'team', 'W', 'w')");
    await db.query("insert into documents (id, org_id, workspace_id, name, slug) values ('d1', 'default', 'w1', 'D', 'd'), ('d2', 'default', 'w1', 'S', 's')");
    await db.query(`insert into versions (id, org_id, document_id, hash, yaml, author_user_id, surface, created_at) values
      ('v1', 'default', 'd1', 'h1', 'a', null, 'worker', now() - interval '3 days'),
      ('v2', 'default', 'd1', 'h2', 'b', 'u2', 'api', now() - interval '2 days'),
      ('v3', 'default', 'd1', 'h3', 'c', 'u1', 'api', now() - interval '1 day'),
      ('v4', 'default', 'd2', 'h4', 'd', null, 'worker', now())`);
    await migrate(db, silentLogger);
    expect(await db.query('select id, created_by from documents order by id')).toEqual([
      { id: 'd1', created_by: 'u2' },
      { id: 'd2', created_by: null },
    ]);
    await db.close();
  });

  test('the Dispatch migration drops the old Teams and email notification settings and keeps the rest', async () => {
    const db = connectPglite();
    const before = mkdtempSync(join(tmpdir(), 'vantage-migrations-'));
    for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f < '0022')) cpSync(join(MIGRATIONS_DIR, f), join(before, f));
    await migrate(db, silentLogger, before);
    await db.query(`insert into workspaces (id, org_id, kind, name, slug, settings) values
      ('w1', 'default', 'team', 'W', 'w', '{"freshnessDays": 7, "notifications": {"teamsWebhook": "hook", "email": {"smtp": "mail", "from": "a@example.com", "to": ["b@example.com"]}, "kinds": ["drift"]}}'),
      ('w2', 'default', 'team', 'X', 'x', '{}')`);
    await migrate(db, silentLogger);
    expect(await db.query('select id, settings from workspaces order by id')).toEqual([
      { id: 'w1', settings: { freshnessDays: 7, notifications: { kinds: ['drift'] } } },
      { id: 'w2', settings: {} },
    ]);
    await db.close();
  });
});

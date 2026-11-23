import { describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeObserved, type Batch, type ObservedModel } from '@vantage/connectors';
import { testContext } from '../testing.ts';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/db.ts';
import { connectPglite } from '../db/pglite.ts';
import { migrate, MIGRATIONS_DIR } from '../db/migrate.ts';
import { silentLogger } from '../log.ts';
import { observedDelta, observedModel, sourceById, updateObservedModel, type SourceRow } from './repo.ts';

const batch = (observed: string, ids: readonly string[], facts: Record<string, string> = {}, partial = false): Batch => ({
  source: 'fleet',
  observed,
  partial,
  entities: ids.map((id) => ({ id, type: 'pod', name: id, facts: { image: facts[id] ?? 'a:1' } })),
  relations: ids.length > 1 ? [{ from: ids[0]!, to: ids[1]!, label: 'calls' }] : [],
});

async function source(ctx: AppContext): Promise<SourceRow> {
  await ctx.db.query("insert into workspaces (id, org_id, kind, name, slug) values ('w1', 'default', 'team', 'W', 'w')");
  await ctx.db.query("insert into sources (id, org_id, workspace_id, name, slug, connector, config, client_id, enabled) values ('s1', 'default', 'w1', 'Fleet', 'fleet', 'push', '{}', 'client-1', true)");
  return (await sourceById(ctx.db, 's1'))!;
}

async function fold(ctx: AppContext, s: SourceRow, b: Batch) {
  const out = await updateObservedModel(ctx.db, s, b, (previous) => mergeObserved(previous, b));
  if (out.stale !== undefined) throw new Error(out.stale);
  return out;
}

/** Reads around the cache, the way another process would. */
const reread = async (ctx: AppContext): Promise<ObservedModel> => (await observedModel(ctx.db, 's1', { cache: Object.create(ctx.db) as Db })).model;

describe('observed items as rows', () => {
  test('a reader after a run gets the model a fresh read would give, on the process that ran it too', async () => {
    const ctx = await testContext();
    const s = await source(ctx);
    const b = batch('2026-11-01T10:00:00.000Z', ['c', 'a', 'b']);
    await fold(ctx, s, { ...b, entities: b.entities.map((e) => ({ ...e, facts: { zone: 'z', image: 'a:1', arch: 'x86' } })) });
    const here = (await observedModel(ctx.db, 's1')).model;
    expect(JSON.stringify(here)).toBe(JSON.stringify(await reread(ctx)));
  });

  test('the model reads back in key order, whatever order the rows were written in', async () => {
    const ctx = await testContext();
    const s = await source(ctx);
    await fold(ctx, s, batch('2026-11-01T10:00:00.000Z', ['c', 'a', 'b']));
    const model = await reread(ctx);
    const keys = Object.keys(model.entities);
    expect(keys).toEqual([...keys].sort());
    expect(Object.keys(model.relations)).toEqual(Object.keys(model.relations).sort());
  });

  test('a run writes only what changed, and reading back gives the merged model with every time right', async () => {
    const ctx = await testContext();
    const s = await source(ctx);
    const t1 = '2026-11-01T10:00:00.000Z', t2 = '2026-11-01T10:10:00.000Z', t3 = '2026-11-01T10:20:00.000Z', t4 = '2026-11-01T10:25:00.000Z';
    const first = await fold(ctx, s, batch(t1, ['a', 'b', 'c']));
    expect(first.written).toBe(4);
    const same = await fold(ctx, s, batch(t2, ['a', 'b', 'c']));
    expect(same.written).toBe(0);
    // Read back from Postgres, keys come in its own order; unchanged items still write nothing.
    const fromRows = await reread(ctx);
    expect(observedDelta(fromRows, mergeObserved(fromRows, batch(t2, ['a', 'b', 'c'])).model, batch(t2, ['a', 'b', 'c'])).entities).toEqual([]);
    expect(await reread(ctx)).toEqual(same.model);
    expect((await reread(ctx)).entities['fleet:a']!.observed).toBe(t2);

    const changed = await fold(ctx, s, batch(t3, ['a', 'b'], { b: 'a:2' }));
    expect(changed.written).toBe(2);
    const back = await reread(ctx);
    expect(back).toEqual(changed.model);
    expect(back.entities['fleet:c']!.missingSince).toBe(t3);
    expect(back.entities['fleet:c']!.observed).toBe(t2);

    const slice = await fold(ctx, s, batch(t4, ['a'], {}, true));
    expect(slice.written).toBe(1);
    expect(await reread(ctx)).toEqual(slice.model);
    expect((await reread(ctx)).entities['fleet:a']!.observed).toBe(t4);
    expect((await reread(ctx)).entities['fleet:b']!.observed).toBe(t3);
  });

  test('a full batch observed before the last full read is stale and changes nothing', async () => {
    const ctx = await testContext();
    const s = await source(ctx);
    await fold(ctx, s, batch('2026-11-01T10:10:00.000Z', ['a', 'b']));
    const late = await updateObservedModel(ctx.db, s, batch('2026-11-01T10:00:00.000Z', ['a']), (previous) => mergeObserved(previous, batch('2026-11-01T10:00:00.000Z', ['a'])));
    expect(late.stale).toContain('before the last full read');
    expect((await reread(ctx)).entities['fleet:b']!.missingSince).toBeUndefined();
  });

  test('two runs of one source at once both land; neither merges against a stale model', async () => {
    const ctx = await testContext();
    const s = await source(ctx);
    await Promise.all([fold(ctx, s, batch('2026-11-01T10:00:00.000Z', ['a'], {}, true)), fold(ctx, s, batch('2026-11-01T10:00:01.000Z', ['b'], {}, true))]);
    expect(Object.keys((await reread(ctx)).entities).sort()).toEqual(['fleet:a', 'fleet:b']);
  });

  test('the migration moves a stored document into rows unchanged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vantage-mig-'));
    // With the open items table too, which today's reader reads beside the rows.
    for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f < '0009' || f.startsWith('0021'))) cpSync(join(MIGRATIONS_DIR, f), join(dir, f));
    const db = connectPglite();
    const before = mkdtempSync(join(tmpdir(), 'vantage-mig-'));
    for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f < '0008')) cpSync(join(MIGRATIONS_DIR, f), join(before, f));
    await migrate(db, silentLogger, before);
    await db.query("insert into sources (id, org_id, name, slug, connector, config, visibility, enabled) values ('s1', 'default', 'Fleet', 'fleet', 'push', '{}', '{\"org\":true}', true)");
    const model = mergeObserved(mergeObserved({ entities: {}, relations: {} }, batch('2026-11-01T10:00:00.000Z', ['a', 'b'])).model, batch('2026-11-01T10:10:00.000Z', ['a'])).model;
    await db.query("insert into observed_models (org_id, source_id, model, version) values ('default', 's1', $1, 3)", [JSON.stringify(model)]);
    await migrate(db, silentLogger, dir);
    const back = await observedModel(db, 's1');
    expect(back.version).toBe(3);
    expect(back.model).toEqual(model);
  });

  test('the connector migration removes org-wide sources, their rows, and push tokens', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vantage-mig-'));
    for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f < '0012')) cpSync(join(MIGRATIONS_DIR, f), join(dir, f));
    const db = connectPglite();
    await migrate(db, silentLogger, dir);
    await db.query("insert into sources (id, org_id, name, slug, connector, config, visibility, enabled) values ('s1', 'default', 'Fleet', 'fleet', 'push', '{}', '{\"org\":true}', true)");
    await db.query("insert into observed_entities (source_id, key, data, observed) values ('s1', 'fleet:a', '{}', '2026-11-01T10:00:00Z')");
    await db.query("insert into tokens (id, org_id, hash, kind, scope, name) values ('t1', 'default', 'h', 'source', '{\"sourceId\":\"s1\"}', 'source fleet')");
    await migrate(db, silentLogger);
    expect((await db.query('select id from sources')).length).toBe(0);
    expect((await db.query('select key from observed_entities')).length).toBe(0);
    expect((await db.query('select id from tokens')).length).toBe(0);
  });
});

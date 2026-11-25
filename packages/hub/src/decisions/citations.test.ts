import { describe, expect, test } from 'bun:test';
import { SAMPLE_YAML } from '../testing.ts';
import { backfillCitations } from './citations.ts';
import { citingPage, citingYaml, grant, seeded, workspaceOf } from './test-kit.ts';
import { saveDocument } from '../documents/save.ts';
import { incomingFiles } from '../documents/pages.ts';
import type { Db } from '../db/db.ts';
import type { AppContext } from '../context.ts';

/** A context whose database counts every query, in and out of transactions. */
function counting(ctx: AppContext): { ctx: AppContext; queries: () => number } {
  let n = 0;
  const wrap = (db: Db): Db => ({
    query<T extends object>(text: string, params?: readonly unknown[]) {
      n++;
      return db.query<T>(text, params);
    },
    exec: (text) => db.exec(text),
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
    listen: (channel, handler) => db.listen(channel, handler),
    notify: (channel, payload) => db.notify(channel, payload),
    close: () => db.close(),
  });
  return { ctx: { ...ctx, db: wrap(ctx.db) }, queries: () => n };
}

describe('the citation index', () => {
  test('a save indexes each box and page that cites a record, and the next save replaces it', async () => {
    const { t, me, ws, create, save, cited } = await seeded();
    await create();
    const doc = (await save('SHOP-2001')).body['document'] as { id: string; slug: string };
    const b = await cited('SHOP-2001');
    expect(b.documents).toHaveLength(1);
    expect(b.documents[0]).toMatchObject({ workspace: ws.slug, document: doc.slug, documentName: 'Shop' });
    expect(b.documents[0]!.places.map((x) => `${x.kind} ${x.id}`).sort()).toEqual(['box shop-api', 'page guide']);
    expect(b.documents[0]!.places.find((x) => x.kind === 'page')!.url).toBe(`/w/${ws.slug}/${doc.slug}#guide`);
    expect(b.hidden).toBe(0);

    await t.json(`/api/v1/workspaces/${ws.slug}/documents/${doc.slug}`, { method: 'PUT', headers: me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML }) });
    expect((await cited('SHOP-2001')).documents).toHaveLength(0);
  });

  test('a save looks its citations up in a few queries, however many records it cites', async () => {
    const { t, me, ws, create, cited } = await seeded();
    for (let i = 0; i < 8; i++) await create({ title: `Record ${i}` });
    const refs = Array.from({ length: 8 }, (_, i) => `SHOP-${2001 + i}`);
    const queriesFor = async (cites: readonly string[], name: string): Promise<number> => {
      const c = counting(t.ctx);
      const files = incomingFiles(t.ctx, 'default', { 'pages/guide.md': new TextEncoder().encode(cites.map(citingPage).join('\n')) });
      const r = await saveDocument(c.ctx, { orgId: 'default', workspaceId: ws.id, name, yaml: citingYaml(cites.join(', ')), files, authorUserId: null, who: 'test', surface: 'api' });
      expect(r.status).toBe('saved');
      return c.queries();
    };
    const one = await queriesFor(refs.slice(0, 1), 'one');
    const eight = await queriesFor(refs, 'eight');
    expect(eight).toBe(one);
    expect((await cited('SHOP-2008', me.headers)).documents.map((d) => d.documentName)).toEqual(['eight']);
  });

  test('a record write indexes its prose and its Related, and a record citation waits for a number nobody holds yet', async () => {
    const { create, save, cited } = await seeded();
    await create();
    // A document may not cite a number nobody holds: the save is refused.
    expect((await save('SHOP-2002')).status).toBe(422);
    expect((await cited('SHOP-2001')).records).toHaveLength(0);
    const b = await create({ title: 'Replicas stay private', context: 'Builds on ADR-2001. Waits on SHOP-2003.', related: ['SHOP-2001'] });
    expect(b.ref).toBe('SHOP-2002');
    const back = await cited('SHOP-2001');
    expect(back.records.map((r) => [r.ref, [...r.places].sort(), r.citedAs])).toEqual([['SHOP-2002', ['body', 'related'], ['ADR-2001']]]);
    // The record written before SHOP-2003 existed is found now that it does.
    await create({ title: 'Reads go to replicas' });
    expect((await cited('SHOP-2003')).records.map((r) => r.ref)).toEqual(['SHOP-2002']);
  });

  test('the backfill indexes documents and records saved before the index existed', async () => {
    const { t, create, save, cited } = await seeded();
    await create();
    await create({ title: 'Replicas stay private', context: 'Builds on SHOP-2001.' });
    await save('SHOP-2001');
    await t.ctx.db.query('delete from decision_citations');
    await t.ctx.db.query('update documents set cites_version_id = null');
    await t.ctx.db.query('update decisions set cites_indexed = false');
    expect((await cited('SHOP-2001')).documents).toHaveLength(0);
    const r = await backfillCitations(t.ctx);
    expect(r.records).toBe(2);
    expect(r.documents).toBe(1);
    const b = await cited('SHOP-2001');
    expect(b.documents).toHaveLength(1);
    expect(b.records.map((x) => x.ref)).toEqual(['SHOP-2002']);
    expect(await backfillCitations(t.ctx)).toEqual({ documents: 0, records: 0 });
  });

  test('a reader sees only the citing places they can open; the rest are counted, never named', async () => {
    const { t, me, ws, create, save, cited } = await seeded();
    await create();
    await save('SHOP-2001', { name: 'Shared shop' });
    const other = await t.bearer('other-author');
    const theirs = await workspaceOf(t, other.headers);
    await grant(t, ws.id, other.principal.userId, 'viewer');
    expect((await save('SHOP-2001', { workspace: theirs.slug, headers: other.headers, name: 'Secret plans' })).status).toBe(201);

    const reader = await t.bearer('reader');
    await grant(t, ws.id, reader.principal.userId, 'viewer');
    const seen = await cited('SHOP-2001', reader.headers);
    expect(seen.documents.map((d) => d.documentName)).toEqual(['Shared shop']);
    expect(seen.hidden).toBe(1);
    expect(JSON.stringify(seen)).not.toContain('Secret plans');
    expect(JSON.stringify(seen)).not.toContain(theirs.slug);
    const page = await (await t.app.request(`/w/${ws.slug}/decisions/SHOP-2001`, { headers: reader.headers })).text();
    expect(page).toContain('Cited by');
    expect(page).toContain('Shared shop');
    expect(page).toContain('1 more in places you cannot open');
    expect(page).not.toContain('Secret plans');
  });

  test("a record's outline says what cites it", async () => {
    const { t, me, create, save } = await seeded();
    await create();
    await save('SHOP-2001');
    const { agent } = await import('../mcp/testing.ts');
    const out = await (await agent(t, me.headers)).call('vantage_outline', { address: 'SHOP-2001' });
    expect(out).toMatch(/cited by 1: \S+\/shop \((box shop-api, page guide|page guide, box shop-api)\)/);
  });
});

import { describe, expect, test } from 'bun:test';
import { grant, seeded, workspaceOf } from './test-kit.ts';
import type { MoveReport } from './move.ts';
import type { Decision } from './types.ts';

const dec = (body: Record<string, unknown>): Decision => body['decision'] as Decision;

async function moved() {
  const s = await seeded();
  const move = async (ref: string, body: Record<string, unknown>, headers = s.me.headers) => s.t.json(`/api/v1/decisions/${ref}/move`, { method: 'POST', headers, body: JSON.stringify(body) });
  const head = async (slug: string, workspace = s.ws.slug) => {
    const read = await s.t.json(`/api/v1/workspaces/${workspace}/documents/${slug}`, { headers: s.me.headers });
    const versionId = (read.body['headVersion'] as { id: string }).id;
    const v = (await s.t.ctx.db.query<{ yaml: string }>('select yaml from versions where id = $1', [versionId]))[0]!;
    const page = await (await s.t.app.request(`/api/v1/workspaces/${workspace}/documents/${slug}/pages?path=pages/guide.md`, { headers: s.me.headers })).text();
    return { versionId, yaml: v.yaml, page };
  };
  return { ...s, move, head };
}

describe('moving a record', () => {
  test('a dry run lists what it would rewrite and writes nothing', async () => {
    const { ws, create, save, move, head, cited } = await moved();
    await create();
    await create({ title: 'Replicas stay private', context: 'Builds on ADR-2001.' });
    const slug = ((await save('SHOP-2001')).body['document'] as { slug: string }).slug;
    const before = await head(slug);
    const r = await move('SHOP-2001', { number: 2005, dryRun: true });
    expect(r.status).toBe(200);
    const report = r.body as unknown as MoveReport;
    expect(report).toMatchObject({ dryRun: true, from: 'SHOP-2001', to: 'SHOP-2005', cannot: [], hidden: 0 });
    expect(report.rewritten.map((x) => `${x.kind} ${x.source}`).sort()).toEqual([`document ${ws.slug}/${slug}`, 'record SHOP-2002']);
    expect((await head(slug)).versionId).toBe(before.versionId);
    expect((await cited('SHOP-2001')).ref).toBe('SHOP-2001');
  });

  test('a renumber in its category rewrites every citation; the old number is an alias that resolves and redirects', async () => {
    const { t, me, ws, create, save, move, head, cited } = await moved();
    const a = await create({ context: 'This is ADR-2001 itself.' });
    await create({ title: 'Replicas stay private', context: 'Builds on ADR-2001 and SHOP-2001.' });
    const slug = ((await save('SHOP-2001')).body['document'] as { slug: string }).slug;
    const r = (await move('SHOP-2001', { number: 2005, message: 'tidy the numbers' })).body as unknown as MoveReport;
    expect(r).toMatchObject({ dryRun: false, from: 'SHOP-2001', to: 'SHOP-2005', id: a.id, cannot: [] });
    expect(r.rewritten).toHaveLength(2);

    const now = dec((await t.json('/api/v1/decisions/SHOP-2001', { headers: me.headers })).body);
    expect(now).toMatchObject({ id: a.id, ref: 'SHOP-2005', aliases: ['SHOP-2001'], context: 'This is ADR-2005 itself.' });
    expect(dec((await t.json('/api/v1/decisions/SHOP-2002', { headers: me.headers })).body).context).toBe('Builds on ADR-2005 and SHOP-2005.');
    const doc = await head(slug);
    expect(doc.yaml).toContain('decisions: [SHOP-2005]');
    expect(doc.yaml).not.toContain('SHOP-2001');
    expect(doc.page).toContain('[[decision:SHOP-2005]]');
    expect((await cited('SHOP-2005')).documents).toHaveLength(1);

    const history = (await t.json('/api/v1/decisions/SHOP-2005/history', { headers: me.headers })).body['revisions'] as { message: string; author: string | null }[];
    expect(history[0]!.message).toBe('tidy the numbers');
    const audit = await t.ctx.db.query<{ what: string }>("select what from audit where what like 'decision.move%' order by what");
    expect(audit.map((x) => x.what)).toEqual(['decision.move', 'decision.move.citations']);

    const page = await t.app.request(`/w/${ws.slug}/decisions/SHOP-2001`, { headers: me.headers });
    expect(page.status).toBe(302);
    expect(page.headers.get('location')).toBe(`/w/${ws.slug}/decisions/SHOP-2005`);
    // A save still takes the old citation, and says what it is now.
    const old = await save('SHOP-2001', { name: 'Old cite' });
    expect(old.status).toBe(201);
    expect(old.body['movedDecisions']).toEqual([{ cited: 'SHOP-2001', ref: 'SHOP-2005' }]);
    const checked = await t.json(`/api/v1/workspaces/${ws.slug}/check`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: 'nodes:\n  - { name: API, decisions: [SHOP-2001] }\n' }) });
    expect(checked.body['errors']).toEqual([]);
    expect(JSON.stringify(checked.body['warnings'])).toContain('decision SHOP-2001 moved; it is SHOP-2005 now');
    const hits = (await t.json('/api/v1/search?q=SHOP-2001', { headers: me.headers })).body['decisions'] as { ref: string }[];
    expect(hits.map((h) => h.ref)).toContain('SHOP-2005');
  });

  test('a number is never reused: not by a new record, and not by a move', async () => {
    const { t, me, create, move } = await moved();
    await create();
    await create({ title: 'Second' });
    expect((await move('SHOP-2001', { number: 2005 })).status).toBe(200);
    expect((await create({ title: 'Third' })).ref).toBe('SHOP-2006');
    expect((await t.json('/api/v1/registries/SHOP/next?category=2', { headers: me.headers })).body['ref']).toBe('SHOP-2007');
    const taken = await move('SHOP-2002', { number: 2001 });
    expect(taken.status).toBe(400);
    expect(JSON.stringify(taken.body)).toContain('already taken');
    // The record that held 2001 may take it back.
    const back = (await move('SHOP-2005', { number: 2001 })).body as unknown as MoveReport;
    expect(back.to).toBe('SHOP-2001');
    expect(dec((await t.json('/api/v1/decisions/SHOP-2001', { headers: me.headers })).body).aliases).toEqual(['SHOP-2005']);
    expect((await move('SHOP-2001', { number: 2001 })).status).toBe(400);
  });

  test('a move to another category takes the next number there', async () => {
    const { t, me, create, move } = await moved();
    await create();
    await create({ category: 1, title: 'Infra one' });
    const r = (await move('SHOP-2001', { category: 1 })).body as unknown as MoveReport;
    expect(r.to).toBe('SHOP-1002');
    const d = dec((await t.json('/api/v1/decisions/SHOP-1002', { headers: me.headers })).body);
    expect(d).toMatchObject({ category: 1, categoryName: 'Infrastructure', aliases: ['SHOP-2001'] });
    expect((await move('SHOP-1002', { category: 2, number: 1003 })).status).toBe(400);
  });

  test('a move to another registry keeps every citation meaning the same record', async () => {
    const { t, me, ws, create, save, move, head } = await moved();
    expect((await t.json(`/api/v1/workspaces/${ws.slug}/registries`, { method: 'POST', headers: me.headers, body: JSON.stringify({ prefix: 'PAY', name: 'Payments' }) })).status).toBe(201);
    await create({ context: 'Leans on ADR-2002. This is ADR-2001.' });
    await create({ title: 'Replicas stay private', context: 'Builds on ADR-2001.' });
    await create({ title: 'Payments one' }, 'PAY');
    const slug = ((await save('SHOP-2001')).body['document'] as { slug: string }).slug;
    const r = (await move('SHOP-2001', { registry: 'PAY' })).body as unknown as MoveReport;
    expect(r.to).toBe('PAY-2002');
    const movedRecord = dec((await t.json('/api/v1/decisions/PAY-2002', { headers: me.headers })).body);
    // Its own local citation of a record it left behind is qualified; its citation of itself stays local.
    expect(movedRecord.context).toBe('Leans on SHOP-2002. This is ADR-2002.');
    expect(movedRecord).toMatchObject({ registry: 'PAY', aliases: ['SHOP-2001'] });
    // A record that stays behind cites it by its new qualified citation.
    expect(dec((await t.json('/api/v1/decisions/SHOP-2002', { headers: me.headers })).body).context).toBe('Builds on PAY-2002.');
    expect((await head(slug)).yaml).toContain('decisions: [PAY-2002]');
    expect(dec((await t.json('/api/v1/decisions/SHOP-2001', { headers: me.headers })).body).ref).toBe('PAY-2002');
    expect((await create({ title: 'Next shop one' })).ref).toBe('SHOP-2003');
  });

  test('a document the mover cannot write is reported, not a failure, and keeps resolving', async () => {
    const { t, create, save, move, cited } = await moved();
    await create();
    const owner = await t.bearer('owner-of-elsewhere');
    const theirs = await workspaceOf(t, owner.headers);
    expect((await save('SHOP-2001', { workspace: theirs.slug, headers: owner.headers, name: 'Their shop' })).status).toBe(201);
    const mover = await t.bearer('mover');
    const home = (await t.ctx.db.query<{ workspace_id: string }>("select workspace_id from decision_registries where prefix = 'SHOP'"))[0]!.workspace_id;
    await grant(t, home, mover.principal.userId, 'author');
    await grant(t, theirs.id, mover.principal.userId, 'viewer');
    const dry = (await move('SHOP-2001', { number: 2009, dryRun: true }, mover.headers)).body as unknown as MoveReport;
    expect(dry.cannot.map((x) => [x.source, x.reason])).toEqual([[`${theirs.slug}/their-shop`, `you can read ${theirs.slug} but not write it`]]);
    const r = await move('SHOP-2001', { number: 2009 }, mover.headers);
    expect(r.status).toBe(200);
    const report = r.body as unknown as MoveReport;
    expect(report.rewritten).toHaveLength(0);
    expect(report.cannot.map((x) => x.title)).toEqual(['Their shop']);
    const b = await cited('SHOP-2009', mover.headers);
    expect(b.documents.map((d) => [d.documentName, d.places.map((x) => x.citedAs)])).toEqual([['Their shop', ['SHOP-2001', 'SHOP-2001']]]);
    // Their document still cites the old number, and a save of it still passes.
    const again = await save('SHOP-2001', { workspace: theirs.slug, headers: owner.headers, name: 'Their shop again' });
    expect(again.status).toBe(201);
    expect(again.body['movedDecisions']).toEqual([{ cited: 'SHOP-2001', ref: 'SHOP-2009' }]);
  });

  test('vantage_decision_move runs a dry run and a move', async () => {
    const { t, me, create } = await moved();
    await create();
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('http://hub.test/mcp'), { fetch: (input, init) => Promise.resolve(t.app.request(String(input), init)), requestInit: { headers: me.headers } }));
    const call = async (args: Record<string, unknown>) => ((await client.callTool({ name: 'vantage_decision_move', arguments: args })).content as { text: string }[])[0]!.text;
    expect(await call({ ref: 'SHOP-2001', category: 3, dryRun: true })).toContain('Would move SHOP-2001 to SHOP-3001');
    expect(await call({ ref: 'SHOP-2001', category: 3 })).toContain('Moved SHOP-2001 to SHOP-3001');
    await client.close();
  });
});

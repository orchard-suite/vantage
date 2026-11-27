import { describe, expect, test } from 'bun:test';
import { grant, RECORD, seeded } from './test-kit.ts';
import type { DiscardReport, Pointer } from './discard.ts';

const KIND = `title: Requests
kind:
  prefix: REQ
  name: Requests
  lifecycle: flow
views:
  - id: flow
    kind: lifecycle
    title: How a request moves
    states:
      - { id: asked, text: Asked, class: not-started }
      - { id: done, text: Done, class: done }
    moves:
      - { from: asked, to: done, label: finish, who: [holder] }
`;

async function discarding() {
  const s = await seeded();
  const discard = async (ref: string, body: Record<string, unknown> = {}, headers = s.me.headers) => s.t.json(`/api/v1/decisions/${ref}/discard`, { method: 'POST', headers, body: JSON.stringify(body) });
  /** What a refusal says points to the record, as `kind source: how`. */
  const refused = async (ref: string, headers = s.me.headers): Promise<string[]> => {
    const r = await discard(ref, {}, headers);
    expect(r.status).toBe(409);
    const pointers = (r.body['details'] as { pointers: Pointer[] }).pointers;
    const dry = (await discard(ref, { dryRun: true }, headers)).body as unknown as DiscardReport;
    // A dry run answers the same list.
    expect(dry.pointers).toEqual(pointers);
    return pointers.map((x) => `${x.kind} ${x.source}: ${x.how.join(', ')}`);
  };
  const rows = async (table: string, column: string, id: string) => Number((await s.t.ctx.db.query<{ n: number }>(`select count(*)::int as n from ${table} where ${column} = $1`, [id]))[0]!.n);
  return { ...s, discard, refused, rows };
}

describe('discarding a record', () => {
  test('a record nothing points to is removed with what it governs, and its number goes to the next record', async () => {
    const { t, me, ws, create, save, discard, rows } = await discarding();
    await create();
    const slug = ((await save('SHOP-2001')).body['document'] as { slug: string }).slug;
    const mistake = await create({ title: 'Written by mistake', context: 'Leans on SHOP-2001.', governs: [{ document: `${ws.slug}/${slug}`, box: 'shop-api' }] });
    expect(mistake.ref).toBe('SHOP-2002');
    expect(await rows('decision_links', 'decision_id', mistake.id)).toBe(1);
    expect(await rows('decision_citations', 'source_decision_id', mistake.id)).toBe(1);

    const r = await discard('SHOP-2002', { message: 'Written by mistake' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dryRun: false, discarded: true, ref: 'SHOP-2002', id: mistake.id, pointers: [] });
    expect((await t.json('/api/v1/decisions/SHOP-2002', { headers: me.headers })).status).toBe(404);
    expect(await rows('decision_links', 'decision_id', mistake.id)).toBe(0);
    expect(await rows('decision_revisions', 'decision_id', mistake.id)).toBe(0);
    expect(await rows('decision_citations', 'source_decision_id', mistake.id)).toBe(0);

    expect((await t.json('/api/v1/registries/SHOP/next?category=2', { headers: me.headers })).body['ref']).toBe('SHOP-2002');
    const next = await create({ title: 'The real one' });
    expect(next.ref).toBe('SHOP-2002');
    expect(next.id).not.toBe(mistake.id);
  });

  test('the audit log keeps the whole text, who discarded it, and when', async () => {
    const { t, me, create, discard } = await discarding();
    const d = await create();
    expect((await discard('SHOP-2001', { message: 'Written by mistake' })).status).toBe(200);
    const entry = (await t.ctx.db.query<{ who: string; target: string; details: { ref: string; message: string; text: string; record: { title: string } }; at: Date }>("select who, target, details, at from audit where what = 'decision.discard'"))[0]!;
    expect(entry.who).toStartWith(me.principal.userId);
    expect(entry.target).toBe(`decision:${d.id}`);
    expect(entry.at).toBeInstanceOf(Date);
    expect(entry.details).toMatchObject({ ref: 'SHOP-2001', message: 'Written by mistake', record: { title: 'Orders go through one API' } });
    expect(entry.details.text).toContain('record: SHOP-2001');
    expect(entry.details.text).toContain('## Context\n\nTwo apps wrote to the orders store.');
    expect(entry.details.text).toContain('Shared database');
  });

  test('a dry run answers what a discard would do and writes nothing', async () => {
    const { t, me, create, discard } = await discarding();
    await create();
    const r = await discard('SHOP-2001', { dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dryRun: true, discarded: false, ref: 'SHOP-2001', pointers: [], hidden: 0 });
    expect((await t.json('/api/v1/decisions/SHOP-2001', { headers: me.headers })).status).toBe(200);
    expect(await t.ctx.db.query("select 1 from audit where what = 'decision.discard'")).toHaveLength(0);
    expect((await create({ title: 'Second' })).ref).toBe('SHOP-2002');
  });

  test('a document that cites it refuses', async () => {
    const { ws, create, save, refused } = await discarding();
    await create();
    const slug = ((await save('SHOP-2001')).body['document'] as { slug: string }).slug;
    expect(await refused('SHOP-2001')).toEqual([`document ${ws.slug}/${slug}: box shop-api, page guide`]);
  });

  test('a record that cites it in its prose or names it in related refuses', async () => {
    const { create, refused } = await discarding();
    await create();
    await create({ title: 'Cites it', consequences: 'Follows SHOP-2001.' });
    await create({ title: 'Relates to it', related: ['SHOP-2001'] });
    expect(await refused('SHOP-2001')).toEqual(['record SHOP-2002: consequences', 'record SHOP-2003: related']);
  });

  test('a supersede link refuses, from either side', async () => {
    const { t, me, create, refused } = await discarding();
    await create();
    expect((await t.json('/api/v1/decisions/SHOP-2001/supersede', { method: 'POST', headers: me.headers, body: JSON.stringify({ ...RECORD, title: 'Orders go through two APIs' }) })).status).toBe(201);
    expect(await refused('SHOP-2001')).toEqual(['record SHOP-2002: supersedes it']);
    expect(await refused('SHOP-2002')).toEqual(['record SHOP-2001: is superseded by it']);
  });

  test('an item that links it refuses', async () => {
    const { t, me, ws, create, refused } = await discarding();
    await create();
    expect((await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: KIND }) })).status).toBe(201);
    const write = async (path: string, method: string, body: unknown, key: string) => (await t.json(path, { method, headers: { ...me.headers, 'idempotency-key': key }, body: JSON.stringify(body) })).status;
    expect(await write('/api/v1/items', 'PUT', { kind: 'REQ', title: 'Build the orders API' }, 'k1')).toBeLessThan(300);
    expect(await write('/api/v1/items/REQ-1/links', 'POST', { rel: 'decision', target: 'SHOP-2001' }, 'k2')).toBeLessThan(300);
    expect(await refused('SHOP-2001')).toEqual(['item REQ-1: links it']);
  });

  test('an old citation that still resolves to it refuses', async () => {
    const { t, me, create, refused } = await discarding();
    await create();
    expect((await t.json('/api/v1/decisions/SHOP-2001/move', { method: 'POST', headers: me.headers, body: JSON.stringify({ number: 2005 }) })).status).toBe(200);
    expect(await refused('SHOP-2005')).toEqual(['alias SHOP-2001: an old citation']);
  });

  test('a revision by another writer refuses, for either of them', async () => {
    const { t, me, create, refused } = await discarding();
    await create();
    const other = await t.bearer('other-writer');
    const home = (await t.ctx.db.query<{ workspace_id: string }>("select workspace_id from decision_registries where prefix = 'SHOP'"))[0]!.workspace_id;
    await grant(t, home, other.principal.userId, 'author');
    expect((await t.json('/api/v1/decisions/SHOP-2001', { method: 'PATCH', headers: other.headers, body: JSON.stringify({ title: 'Orders go through the one API' }) })).status).toBe(200);
    const mine = await refused('SHOP-2001');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatch(/^writer .+: 1 revision$/);
    expect(await refused('SHOP-2001', other.headers)).toEqual([expect.stringMatching(/^writer .+: 1 revision$/)]);
    expect((await t.json('/api/v1/decisions/SHOP-2001', { headers: me.headers })).status).toBe(200);
  });

  test('vantage_decision_discard answers a dry run, a refusal, and a discard', async () => {
    const { t, me, create } = await discarding();
    await create();
    await create({ title: 'Cites it', context: 'Follows SHOP-2001.' });
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('http://hub.test/mcp'), { fetch: (input, init) => Promise.resolve(t.app.request(String(input), init)), requestInit: { headers: me.headers } }));
    const call = async (args: Record<string, unknown>) => {
      const r = await client.callTool({ name: 'vantage_decision_discard', arguments: args });
      return { text: (r.content as { text: string }[])[0]!.text, error: r.isError === true };
    };
    expect(await call({ ref: 'SHOP-2002', dryRun: true })).toEqual({ text: expect.stringContaining('SHOP-2002 (Cites it) can be discarded'), error: false });
    const dry = await call({ ref: 'SHOP-2001', dryRun: true });
    expect(dry.error).toBe(true);
    expect(dry.text).toContain('- record SHOP-2002 (Cites it): context');
    const refusal = await call({ ref: 'SHOP-2001' });
    expect(refusal.error).toBe(true);
    expect(refusal.text).toContain('409: SHOP-2001 cannot be discarded');
    expect(refusal.text).toContain('- record SHOP-2002 (Cites it): context');
    expect((await call({ ref: 'SHOP-2002', message: 'Written by mistake' })).text).toContain('Discarded SHOP-2002 (Cites it). Its number is free');
    await client.close();
  });
});

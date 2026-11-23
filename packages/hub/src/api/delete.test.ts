import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SAMPLE_YAML, testApp, type TestApp } from '../testing.ts';

type Caller = Awaited<ReturnType<TestApp['bearer']>>;

/** A team workspace its maker owns, with two more authors and a viewer. */
async function team() {
  const t = await testApp();
  const owner = await t.bearer('owner');
  const pat = await t.bearer('pat');
  const sam = await t.bearer('sam');
  const vic = await t.bearer('vic');
  const admin = await t.bearer('admin', { admin: true });
  const ws = (await t.json('/api/v1/workspaces', { method: 'POST', headers: owner.headers, body: JSON.stringify({ name: 'Platform' }) })).body as { slug: string; id: string };
  const grant = (who: Caller, role: string) => t.json(`/api/v1/workspaces/${ws.slug}/grants`, { method: 'POST', headers: owner.headers, body: JSON.stringify({ role, subjectKind: 'user', subjectId: who.principal.userId }) });
  await grant(pat, 'author');
  await grant(sam, 'author');
  await grant(vic, 'viewer');
  const make = async (by: Caller, title: string): Promise<{ id: string; slug: string }> => {
    const r = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: by.headers, body: JSON.stringify({ yaml: SAMPLE_YAML.replace('title: Sample', `title: ${title}`) }) });
    return r.body['document'] as { id: string; slug: string };
  };
  const del = async (by: Caller, d: { slug: string }): Promise<number> => (await t.app.request(`/api/v1/workspaces/${ws.slug}/documents/${d.slug}`, { method: 'DELETE', headers: by.headers })).status;
  const rule = async (by: Caller, value: string): Promise<number> => (await t.json(`/api/v1/workspaces/${ws.slug}`, { method: 'PATCH', headers: by.headers, body: JSON.stringify({ settings: { deleteDiagrams: value } }) })).status;
  return { t, ws, owner, pat, sam, vic, admin, make, del, rule };
}

describe('deleting diagrams', () => {
  test('by default the maker, the owner, and an org admin may delete; another author and a viewer may not', async () => {
    const { t, ws, owner, pat, sam, vic, admin, make, del } = await team();
    const pats = await make(pat, 'Pats');
    const read = (by: Caller) => t.json(`/api/v1/workspaces/${ws.slug}/documents/${pats.slug}`, { headers: by.headers });
    expect((await read(pat)).body['canDelete']).toBe(true);
    expect((await read(sam)).body['canDelete']).toBe(false);
    expect((await read(owner)).body['canDelete']).toBe(true);
    expect(await del(vic, pats)).toBe(403);
    const refused = await t.app.request(`/api/v1/workspaces/${ws.slug}/documents/${pats.slug}`, { method: 'DELETE', headers: sam.headers });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toContain('the person who made this diagram');
    expect(await del(pat, pats)).toBe(204);
    expect((await read(pat)).status).toBe(404);

    expect(await del(owner, await make(sam, 'Sams'))).toBe(204);
    expect(await del(admin, await make(sam, 'Again'))).toBe(204);
    await t.ctx.db.close();
  });

  test('only the owner and an org admin change the rule, and each rule holds', async () => {
    const { t, owner, pat, sam, admin, make, del, rule } = await team();
    expect(await rule(pat, 'authors')).toBe(403);
    expect(await rule(pat, 'makers')).toBe(200);
    expect(await rule(owner, 'authors')).toBe(200);
    expect(await del(sam, await make(pat, 'Open'))).toBe(204);

    expect(await rule(admin, 'owner')).toBe(200);
    expect(await del(pat, await make(pat, 'Locked'))).toBe(403);
    expect(await del(owner, await make(pat, 'Owned'))).toBe(204);
    expect(await rule(owner, 'everyone')).toBe(400);
    await t.ctx.db.close();
  });

  test('by id, the dependents go with it and the activity keeps the delete', async () => {
    const { t, ws, pat, sam, make } = await team();
    const d = await make(pat, 'Gone');
    await t.json(`/api/v1/workspaces/${ws.slug}/documents/${d.slug}/comments`, { method: 'POST', headers: pat.headers, body: JSON.stringify({ text: 'hello', view: 'context' }) });
    expect((await t.app.request(`/api/v1/documents/${d.id}`, { method: 'DELETE', headers: sam.headers })).status).toBe(403);
    expect((await t.app.request(`/api/v1/documents/${d.id}`, { method: 'DELETE', headers: pat.headers })).status).toBe(204);
    const left = await t.ctx.db.query<{ n: number }>('select (select count(*) from versions where document_id = $1)::int + (select count(*) from comments where document_id = $1)::int as n', [d.id]);
    expect(left[0]!.n).toBe(0);
    const feed = await (await t.app.request(`/w/${ws.slug}?tab=activity`, { headers: pat.headers })).text();
    expect(feed).toContain('deleted <b>Gone</b>');
    await t.ctx.db.close();
  });

  test('cards offer delete only where the rule lets the reader, and the members tab shows the rule', async () => {
    const { t, ws, owner, sam, pat, make } = await team();
    const d = await make(pat, 'Card');
    const page = async (by: Caller, tab = '') => (await t.app.request(`/w/${ws.slug}${tab}`, { headers: by.headers })).text();
    expect(await page(pat)).toContain(`data-delete="/api/v1/documents/${d.id}"`);
    expect(await page(sam)).not.toContain(`data-delete="/api/v1/documents/${d.id}"`);
    expect(await page(owner, '?tab=members')).toContain('data-setting="deleteDiagrams"');
    const samMembers = await page(sam, '?tab=members');
    expect(samMembers).not.toContain('data-setting="deleteDiagrams"');
    expect(samMembers).toContain('The person who made it');
    await t.ctx.db.close();
  });

  test('an agent deletes through vantage_delete under the same rule', async () => {
    const { t, ws, pat, sam, make } = await team();
    const d = await make(pat, 'Agent');
    const call = async (by: Caller) => {
      const client = new Client({ name: 'test', version: '0' });
      const fetchViaApp = (input: string | URL, init?: RequestInit): Promise<Response> => Promise.resolve(t.app.request(String(input), init));
      await client.connect(new StreamableHTTPClientTransport(new URL('http://hub.test/mcp'), { fetch: fetchViaApp, requestInit: { headers: by.headers } }));
      const r = (await client.callTool({ name: 'vantage_delete', arguments: { workspace: ws.slug, document: d.slug } })) as { content: { text: string }[]; isError?: boolean };
      await client.close();
      return r;
    };
    const refused = await call(sam);
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain('403');
    expect((await call(pat)).content[0]!.text).toBe(`deleted ${ws.slug}/${d.slug} (Agent)`);
    expect((await t.ctx.db.query('select 1 from documents where id = $1', [d.id])).length).toBe(0);
    await t.ctx.db.close();
  });
});

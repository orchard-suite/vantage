import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { testApp, SAMPLE_YAML } from './testing.ts';
import { createWorker } from './worker/loop.ts';
import { channelName } from './db/db.ts';
import { DOC_CHANNEL_PREFIX } from './worker/artifacts.ts';
import type { BoxReactions } from './reactions.ts';

async function seeded() {
  const t = await testApp();
  const me = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
  const created = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML }) });
  await createWorker(t.ctx).drain();
  const id = (created.body['document'] as { id: string }).id;
  return { t, me, ws, id, base: `/api/v1/documents/${id}` };
}

const list = async (t: Awaited<ReturnType<typeof testApp>>, path: string, headers: Record<string, string>): Promise<BoxReactions[]> => (await t.json(path, { headers })).body['reactions'] as BoxReactions[];

describe('reactions', () => {
  test('one of each kind per person per box, toggled, counted with who, and mine', async () => {
    const { t, me, base } = await seeded();
    const other = await t.bearer('other', { admin: true });
    const add = (h: Record<string, string>, kind: string, box = 'shop-api') => t.json(`${base}/reactions`, { method: 'POST', headers: h, body: JSON.stringify({ view: 'context', box, kind }) });
    expect((await add(me.headers, 'up')).status).toBe(201);
    expect((await add(me.headers, 'up')).body['added']).toBe(false);
    expect((await add(me.headers, 'question')).status).toBe(201);
    expect((await add(other.headers, 'up')).status).toBe(201);
    expect((await add(other.headers, 'up', 'orders-db')).status).toBe(201);
    const rows = await list(t, `${base}/reactions`, me.headers);
    expect(rows.map((r) => r.box)).toEqual(['shop-api', 'orders-db']);
    expect(rows[0]!.kinds.up.count).toBe(2);
    expect(rows[0]!.kinds.up.people.map((p) => p.label).sort()).toEqual(['author', 'other']);
    expect(rows[0]!.kinds.up.mine).toBe(true);
    expect(rows[0]!.kinds.question.count).toBe(1);
    expect(rows[1]!.kinds.up.mine).toBe(false);
    const removed = await t.json(`${base}/reactions`, { method: 'DELETE', headers: me.headers, body: JSON.stringify({ view: 'context', box: 'shop-api', kind: 'up' }) });
    expect(removed.body['removed']).toBe(true);
    expect((await list(t, `${base}/reactions`, me.headers))[0]!.kinds.up.count).toBe(1);
    expect((await t.ctx.db.query("select what from audit where what like 'reaction.%' order by at")).length).toBe(5);
  });

  test('looks wrong files a comment on the box with the sentence, and the flagged box leads the list', async () => {
    const { t, me, base } = await seeded();
    await t.json(`${base}/reactions`, { method: 'POST', headers: me.headers, body: JSON.stringify({ view: 'context', box: 'orders-db', kind: 'up' }) });
    const wrong = await t.json(`${base}/reactions`, { method: 'POST', headers: me.headers, body: JSON.stringify({ view: 'context', box: 'shop-api', kind: 'wrong', text: 'this is a queue, not an API' }) });
    expect(wrong.status).toBe(201);
    const comment = wrong.body['comment'] as { text: string; targets: string[]; view: string };
    expect(comment).toMatchObject({ text: 'Looks wrong: this is a queue, not an API', targets: ['shop-api'], view: 'context' });
    expect((await list(t, `${base}/reactions`, me.headers))[0]!.box).toBe('shop-api');
    const sentence = await t.json(`${base}/reactions`, { method: 'POST', headers: me.headers, body: JSON.stringify({ view: 'context', box: 'shop-api', kind: 'up', text: 'nice' }) });
    expect(sentence.status).toBe(400);
  });

  test('refuses a box the view does not have, and keeps reactions on a box a save dropped as orphaned', async () => {
    const { t, me, ws, base } = await seeded();
    expect((await t.json(`${base}/reactions`, { method: 'POST', headers: me.headers, body: JSON.stringify({ view: 'context', box: 'nope', kind: 'up' }) })).status).toBe(400);
    expect((await t.json(`${base}/reactions`, { method: 'POST', headers: me.headers, body: JSON.stringify({ view: 'gone', box: 'shop-api', kind: 'up' }) })).status).toBe(400);
    await t.json(`${base}/reactions`, { method: 'POST', headers: me.headers, body: JSON.stringify({ view: 'context', box: 'orders-db', kind: 'question' }) });
    const yaml = SAMPLE_YAML.replace('  - name: Orders DB\n    type: database\n', '').replace("  - { from: shop-api, to: orders-db, label: writes, tags: [context] }\n", '');
    expect((await t.json(`/api/v1/workspaces/${ws.slug}/documents/sample`, { method: 'PUT', headers: me.headers, body: JSON.stringify({ yaml }) })).status).toBe(200);
    await createWorker(t.ctx).drain();
    const rows = await list(t, `/api/v1/workspaces/${ws.slug}/documents/sample/reactions`, me.headers);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ box: 'orders-db', orphaned: true });
  });

  test('every change goes out on the live channel', async () => {
    const { t, me, id, base } = await seeded();
    const heard: string[] = [];
    const stop = await t.ctx.db.listen(channelName(DOC_CHANNEL_PREFIX, id), (p) => heard.push(p));
    await t.json(`${base}/reactions`, { method: 'POST', headers: me.headers, body: JSON.stringify({ view: 'context', box: 'shop-api', kind: 'up' }) });
    await t.json(`${base}/reactions`, { method: 'DELETE', headers: me.headers, body: JSON.stringify({ view: 'context', box: 'shop-api', kind: 'up' }) });
    await new Promise((r) => setTimeout(r, 50));
    await stop();
    expect(heard.filter((p) => p === '{"reactions":true}')).toHaveLength(2);
  });

  test('agents list, add, and remove through MCP, and mention through vantage_comment', async () => {
    const { t, me, ws } = await seeded();
    const transport = new StreamableHTTPClientTransport(new URL('http://hub.test/mcp'), { fetch: (input, init) => Promise.resolve(t.app.request(String(input), init)), requestInit: { headers: me.headers } });
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(transport);
    const call = async (name: string, args: Record<string, unknown>): Promise<string> => ((await client.callTool({ name, arguments: { workspace: ws.slug, document: 'sample', ...args } })).content as { text: string }[])[0]!.text;
    expect(await call('vantage_reactions', { action: 'add', view: 'context', box: 'shop-api', kind: 'wrong', text: 'wrong arrow' })).toMatch(/^added wrong on context\/shop-api; filed comment /);
    expect(await call('vantage_reactions', { action: 'list' })).toBe('context/shop-api  looks wrong 1 (author)');
    expect(await call('vantage_reactions', { action: 'remove', view: 'context', box: 'shop-api', kind: 'wrong' })).toBe('removed wrong from context/shop-api');
    const people = await call('vantage_people', {});
    expect(people).toContain(`<@${me.principal.userId}>  author`);
    expect(await call('vantage_comment', { text: `note for <@${me.principal.userId}>`, view: 'context' })).toMatch(/^comment \S+ added$/);
    const comments = await call('vantage_comments', {});
    expect(comments).toContain(`mentions=author <@${me.principal.userId}>`);
    expect(comments).toContain('note for @author');
    const outsider = await t.bearer('outsider');
    expect(await call('vantage_comment', { text: `<@${outsider.principal.userId}>`, view: 'context' })).toContain('400: cannot mention outsider');
    await client.close();
  });
});

import { describe, expect, test } from 'bun:test';
import { testApp, type TestApp } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';
import { GENERATE_TOOL, judge, splitPrompt, NOTES_MARK, unfence } from './generate.ts';
import { validate } from '@vantage/server';

const AI_ENV = { AI_BASE_URL: 'https://gateway.test/v1', AI_API_KEY: 'org-key', AI_MODEL: 'claude-test', AI_DAILY_TOKENS: '5000' };

const GOOD = `title: Checkout
nodes:
  - name: Shoppers
    type: users
  - name: Orders API
    type: api
  - name: Orders DB
    type: database
relations:
  - { from: shoppers, to: orders-api, label: buys, tags: [flow] }
  - { from: orders-api, to: orders-db, label: writes, tags: [flow] }
views:
  - id: flow
    title: Order flow
    question: How does an order get stored?
    include: { tags: [flow] }
`;

const BROKEN = GOOD.replace('to: orders-db', 'to: nowhere');

interface Call {
  readonly body: Record<string, unknown>;
}

/** A model API that lists two models and answers each POST with the next document in line. */
function modelApi(docs: readonly string[], usage = { input_tokens: 1000, output_tokens: 200 }): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let next = 0;
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (String(input).endsWith('/models')) return Response.json({ data: [{ id: 'gpt-test' }, { id: 'claude-test' }] });
    calls.push({ body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    const yaml = docs[next++];
    if (yaml === undefined) return Response.json({ error: { message: 'no more answers' } }, { status: 500 });
    return Response.json({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'diagram', input: { yaml, summary: 'A checkout.' } }], usage });
  };
  return { fetch: Object.assign(impl, { preconnect: () => undefined }), calls };
}

async function setup(docs: readonly string[], env: Record<string, string> = AI_ENV): Promise<{ t: TestApp; api: ReturnType<typeof modelApi>; headers: Record<string, string>; ws: string }> {
  const api = modelApi(docs);
  const t = await testApp({ env, fetch: api.fetch });
  const me = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
  return { t, api, headers: me.headers, ws: ws.slug };
}

describe('diagrams from a description', () => {
  test('a broken first draft goes back once with its errors; the fixed draft is ready, unsaved, and both calls count on one row', async () => {
    const { t, api, headers, ws } = await setup([BROKEN, GOOD]);
    const status = await t.json('/api/v1/generate', { headers });
    expect(status.body).toMatchObject({ enabled: true, models: ['claude-test', 'gpt-test'], defaultModel: 'claude-test' });

    const asked = await t.json('/api/v1/generations', { method: 'POST', headers, body: JSON.stringify({ workspace: ws, description: 'Shoppers buy through an orders API that stores orders.', notes: 'The database is Postgres.' }) });
    expect(asked.status).toBe(202);
    expect(asked.body['state']).toBe('queued');
    const again = await t.json('/api/v1/generations', { method: 'POST', headers, body: JSON.stringify({ workspace: ws, description: 'Another one' }) });
    expect(again.status).toBe(409);

    await createWorker(t.ctx).drain();
    expect(api.calls.length).toBe(2);
    const first = api.calls[0]!.body;
    expect(String(first['system'])).toContain('# Your task');
    expect((first['tool_choice'] as { name: string }).name).toBe(GENERATE_TOOL.name);
    const prompt = String((first['messages'] as { content: string }[])[0]!.content);
    expect(prompt).toContain('Shoppers buy through an orders API');
    expect(prompt).toContain('The database is Postgres.');
    expect(String((api.calls[1]!.body['messages'] as { content: string }[])[0]!.content)).toContain('nowhere');

    const done = await t.json(`/api/v1/generations/${asked.body['id'] as string}`, { headers });
    expect(done.body).toMatchObject({ state: 'ready', model: 'claude-test', yaml: GOOD, tokens: { input: 2000, output: 400 } });
    expect(String(done.body['summary'])).toContain('A checkout.');
    expect((await t.json(`/api/v1/workspaces/${ws}/documents`, { headers })).body['documents']).toEqual([]);

    const other = await t.bearer('other');
    expect((await t.json(`/api/v1/generations/${asked.body['id'] as string}`, { headers: other.headers })).status).toBe(404);

    const admin = await t.bearer('boss', { admin: true });
    const usage = await t.json('/api/v1/admin/ai-usage', { headers: admin.headers });
    expect(usage.body['people']).toMatchObject([{ name: 'author', revisions: 0, generations: 1, total: 2400, models: [{ model: 'claude-test', kind: 'generate', requests: 1, total: 2400 }] }]);
    const page = await (await t.app.request('/admin/revisions', { headers: admin.headers })).text();
    expect(page).toContain('claude-test <span class="pill">drawn</span> 2.4k');
    await t.ctx.db.close();
  });

  test('generations spend against the same daily limit as revisions', async () => {
    const { t, headers, ws } = await setup([GOOD], { ...AI_ENV, AI_DAILY_TOKENS: '1000' });
    const me = (await t.ctx.db.query<{ id: string }>("select id from users where subject = 'author'"))[0]!.id;
    await t.ctx.db.query("insert into revisions (id, org_id, requested_by, comment_ids, model, state, input_tokens) values ('r1', 'default', $1, '{}', 'claude-test', 'accepted', 1000)", [me]);
    const refused = await t.json('/api/v1/generations', { method: 'POST', headers, body: JSON.stringify({ workspace: ws, description: 'Anything' }) });
    expect(refused.status).toBe(429);
    await t.ctx.db.close();
  });

  test('a hub without a model API says so, and the New page offers no Describe it', async () => {
    const t = await testApp();
    const me = await t.bearer('author');
    expect((await t.json('/api/v1/generate', { headers: me.headers })).body).toEqual({ enabled: false });
    const html = await (await t.app.request('/new', { headers: me.headers })).text();
    expect(html).not.toContain('id="new-describe"');
    expect(html).toContain('src="/editor.js?v=');
    await t.ctx.db.close();
  });

  test('the New page offers Describe it with the models and the allowance when the hub has a model API', async () => {
    const { t, headers } = await setup([]);
    const html = await (await t.app.request('/new', { headers })).text();
    expect(html).toContain('id="new-describe"');
    const setup2 = JSON.parse(/<script type="application\/json" id="new-ai">(.*?)<\/script>/.exec(html)![1]!) as { models: string[]; allowance: { daily: number } };
    expect(setup2.models).toEqual(['claude-test', 'gpt-test']);
    expect(setup2.allowance.daily).toBe(5000);
    await t.ctx.db.close();
  });
});

describe('judging a draft', () => {
  test('errors and weak views make a retry note; a clean file does not', () => {
    const bad = judge(validate({ text: BROKEN }));
    expect(bad.errors).toBeGreaterThan(0);
    expect(bad.retry).toContain('error');
    const good = judge(validate({ text: GOOD }));
    expect(good.errors).toBe(0);
    expect(good.retry).toBeUndefined();
    const none = judge(validate({ text: 'title: Empty\nnodes:\n  - name: A\n' }));
    expect(none.retry).toContain('no views');
  });

  test('a fenced answer loses its fence, and the stored prompt splits back into description and notes', () => {
    expect(unfence('```yaml\ntitle: A\n```')).toBe('title: A\n');
    expect(unfence('title: A\n')).toBe('title: A\n');
    expect(splitPrompt(`words${NOTES_MARK}notes`)).toEqual({ description: 'words', notes: 'notes' });
    expect(splitPrompt('words')).toEqual({ description: 'words', notes: undefined });
  });
});

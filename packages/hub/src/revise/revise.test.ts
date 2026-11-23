import { describe, expect, test } from 'bun:test';
import { testApp, type TestApp } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';
import { silentLogger } from '../log.ts';
import { loadConfig } from '../config.ts';
import { TEST_ENV } from '../testing.ts';
import { providerFromConfig, wireFor } from './provider.ts';
import { REVISE_TOOL, revisePrompt, tryAnswer } from './run.ts';
import type { CommentRow } from '../comments.ts';

const AI_ENV = { AI_BASE_URL: 'https://gateway.test/v1', AI_API_KEY: 'org-key', AI_MODEL: 'claude-test', AI_DAILY_TOKENS: '5000' };

const YAML = `title: Shop
nodes:
  - name: Shoppers
    type: users
  - name: Orders API
    type: api # the front door
  - name: Orders DB
    type: database
relations:
  - { from: shoppers, to: orders-api, label: buys, tags: [context] }
  - { from: orders-api, to: orders-db, label: writes, tags: [context] }
views:
  - id: context
    title: Context
    include: { tags: [context] }
`;

interface Call {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

/** A model API that answers /models, and each POST with the next answer in line. */
function modelApi(answers: readonly ((body: Record<string, unknown>) => { status?: number; json: unknown })[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let next = 0;
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-test' }, { id: 'claude-test' }] });
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url, headers, body });
    const answer = answers[next++];
    if (!answer) return Response.json({ error: { message: 'no more answers' } }, { status: 500 });
    const out = answer(body);
    return Response.json(out.json, { status: out.status ?? 200 });
  };
  return { fetch: Object.assign(impl, { preconnect: () => undefined }), calls };
}

/** An Anthropic answer that calls the revise tool. */
const claude = (input: unknown, usage: Record<string, number> = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 5 }) => () => ({ json: { stop_reason: 'tool_use', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'revise', input }], usage } });

async function setup(answers: Parameters<typeof modelApi>[0], env: Record<string, string> = AI_ENV): Promise<{ t: TestApp; api: ReturnType<typeof modelApi>; headers: Record<string, string>; id: string; comments: string[] }> {
  const api = modelApi(answers);
  const t = await testApp({ env, fetch: api.fetch });
  const me = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
  const created = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: YAML, message: 'first' }) });
  const id = (created.body['document'] as { id: string }).id;
  const comments: string[] = [];
  for (const [text, targets] of [['Call it Orders Service', ['orders-api']], ['Say Postgres under the database', ['orders-db']]] as const) {
    const c = await t.json(`/api/v1/documents/${id}/comments`, { method: 'POST', headers: me.headers, body: JSON.stringify({ text, view: 'context', targets }) });
    comments.push(c.body['id'] as string);
  }
  return { t, api, headers: me.headers, id, comments };
}

const GOOD = (comments: readonly string[]) => ({
  operations: [
    { op: 'add', path: 'nodes.orders-api', value: { id: 'orders-api' } },
    { op: 'set', path: 'nodes.orders-api.name', value: 'Orders Service' },
    { op: 'set', path: 'nodes.orders-db.subtitle', value: 'Postgres' },
  ],
  summary: 'Renamed the API and named the database engine.',
  addressed: [...comments, 'not-a-comment'],
});

describe('revise from comments', () => {
  test('a revision proposes edits, previews as a diff, and accepting saves them and resolves the comments', async () => {
    let comments: string[] = [];
    const { t, api, headers, id, comments: ids } = await setup([(b) => claude(GOOD(comments))()]);
    comments = ids;
    const status = await t.json(`/api/v1/documents/${id}/revise`, { headers });
    expect(status.body).toMatchObject({ enabled: true, canRevise: true, models: ['claude-test', 'gpt-test'], defaultModel: 'claude-test', allowance: { blocked: false, today: 0, daily: 5000, month: 0, monthly: null, orgMonth: 0, orgMonthly: null }, latest: null });

    const asked = await t.json(`/api/v1/documents/${id}/revisions`, { method: 'POST', headers, body: JSON.stringify({ comments }) });
    expect(asked.status).toBe(202);
    expect(asked.body['state']).toBe('queued');
    const again = await t.json(`/api/v1/documents/${id}/revisions`, { method: 'POST', headers, body: JSON.stringify({ comments }) });
    expect(again.status).toBe(409);

    await createWorker(t.ctx).drain();
    const rev = await t.json(`/api/v1/documents/${id}/revisions/${asked.body['id'] as string}`, { headers });
    expect(rev.body).toMatchObject({ state: 'ready', model: 'claude-test', addressed: comments, tokens: { input: 100, output: 20, cacheRead: 30, cacheWrite: 5 } });

    const call = api.calls[0]!;
    expect(call.url).toBe('https://gateway.test/v1/messages');
    expect(call.headers['x-api-key']).toBe('org-key');
    expect(call.headers['anthropic-version']).toBe('2023-06-01');
    expect(call.body['tool_choice']).toEqual({ type: 'tool', name: 'revise' });
    const prompt = (call.body['messages'] as { content: string }[])[0]!.content;
    expect(prompt).toContain('boxes orders-api (Orders API)');
    expect(prompt).toContain('Say Postgres under the database');
    expect(String(call.body['system'])).toContain('# Your task');

    const diff = await t.json(`/api/v1/documents/${id}/revisions/${asked.body['id'] as string}/diff/context.json`, { headers });
    expect(diff.status).toBe(200);
    expect((diff.body['changes'] as unknown[]).length).toBeGreaterThan(0);

    const accepted = await t.json(`/api/v1/documents/${id}/revisions/${asked.body['id'] as string}/accept`, { method: 'POST', headers, body: '{}' });
    expect(accepted.status).toBe(200);
    expect(accepted.body['status']).toBe('saved');
    const version = (accepted.body['version'] as { id: string; message: string });
    expect(version.message).toBe('revise: Renamed the API and named the database engine.');
    const yaml = (await t.ctx.db.query<{ yaml: string }>('select yaml from versions where id = $1', [version.id]))[0]!.yaml;
    expect(yaml).toContain('name: Orders Service');
    expect(yaml).toContain('subtitle: Postgres');
    expect(yaml).toContain('# the front door');
    const open = await t.json(`/api/v1/documents/${id}/comments`, { headers });
    expect((open.body['counts'] as { total: number }).total).toBe(0);
    const twice = await t.json(`/api/v1/documents/${id}/revisions/${asked.body['id'] as string}/accept`, { method: 'POST', headers, body: '{}' });
    expect(twice.status).toBe(409);

    const admin = await t.bearer('boss', { admin: true });
    const usage = await t.json('/api/v1/admin/ai-usage', { headers: admin.headers });
    expect(usage.body['people']).toMatchObject([{ name: 'author', revisions: 1, accepted: 1, input: 100, output: 20, cacheRead: 30, cacheWrite: 5, total: 155, models: [{ model: 'claude-test', total: 155 }] }]);
    const page = await (await t.app.request('/admin/revisions', { headers: admin.headers })).text();
    expect(page).toContain('<b>author</b><span>1 revision, 1 accepted, 0 diagrams drawn');
    expect(page).toContain('claude-test <span class="pill">revise</span> 155');
    expect(page).toContain('<span class="pill">35 cached</span>');
    const home = await (await t.app.request('/admin', { headers: admin.headers })).text();
    expect(home).toContain('<dt>AI revisions from comments</dt><dd>On, with claude-test</dd>');
    await t.ctx.db.close();
  });

  test('edits that do not apply are sent back once with the reason, and both calls are counted', async () => {
    let comments: string[] = [];
    const { t, api, headers, id, comments: ids } = await setup([claude({ operations: [{ op: 'set', path: 'nodes.nope.name', value: 'X' }], summary: 'Tried.', addressed: [] }), (b) => claude(GOOD(comments))()]);
    comments = ids;
    const asked = await t.json(`/api/v1/documents/${id}/revisions`, { method: 'POST', headers, body: JSON.stringify({ comments }) });
    await createWorker(t.ctx).drain();
    const rev = await t.json(`/api/v1/documents/${id}/revisions/${asked.body['id'] as string}`, { headers });
    expect(rev.body).toMatchObject({ state: 'ready', tokens: { input: 200, output: 40, cacheRead: 60, cacheWrite: 10 } });
    expect(api.calls.length).toBe(2);
    expect((api.calls[1]!.body['messages'] as { content: string }[])[0]!.content).toContain('Your last answer could not be used');
    const rejected = await t.json(`/api/v1/documents/${id}/revisions/${asked.body['id'] as string}/reject`, { method: 'POST', headers, body: '{}' });
    expect(rejected.body['state']).toBe('rejected');
    expect(((await t.json(`/api/v1/documents/${id}/comments`, { headers })).body['counts'] as { total: number }).total).toBe(2);
    await t.ctx.db.close();
  });

  test('a refused key fails the revision with what to say; the daily limit and bad requests are refused up front', async () => {
    const { t, headers, id, comments } = await setup([() => ({ status: 401, json: { error: { message: 'bad key' } } })], { ...AI_ENV, AI_DAILY_TOKENS: '1' });
    expect((await t.json(`/api/v1/documents/${id}/revisions`, { method: 'POST', headers, body: JSON.stringify({ comments: ['nope'] }) })).status).toBe(400);
    expect((await t.json(`/api/v1/documents/${id}/revisions`, { method: 'POST', headers, body: JSON.stringify({ comments, model: 'other' }) })).status).toBe(400);
    const asked = await t.json(`/api/v1/documents/${id}/revisions`, { method: 'POST', headers, body: JSON.stringify({ comments }) });
    await createWorker(t.ctx).drain();
    const rev = await t.json(`/api/v1/documents/${id}/revisions/${asked.body['id'] as string}`, { headers });
    expect(rev.body['state']).toBe('failed');
    expect(rev.body['error']).toBe("the model API refused the organization's key (401): bad key");
    // A failed revision no longer holds the document; this person spent nothing, so the next one may run.
    const next = await t.json(`/api/v1/documents/${id}/revisions`, { method: 'POST', headers, body: JSON.stringify({ comments, model: 'gpt-test' }) });
    expect(next.status).toBe(202);
    await t.ctx.db.query('update revisions set input_tokens = 5 where id = $1', [next.body['id']]);
    await t.ctx.db.query("update revisions set state = 'failed' where id = $1", [next.body['id']]);
    const over = await t.json(`/api/v1/documents/${id}/revisions`, { method: 'POST', headers, body: JSON.stringify({ comments }) });
    expect(over.status).toBe(429);
    await t.ctx.db.close();
  });

  test('without a model API the feature is off', async () => {
    const { t, headers, id, comments } = await setup([], {});
    expect((await t.json(`/api/v1/documents/${id}/revise`, { headers })).body).toEqual({ enabled: false });
    expect((await t.json(`/api/v1/documents/${id}/revisions`, { method: 'POST', headers, body: JSON.stringify({ comments }) })).status).toBe(404);
    await t.ctx.db.close();
  });
});

describe('the model provider', () => {
  test('Claude models speak Messages, the rest speak Responses, with the key in the configured header', async () => {
    expect(wireFor('claude-sonnet-5-5')).toBe('anthropic');
    expect(wireFor('gpt-5')).toBe('openai');
    const api = modelApi([() => ({ json: { status: 'completed', output: [{ type: 'function_call', name: 'revise', arguments: '{"operations":[],"summary":"x","addressed":[]}' }], usage: { input_tokens: 7, output_tokens: 3, input_tokens_details: { cached_tokens: 4 } } } })]);
    const ai = providerFromConfig(loadConfig({ ...TEST_ENV, ...AI_ENV, AI_KEY_HEADER: 'Authorization' }), api.fetch, silentLogger)!;
    const answer = await ai.ask({ model: 'gpt-test', system: 'sys', prompt: 'do it', tool: REVISE_TOOL, maxTokens: 100 });
    expect(answer).toEqual({ input: { operations: [], summary: 'x', addressed: [] }, usage: { input: 3, output: 3, cacheRead: 4, cacheWrite: 0 } });
    const call = api.calls[0]!;
    expect(call.url).toBe('https://gateway.test/v1/responses');
    expect(call.headers['authorization']).toBe('Bearer org-key');
    expect(call.body).toMatchObject({ model: 'gpt-test', instructions: 'sys', input: 'do it', max_output_tokens: 100, tool_choice: { type: 'function', name: 'revise' } });
  });

  test('a cut-off answer is an error that still counts its tokens', async () => {
    const api = modelApi([() => ({ json: { stop_reason: 'max_tokens', content: [], usage: { input_tokens: 9, output_tokens: 100 } } })]);
    const ai = providerFromConfig(loadConfig({ ...TEST_ENV, ...AI_ENV }), api.fetch, silentLogger)!;
    const err = await ai.ask({ model: 'claude-test', system: 's', prompt: 'p', tool: REVISE_TOOL, maxTokens: 100 }).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'ModelError', usage: { input: 9, output: 100, cacheRead: 0, cacheWrite: 0 } });
  });

  test('a model API that cannot list its models offers the default alone', async () => {
    const ai = providerFromConfig(loadConfig({ ...TEST_ENV, ...AI_ENV }), Object.assign(async () => new Response('down', { status: 503 }), { preconnect: () => undefined }), silentLogger)!;
    expect(await ai.models()).toEqual(['claude-test']);
  });

  test('the base URL needs a key and a default model', () => {
    expect(() => loadConfig({ ...TEST_ENV, AI_BASE_URL: 'https://gateway.test/v1' })).toThrow(/AI_API_KEY is required[\s\S]*AI_MODEL is required/);
  });
});

describe('answers', () => {
  const comment = (over: Partial<CommentRow>): CommentRow => ({ id: 'c1', org_id: 'o', document_id: 'd', view_id: 'context', targets: [], text: 'Fix it', author_user_id: 'u', resolved_by: null, resolved_at: null, created_at: new Date(), ...over });

  test('the prompt names each comment, its view, and its boxes by name', () => {
    const p = revisePrompt(YAML, {}, [comment({ targets: ['orders-db', 'gone'] }), comment({ id: 'c2', view_id: null, text: 'Line one\nline two' })]);
    expect(p).toContain('- Comment c1, on view context (Context), boxes orders-db (Orders DB), gone:\n  Fix it');
    expect(p).toContain('- Comment c2, on the whole document:\n  Line one\n  line two');
  });

  test('an answer that adds errors or has no operations does not stand', () => {
    expect(tryAnswer(YAML, {}, { operations: [], summary: 's', addressed: [] })).toEqual({ ok: false, reason: 'the answer had no operations' });
    const broken = tryAnswer(YAML, {}, { operations: [{ op: 'set', path: 'relations.0.to', value: 'nowhere' }], summary: 's', addressed: [] });
    expect(broken.ok).toBe(false);
    expect(tryAnswer(YAML, {}, { operations: [{ op: 'set', path: 'nodes.shoppers.subtitle', value: 'People' }], summary: 's', addressed: [] }).ok).toBe(true);
  });
});

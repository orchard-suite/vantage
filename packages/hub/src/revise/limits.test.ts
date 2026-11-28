import { afterEach, describe, expect, test } from 'bun:test';
import { fakeFetch, testApp, type TestApp } from '../testing.ts';
import { randomId } from '../crypto.ts';
import { monthStart, setTimeZone } from '../day.ts';
import { allowance, refusal } from './limits.ts';

const AI_ENV = { AI_BASE_URL: 'https://gateway.test/v1', AI_API_KEY: 'org-key', AI_MODEL: 'claude-test', AI_DAILY_TOKENS: '5000' };

const YAML = `title: Shop
nodes:
  - name: Orders API
    type: api
views:
  - id: context
    title: Context
    include: { nodes: [orders-api] }
`;

interface Spend {
  readonly user: string;
  readonly model?: string;
  readonly at: Date;
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly state?: string;
  readonly kind?: 'revise' | 'generate';
}

/** Writes revision rows straight into the table, as if they had run. */
async function spent(t: TestApp, rows: readonly Spend[]): Promise<void> {
  for (const r of rows) {
    await t.ctx.db.query(
      "insert into revisions (id, org_id, requested_by, comment_ids, model, state, input_tokens, output_tokens, cache_read_tokens, created_at, kind) values ($1, 'default', $2, '{}', $3, $4, $5, $6, $7, $8, $9)",
      [randomId(), r.user, r.model ?? 'claude-test', r.state ?? 'accepted', r.input ?? 0, r.output ?? 0, r.cacheRead ?? 0, r.at, r.kind ?? 'revise'],
    );
  }
}

async function setup(): Promise<{ t: TestApp; admin: Awaited<ReturnType<TestApp['bearer']>>; author: Awaited<ReturnType<TestApp['bearer']>>; id: string; comment: string }> {
  const { fetch } = fakeFetch([{ match: '/models', json: { data: [{ id: 'claude-test' }] } }]);
  const t = await testApp({ env: AI_ENV, fetch });
  const admin = await t.bearer('boss', { admin: true });
  const author = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: author.headers })).body['workspaces'] as { slug: string }[])[0]!;
  const created = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: author.headers, body: JSON.stringify({ yaml: YAML }) });
  const id = (created.body['document'] as { id: string }).id;
  const c = await t.json(`/api/v1/documents/${id}/comments`, { method: 'POST', headers: author.headers, body: JSON.stringify({ text: 'Say the runtime', view: 'context', targets: ['orders-api'] }) });
  return { t, admin, author, id, comment: c.body['id'] as string };
}

describe('usage over time', () => {
  test('a month splits by person, model, and kind, the trend covers 12 months, and the CSV has a line per person, model, and kind', async () => {
    const { t, admin, author } = await setup();
    await spent(t, [
      { user: author.principal.userId, at: new Date('2026-10-03T10:00:00Z'), input: 100, output: 10, cacheRead: 50 },
      { user: author.principal.userId, model: 'gpt-test', at: new Date('2026-10-20T10:00:00Z'), input: 40, output: 4, state: 'rejected' },
      { user: admin.principal.userId, at: new Date('2026-10-31T23:59:00Z'), input: 10, output: 1 },
      { user: author.principal.userId, at: new Date('2026-11-01T00:00:00Z'), input: 999 },
      { user: author.principal.userId, at: new Date('2026-08-15T00:00:00Z'), input: 7 },
      { user: author.principal.userId, at: new Date('2026-10-12T10:00:00Z'), input: 30, output: 3, state: 'ready', kind: 'generate' },
    ]);
    const r = await t.json('/api/v1/admin/ai-usage?month=2026-10', { headers: admin.headers });
    expect(r.body['month']).toBe('2026-10');
    expect(r.body['people']).toMatchObject([
      { name: 'author', revisions: 2, generations: 1, accepted: 1, input: 170, output: 17, cacheRead: 50, total: 237, models: [{ model: 'claude-test', kind: 'revise', total: 160 }, { model: 'gpt-test', kind: 'revise', total: 44 }, { model: 'claude-test', kind: 'generate', requests: 1, total: 33 }] },
      { name: 'boss', total: 11 },
    ]);
    const months = r.body['months'] as { month: string; tokens: number; revisions: number; generations: number; people: number }[];
    expect(months.length).toBe(12);
    expect(months[0]!.month).toBe('2025-11');
    expect(months.at(-1)).toEqual({ month: '2026-10', tokens: 248, revisions: 3, generations: 1, people: 2 });
    expect(months.find((m) => m.month === '2026-08')!.tokens).toBe(7);
    expect(months.find((m) => m.month === '2026-09')!.tokens).toBe(0);

    const csv = await (await t.app.request('/api/v1/admin/ai-usage.csv?month=2026-10', { headers: admin.headers })).text();
    expect(csv.split('\n')).toEqual([
      'month,person,model,kind,requests,accepted,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,total_tokens',
      '2026-10,author,claude-test,revise,1,1,100,10,50,0,160',
      '2026-10,author,gpt-test,revise,1,0,40,4,0,0,44',
      '2026-10,author,claude-test,generate,1,0,30,3,0,0,33',
      '2026-10,boss,claude-test,revise,1,1,10,1,0,0,11',
      '',
    ]);
    expect((await t.json('/api/v1/admin/ai-usage?month=2026-13', { headers: admin.headers })).status).toBe(400);
    expect((await t.json('/api/v1/admin/ai-usage', { headers: author.headers })).status).toBe(403);
    await t.ctx.db.close();
  });
});

describe('limits', () => {
  test('defaults come from the deployment until an admin sets them; a person may have their own or be blocked', async () => {
    const { t, admin, author, id, comment } = await setup();
    const ask = () => t.json(`/api/v1/documents/${id}/revisions`, { method: 'POST', headers: author.headers, body: JSON.stringify({ comments: [comment] }) });
    const allowance = async () => (await t.json(`/api/v1/documents/${id}/revise`, { headers: author.headers })).body['allowance'];
    expect((await t.json('/api/v1/admin/ai-limits', { headers: admin.headers })).body).toEqual({ defaults: { daily: 5000, monthly: null, orgMonthly: null }, people: [] });

    await spent(t, [{ user: author.principal.userId, at: new Date(), input: 900 }, { user: admin.principal.userId, at: new Date(), input: 3000 }]);
    const set = await t.json('/api/v1/admin/ai-limits', { method: 'PUT', headers: admin.headers, body: JSON.stringify({ daily: null, monthly: 1000, orgMonthly: 10_000 }) });
    expect(set.body['defaults']).toEqual({ daily: null, monthly: 1000, orgMonthly: 10_000 });
    expect(await allowance()).toEqual({ blocked: false, today: 900, daily: null, month: 900, monthly: 1000, orgMonth: 3900, orgMonthly: 10_000, timeZone: 'UTC' });

    // A month that is spent stops the person, and a limit of their own lifts it.
    await spent(t, [{ user: author.principal.userId, at: monthStart(new Date()), input: 100 }]);
    expect(await ask()).toMatchObject({ status: 429, body: { error: "you have used this month's model tokens; the limit resets on the first of the month (UTC)" } });
    const own = await t.json(`/api/v1/admin/ai-limits/users/${author.principal.userId}`, { method: 'PUT', headers: admin.headers, body: JSON.stringify({ monthly: 50_000 }) });
    expect(own.body['people']).toEqual([{ userId: author.principal.userId, name: 'author', daily: undefined, monthly: 50_000, blocked: false }]);
    expect((await ask()).status).toBe(202);
    await t.ctx.db.query("update revisions set state = 'failed' where state = 'queued'");

    // The organization's month stops everyone.
    await spent(t, [{ user: admin.principal.userId, at: new Date(), input: 6000 }]);
    expect(await ask()).toMatchObject({ status: 429, body: { error: "the organization has used this month's model tokens; the limit resets on the first of the month (UTC)" } });
    await t.json('/api/v1/admin/ai-limits', { method: 'PUT', headers: admin.headers, body: JSON.stringify({ daily: null, monthly: 1000, orgMonthly: null }) });

    await t.json(`/api/v1/admin/ai-limits/users/${author.principal.userId}`, { method: 'PUT', headers: admin.headers, body: JSON.stringify({ monthly: 50_000, blocked: true }) });
    expect(await ask()).toMatchObject({ status: 403, body: { error: 'an admin turned the model off for you' } });
    expect((await t.json(`/api/v1/admin/ai-limits/users/${author.principal.userId}`, { method: 'DELETE', headers: admin.headers })).status).toBe(204);
    expect((await ask()).status).toBe(429);

    expect((await t.json('/api/v1/admin/ai-limits', { method: 'PUT', headers: admin.headers, body: JSON.stringify({ daily: 0, monthly: null, orgMonthly: null }) })).status).toBe(400);
    expect((await t.json('/api/v1/admin/ai-limits/users/nobody', { method: 'PUT', headers: admin.headers, body: JSON.stringify({}) })).status).toBe(404);
    expect((await t.json('/api/v1/admin/ai-limits', { method: 'PUT', headers: author.headers, body: JSON.stringify({ daily: null, monthly: null, orgMonthly: null }) })).status).toBe(403);
    const audit = await t.ctx.db.query<{ what: string }>("select what from audit where what like 'ai.limits%' order by at");
    expect(audit.map((a) => a.what)).toEqual(['ai.limits.set', 'ai.limits.user.set', 'ai.limits.set', 'ai.limits.user.set', 'ai.limits.user.clear']);
    await t.ctx.db.close();
  });

  test('the Revisions tab shows the month, the chart against the cap, the limit forms, and people to give limits to', async () => {
    const { t, admin, author } = await setup();
    await spent(t, [{ user: author.principal.userId, at: new Date(), input: 1200, cacheRead: 300 }]);
    await t.json('/api/v1/admin/ai-limits', { method: 'PUT', headers: admin.headers, body: JSON.stringify({ daily: 5000, monthly: null, orgMonthly: 20_000 }) });
    const page = await (await t.app.request('/admin/revisions', { headers: admin.headers })).text();
    expect(page).toContain('<svg class="use-chart"');
    expect(page).toContain('Monthly limit 20k');
    expect(page).toContain("1.5k tokens this month of the organization's 20k.");
    expect(page).toContain('name="daily" value="5000"');
    expect(page).toContain('name="orgMonthly" value="20000"');
    expect(page).toContain('<span class="pill">300 cached</span>');
    expect(page).toContain('<option value="' + admin.principal.userId + '">boss</option>');
    expect(page).toContain('/api/v1/admin/ai-usage.csv?month=');
    const past = await (await t.app.request('/admin/revisions?month=2024-02', { headers: admin.headers })).text();
    expect(past).toContain('No model use in February 2024.');
    await t.ctx.db.close();
  });
});

describe('limit windows in the estate zone', () => {
  afterEach(() => setTimeZone('UTC'));

  test('a day resets at midnight in the estate zone, not at midnight UTC', async () => {
    const { t, author } = await setup();
    const me = author.principal.userId;
    // 2 PM and 6:30 PM on November 27 in Chicago; the second is already November 28 in UTC.
    await spent(t, [{ user: me, at: new Date('2026-11-27T20:00:00Z'), input: 3000 }, { user: me, at: new Date('2026-11-28T00:30:00Z'), input: 2500 }]);
    const evening = new Date('2026-11-28T01:00:00Z');
    expect((await allowance(t.ctx.db, t.ctx.config, 'default', me, evening)).today).toBe(2500);
    setTimeZone('America/Chicago');
    const a = await allowance(t.ctx.db, t.ctx.config, 'default', me, evening);
    expect(a.today).toBe(5500);
    expect(refusal(a)?.message).toBe("you have used today's model tokens; the limit resets at midnight (America/Chicago)");
    // Midnight in Chicago is 06:00 UTC: the day starts again then.
    expect((await allowance(t.ctx.db, t.ctx.config, 'default', me, new Date('2026-11-28T06:00:00Z'))).today).toBe(0);
    await t.ctx.db.close();
  });

  test('a month starts on the first in the estate zone, and the spend page counts the same months', async () => {
    const { t, admin, author } = await setup();
    const me = author.principal.userId;
    // 9 PM on November 30 in Chicago is December 1 in UTC.
    await spent(t, [{ user: me, at: new Date('2026-11-15T12:00:00Z'), input: 100 }, { user: me, at: new Date('2026-12-01T03:00:00Z'), input: 40 }]);
    const late = new Date('2026-12-01T04:00:00Z');
    expect((await allowance(t.ctx.db, t.ctx.config, 'default', me, late)).month).toBe(40);
    setTimeZone('America/Chicago');
    expect((await allowance(t.ctx.db, t.ctx.config, 'default', me, late)).month).toBe(140);
    const r = await t.json('/api/v1/admin/ai-usage?month=2026-11', { headers: admin.headers });
    expect((r.body['people'] as { total: number }[])[0]!.total).toBe(140);
    expect((r.body['months'] as { month: string; tokens: number }[]).at(-1)).toMatchObject({ month: '2026-11', tokens: 140 });
    await t.ctx.db.close();
  });
});

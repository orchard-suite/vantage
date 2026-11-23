import { describe, expect, test } from 'bun:test';
import { fakeFetch, testApp, SAMPLE_YAML, type TestOptions } from './testing.ts';
import { DEFAULT_ORG } from './auth/authenticate.ts';
import { postComment } from './mentions.ts';
import { listNotifications } from './notify/notify.ts';

/** An author's diagram, a reader granted through a team, and someone with no access. */
async function seeded(opts: TestOptions = {}) {
  const t = await testApp(opts);
  const author = await t.bearer('author');
  const reader = await t.bearer('reader');
  const outsider = await t.bearer('outsider');
  const ws = ((await t.json('/api/v1/workspaces', { headers: author.headers })).body['workspaces'] as { slug: string; id: string }[])[0]!;
  const created = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: author.headers, body: JSON.stringify({ yaml: SAMPLE_YAML }) });
  await t.ctx.db.query("insert into teams (id, org_id, name, slug) values ('t1', $1, 'Reviewers', 'reviewers')", [DEFAULT_ORG]);
  await t.ctx.db.query("insert into team_members (org_id, team_id, user_id) values ($1, 't1', $2)", [DEFAULT_ORG, reader.principal.userId]);
  await t.ctx.db.query("insert into grants (id, org_id, workspace_id, role, subject_kind, subject_id) values ('g1', $1, $2, 'viewer', 'team', 't1')", [DEFAULT_ORG, ws.id]);
  const doc = created.body['document'] as { id: string; slug: string; name: string };
  return { t, author, reader, outsider, ws, doc, base: `/api/v1/workspaces/${ws.slug}/documents/${doc.slug}` };
}

describe('mentions', () => {
  test('offers the people who can read the document, teams expanded, and refuses anyone else', async () => {
    const { t, author, reader, outsider, base, doc } = await seeded();
    const people = (await t.json(`${base}/people`, { headers: author.headers })).body['people'] as { id: string; label: string }[];
    expect(people.map((p) => p.id).sort()).toEqual([author.principal.userId, reader.principal.userId].sort());
    expect((await t.json(`/api/v1/documents/${doc.id}/people`, { headers: reader.headers })).status).toBe(200);

    const refused = await t.json(`${base}/comments`, { method: 'POST', headers: author.headers, body: JSON.stringify({ text: `hey <@${outsider.principal.userId}>`, view: 'context' }) });
    expect(refused.status).toBe(400);
    expect(String(refused.body['error'])).toContain('cannot mention outsider');
    expect((await t.ctx.db.query('select id from comments')).length).toBe(0);
  });

  test('stores mentions as ids, an email becomes the id, and the person is told with a deep link', async () => {
    const { t, author, reader, base, ws } = await seeded();
    const made = await t.json(`${base}/comments`, { method: 'POST', headers: author.headers, body: JSON.stringify({ text: 'please check <@reader@example.com>', view: 'context', targets: ['shop-api'] }) });
    expect(made.status).toBe(201);
    expect(made.body['text']).toBe(`please check <@${reader.principal.userId}>`);
    expect(made.body['mentions']).toEqual([reader.principal.userId]);

    const told = await t.ctx.db.query<{ user_id: string; kind: string; title: string; body: string }>('select user_id, kind, title, body from notifications');
    expect(told.length).toBe(1);
    expect(told[0]!.kind).toBe('mention');
    expect(told[0]!.user_id).toBe(reader.principal.userId);
    expect(told[0]!.title).toBe('author mentioned you in Sample');
    expect(told[0]!.body).toContain('please check @reader');
    expect(told[0]!.body).toContain(`http://hub.test/w/${ws.slug}/sample#context/shop-api`);
    // A person's notification stays off the workspace's own list.
    expect((await listNotifications(t.ctx, ws.id)).length).toBe(0);

    const mine = (await t.json('/api/v1/me/mentions', { headers: reader.headers })).body['mentions'] as { text: string; link: string; authorLabel: string; view: string }[];
    expect(mine.length).toBe(1);
    expect(mine[0]!.text).toBe('please check @reader');
    expect(mine[0]!.authorLabel).toBe('author');
    expect(mine[0]!.link).toBe(`http://hub.test/w/${ws.slug}/sample#context/shop-api`);
    expect(((await t.json('/api/v1/me/mentions', { headers: author.headers })).body['mentions'] as unknown[]).length).toBe(0);
    const page = await (await t.app.request('/?show=mentions', { headers: reader.headers })).text();
    expect(page).toContain('href="/?show=mentions" aria-current="page"');
    expect(page).toContain(`href="http://hub.test/w/${ws.slug}/sample#context/shop-api"`);
    expect(page).toContain('please check @reader');
    expect(await (await t.app.request('/?show=mentions', { headers: author.headers })).text()).toContain('Nobody has mentioned you yet.');

    const viewerList = (await t.json(`/api/v1/documents/${String((await t.ctx.db.query<{ id: string }>('select id from documents'))[0]!.id)}/comments`, { headers: reader.headers })).body['comments'] as { mentionLabels: Record<string, string> }[];
    expect(viewerList[0]!.mentionLabels).toEqual({ [reader.principal.userId]: 'reader' });
  });

  test('an edit tells only the people it newly mentions, and drops the ones it no longer names', async () => {
    const { t, author, reader, base } = await seeded();
    const third = await t.bearer('third');
    const wsId = (await t.ctx.db.query<{ id: string }>('select workspace_id as id from documents'))[0]!.id;
    await t.ctx.db.query("insert into grants (id, org_id, workspace_id, role, subject_kind, subject_id) values ('g2', $1, $2, 'viewer', 'user', $3)", [DEFAULT_ORG, wsId, third.principal.userId]);
    const made = await t.json(`${base}/comments`, { method: 'POST', headers: author.headers, body: JSON.stringify({ text: `<@${reader.principal.userId}> look`, view: 'context' }) });
    const id = String(made.body['id']);
    const edited = await t.json(`${base}/comments/${id}`, { method: 'PATCH', headers: author.headers, body: JSON.stringify({ text: `<@${reader.principal.userId}> and <@${third.principal.userId}> look` }) });
    expect(edited.status).toBe(200);
    const told = await t.ctx.db.query<{ user_id: string }>("select user_id from notifications where kind = 'mention' order by created_at");
    expect(told.map((r) => r.user_id)).toEqual([reader.principal.userId, third.principal.userId]);
    await t.json(`${base}/comments/${id}`, { method: 'PATCH', headers: author.headers, body: JSON.stringify({ text: `<@${third.principal.userId}> only` }) });
    expect(((await t.json('/api/v1/me/mentions', { headers: reader.headers })).body['mentions'] as unknown[]).length).toBe(0);
    expect((await t.ctx.db.query("select id from notifications where kind = 'mention'")).length).toBe(2);
  });

  test('sends the mention to Dispatch addressed to the person alone, with the workspace label', async () => {
    const dispatch = fakeFetch([{ match: 'dispatch.example.test/v1/events', status: 202, json: { event: {}, queued: 0, messages: 1, pages: 0, repeat: false } }]);
    const { t, author, reader, ws, doc } = await seeded({ fetch: dispatch.fetch, env: { DISPATCH_URL: 'https://dispatch.example.test/', DISPATCH_TOKEN: 'vantage-token' } });
    await t.json(`/api/v1/workspaces/${ws.slug}`, { method: 'PATCH', headers: author.headers, body: JSON.stringify({ settings: { notifications: { to: [{ group: 'architects' }] } } }) });
    const r = await postComment(t.ctx, { orgId: DEFAULT_ORG, userId: author.principal.userId, who: author.principal.userId, surface: 'api' }, { workspace: ws, document: doc }, { text: `<@${reader.principal.userId}> see this`, viewId: 'context' });
    expect(r.notified).toEqual([reader.principal.userId]);
    await r.delivery;
    expect(dispatch.calls.length).toBe(1);
    const call = dispatch.calls[0]!;
    expect(call.url).toBe('https://dispatch.example.test/v1/events');
    expect(call.headers['authorization']).toBe('Bearer vantage-token');
    const event = JSON.parse(call.body!) as { kind: string; key: string; severity: string; to: unknown[]; labels: Record<string, string>; links: { title: string; url: string }[] };
    expect(event).toMatchObject({ kind: 'vantage.mention', severity: 'info', to: [{ person: 'reader@example.com' }], labels: { workspace: ws.slug } });
    expect(event.links[0]!.title).toBe('Open in Vantage');
    const row = (await t.ctx.db.query<{ id: string; delivered: unknown }>("select id, delivered from notifications where kind = 'mention'"))[0]!;
    expect(event.key).toBe(row.id);
    expect(row.delivered).toEqual([{ channel: 'dispatch', ok: true, detail: '0 channels, 1 message' }]);
  });

  test("records Dispatch's refusal on the notification", async () => {
    const dispatch = fakeFetch([{ match: 'dispatch.example.test/v1/events', status: 400, json: { error: 'invalid: no group architects' } }]);
    const { t, author, reader, ws, doc } = await seeded({ fetch: dispatch.fetch, env: { DISPATCH_URL: 'https://dispatch.example.test', DISPATCH_TOKEN: 'vantage-token' } });
    const r = await postComment(t.ctx, { orgId: DEFAULT_ORG, userId: author.principal.userId, who: author.principal.userId, surface: 'api' }, { workspace: ws, document: doc }, { text: `<@${reader.principal.userId}> see this`, viewId: 'context' });
    await r.delivery;
    const row = (await t.ctx.db.query<{ delivered: unknown }>("select delivered from notifications where kind = 'mention'"))[0]!;
    expect(row.delivered).toEqual([{ channel: 'dispatch', ok: false, detail: '400 invalid: no group architects' }]);
  });

  test('a mention is recorded and nothing is sent without Dispatch', async () => {
    const quiet = await seeded();
    const q = await postComment(quiet.t.ctx, { orgId: DEFAULT_ORG, userId: quiet.author.principal.userId, who: quiet.author.principal.userId, surface: 'api' }, { workspace: quiet.ws, document: quiet.doc }, { text: `<@${quiet.reader.principal.userId}> see this`, viewId: 'context' });
    await q.delivery;
    expect(q.notified).toEqual([quiet.reader.principal.userId]);
  });

  test('refuses the old Teams and email settings and a malformed target', async () => {
    const { t, author, ws } = await seeded();
    const patch = (notifications: unknown) => t.json(`/api/v1/workspaces/${ws.slug}`, { method: 'PATCH', headers: author.headers, body: JSON.stringify({ settings: { notifications } }) });
    expect((await patch({ teamsWebhook: 'hook' })).status).toBe(400);
    expect((await patch({ email: { smtp: 'a', from: 'alerts@example.com', to: ['team@example.com'] } })).status).toBe(400);
    expect((await patch({ to: [{ person: 'not an address' }] })).status).toBe(400);
    expect((await patch({ to: [{ person: 'lead@example.com' }, { group: 'architects' }, { chain: 'platform-oncall' }] })).status).toBe(200);
  });
});

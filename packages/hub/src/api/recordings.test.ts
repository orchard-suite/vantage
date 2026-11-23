import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SAMPLE_YAML, testApp, type TestApp } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';
import { runGc } from '../worker/gc.ts';
import { JobLog } from '../worker/jobs.ts';
import { DEFAULT_ORG } from '../auth/authenticate.ts';
import { parseRange, recordingKey } from '../recordings.ts';

const YAML = `${SAMPLE_YAML}  - id: tour
    kind: walkthrough
    title: Tour
    view: context
    steps:
      - { title: Shoppers, highlight: [shoppers] }
      - { title: The API, highlight: [shop-api] }
`;

const AUDIO = new Uint8Array(Array.from({ length: 1000 }, (_, i) => i % 251));

type Caller = Awaited<ReturnType<TestApp['bearer']>>;

async function seeded(env: Record<string, string> = {}) {
  const t = await testApp({ env });
  const me = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string; id: string }[])[0]!;
  const created = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: YAML }) });
  await createWorker(t.ctx).drain();
  const doc = created.body['document'] as { id: string; slug: string };
  const version = (created.body['version'] as { id: string }).id;
  const upload = (by: Caller, meta: Record<string, unknown>, opts: { type?: string; audio?: Uint8Array<ArrayBuffer> } = {}) => {
    const form = new FormData();
    form.set('audio', new File([opts.audio ?? AUDIO], 'take', { type: 'application/octet-stream' }));
    form.set('meta', JSON.stringify({ view: 'tour', version, durationMs: 4000, type: opts.type ?? 'audio/webm;codecs=opus', timeline: [{ at: 0, path: 0, step: 0, boxes: ['shoppers'] }, { at: 2500, path: 0, step: 1, boxes: ['shop-api'] }], ...meta }));
    return t.app.request(`/api/v1/documents/${doc.id}/recordings`, { method: 'POST', headers: by.headers, body: form });
  };
  return { t, me, ws, doc, version, upload };
}

describe('parseRange', () => {
  test('reads one byte range and refuses ones past the end', () => {
    expect(parseRange(undefined, 100)).toBeUndefined();
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,5-6', 100)).toBeUndefined();
    expect(parseRange('items=0-1', 100)).toBeUndefined();
  });
});

describe('voice walkthroughs', () => {
  test('an author saves one; readers list it and stream it whole or by range', async () => {
    const { t, me, ws, doc, version, upload } = await seeded();
    const res = await upload(me, {});
    expect(res.status).toBe(201);
    const saved = (await res.json()) as { id: string; mimeType: string; olderVersion: boolean; timeline: { at: number }[]; authorLabel: string };
    expect(saved.mimeType).toBe('audio/webm');
    expect(saved.olderVersion).toBe(false);
    expect(saved.timeline.map((e) => e.at)).toEqual([0, 2500]);
    expect(saved.authorLabel).toBe('author');

    const listed = await t.json(`/api/v1/documents/${doc.id}/recordings?view=tour`, { headers: me.headers });
    expect((listed.body['recordings'] as { id: string }[]).map((r) => r.id)).toEqual([saved.id]);
    expect(listed.body['limits']).toEqual({ maxSeconds: 900, maxBytes: 50 * 1024 * 1024 });
    expect(((await t.json(`/api/v1/documents/${doc.id}/recordings?view=context`, { headers: me.headers })).body['recordings'] as unknown[]).length).toBe(0);

    const audio = `/api/v1/documents/${doc.id}/recordings/${saved.id}/audio`;
    const whole = await t.app.request(audio, { headers: me.headers });
    expect(whole.status).toBe(200);
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(AUDIO);
    const part = await t.app.request(audio, { headers: { ...me.headers, range: 'bytes=10-19' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 10-19/1000');
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(AUDIO.slice(10, 20));
    expect((await t.app.request(audio, { headers: { ...me.headers, range: 'bytes=5000-' } })).status).toBe(416);

    // After a save, the recording says it was made on an older version.
    const head = await t.json(`/api/v1/workspaces/${ws.slug}/documents/${doc.slug}`, { method: 'PUT', headers: me.headers, body: JSON.stringify({ yaml: YAML.replace('Who talks to whom?', 'Who talks to whom now?'), expectedVersion: version }) });
    expect(head.status).toBe(200);
    const after = (await t.json(`/api/v1/documents/${doc.id}/recordings`, { headers: me.headers })).body['recordings'] as { olderVersion: boolean; version: string }[];
    expect(after[0]).toMatchObject({ olderVersion: true, version });
    await t.ctx.db.close();
  });

  test('refuses viewers, other types, bad versions, and recordings past the limits', async () => {
    const { t, me, ws, upload } = await seeded({ RECORDING_MAX_SECONDS: '10', RECORDING_MAX_MB: '1' });
    const vic = await t.bearer('vic');
    await t.ctx.db.query("insert into grants (id, org_id, workspace_id, role, subject_kind, subject_id) values ('g1', $1, $2, 'viewer', 'user', $3)", [DEFAULT_ORG, ws.id, vic.principal.userId]);
    expect((await upload(vic, {})).status).toBe(403);
    expect((await upload(me, {}, { type: 'video/mp4' })).status).toBe(400);
    expect((await upload(me, {}, { type: 'audio/mp4' })).status).toBe(201);
    expect((await upload(me, { version: 'nope' })).status).toBe(400);
    expect((await upload(me, { durationMs: 11_000 })).status).toBe(400);
    expect((await upload(me, { timeline: [] })).status).toBe(400);
    expect((await upload(me, {}, { audio: new Uint8Array(1024 * 1024 + 1) })).status).toBe(413);
    expect((await upload(me, {}, { audio: new Uint8Array(2 * 1024 * 1024) })).status).toBe(413);
    const rows = await t.ctx.db.query<{ n: number }>('select count(*)::int as n from recordings');
    expect(rows[0]!.n).toBe(1);
    await t.ctx.db.close();
  });

  test('a guest link plays the recordings of what it may see', async () => {
    const { t, me, doc, upload } = await seeded();
    const tour = (await (await upload(me, {})).json()) as { id: string };
    const ctxRec = (await (await upload(me, { view: 'context', timeline: [{ at: 0, path: 0, step: -1, boxes: [] }] })).json()) as { id: string };
    const link = await t.json(`/api/v1/documents/${doc.id}/guest-links`, { method: 'POST', headers: me.headers, body: JSON.stringify({ view: 'tour' }) });
    const token = String(link.body['url']).split('/g/')[1]!;
    const listed = await t.json(`/api/bundle/recordings?file=g/${token}`);
    expect(listed.status).toBe(200);
    expect((listed.body['recordings'] as { id: string }[]).map((r) => r.id)).toEqual([tour.id]);
    const play = await t.app.request(`/api/bundle/recordings/audio?file=g/${token}&id=${tour.id}`, { headers: { range: 'bytes=0-3' } });
    expect(play.status).toBe(206);
    expect((await t.app.request(`/api/bundle/recordings/audio?file=g/${token}&id=${ctxRec.id}`)).status).toBe(404);
    expect((await t.app.request(`/api/bundle/recordings?file=g/not.atoken`)).status).toBe(404);
    const bundle = await t.json(`/api/bundle?file=g/${token}`);
    expect(bundle.body['recordings']).toBe(true);
    await t.ctx.db.close();
  });

  test('deleting a recording or its document takes the audio; gc drops audio no row names', async () => {
    const { t, me, ws, doc, upload } = await seeded();
    const a = (await (await upload(me, {})).json()) as { id: string };
    const b = (await (await upload(me, {})).json()) as { id: string };
    expect((await t.app.request(`/api/v1/documents/${doc.id}/recordings/${a.id}`, { method: 'DELETE', headers: me.headers })).status).toBe(204);
    expect(await t.ctx.blob.get(recordingKey(DEFAULT_ORG, a.id))).toBeUndefined();
    expect(await t.ctx.blob.get(recordingKey(DEFAULT_ORG, b.id))).toBeDefined();
    expect((await t.app.request(`/api/v1/documents/${doc.id}/recordings/${a.id}`, { method: 'DELETE', headers: me.headers })).status).toBe(404);

    expect((await t.app.request(`/api/v1/workspaces/${ws.slug}/documents/${doc.slug}`, { method: 'DELETE', headers: me.headers })).status).toBe(204);
    expect(await t.ctx.blob.get(recordingKey(DEFAULT_ORG, b.id))).toBeUndefined();
    expect((await t.ctx.db.query('select id from recordings')).length).toBe(0);

    await t.ctx.blob.put(recordingKey(DEFAULT_ORG, 'stray'), AUDIO, 'audio/webm');
    const gc = await runGc(t.ctx, DEFAULT_ORG, new JobLog());
    expect(gc.blobsRemoved).toBeGreaterThanOrEqual(1);
    expect(await t.ctx.blob.list(`recordings/${DEFAULT_ORG}/`)).toEqual([]);
    await t.ctx.db.close();
  });

  test('an agent lists them through vantage_recordings', async () => {
    const { t, me, ws, doc, upload } = await seeded();
    const saved = (await (await upload(me, {})).json()) as { id: string };
    const client = new Client({ name: 'test', version: '0' });
    const fetchViaApp = (input: string | URL, init?: RequestInit): Promise<Response> => Promise.resolve(t.app.request(String(input), init));
    await client.connect(new StreamableHTTPClientTransport(new URL('http://hub.test/mcp'), { fetch: fetchViaApp, requestInit: { headers: me.headers } }));
    const r = (await client.callTool({ name: 'vantage_recordings', arguments: { workspace: ws.slug, document: doc.slug } })) as { content: { text: string }[] };
    await client.close();
    expect(r.content[0]!.text).toContain(`${saved.id}  view=tour  0:04  2 steps`);
    expect(r.content[0]!.text).toContain('current version');
    await t.ctx.db.close();
  });

  test('the routes are in the OpenAPI document', async () => {
    const { t } = await seeded();
    const paths = (await t.json('/api/v1/openapi.json')).body['paths'] as Record<string, Record<string, unknown>>;
    expect(Object.keys(paths['/documents/{id}/recordings']!).sort()).toEqual(['get', 'post']);
    expect(paths['/documents/{id}/recordings/{recording}/audio']!['get']).toBeDefined();
    expect(paths['/documents/{id}/recordings/{recording}']!['delete']).toBeDefined();
    await t.ctx.db.close();
  });
});

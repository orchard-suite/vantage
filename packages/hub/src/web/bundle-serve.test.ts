import { describe, expect, test } from 'bun:test';
import { testApp, withReader } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';
import { renderState } from '../worker/artifacts.ts';
import { RENDERER } from '../render/renderer.ts';

const NESTED = `title: Nested
nodes:
  - id: users
    name: Users
  - id: platform
    name: Platform
    bind: fleet:platform
    children:
      - { id: api, name: API }
      - { id: db, name: DB }
relations:
  - { from: users, to: api, label: calls }
  - { from: api, to: db, label: reads }
views:
  - id: main
    title: Main
    include: { nodes: [users, platform] }
`;

async function setup() {
  const t = await testApp();
  const me = await t.bearer('reader', { admin: true });
  const ws = await t.json('/api/v1/workspaces', { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'Team' }) });
  const slug = String(ws.body['slug']);
  const src = await t.json(`/api/v1/workspaces/${slug}/connectors`, { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'Fleet', slug: 'fleet', connector: 'push', clientId: 'fleet-app' }) });
  const client = await t.connector('fleet-app');
  const push = async (version: string): Promise<void> => {
    const r = await t.json(`/api/v1/connector/${String(src.body['id'])}/batches`, { method: 'POST', headers: client, body: JSON.stringify({ entities: [{ id: 'platform', type: 'cluster', name: 'Platform', facts: { version } }] }) });
    expect(r.status).toBe(202);
  };
  await push('1.30');
  const doc = await t.json(`/api/v1/workspaces/${slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: NESTED }) });
  expect(doc.status).toBe(201);
  const worker = createWorker(t.ctx);
  await worker.drain();
  const hash = String((doc.body['version'] as { hash: string }).hash);
  return { t, me, slug, push, worker, hash, path: `/w/${slug}/nested/api` };
}

describe('serving the bundle', () => {
  test('the stored bundle goes out with this reader’s fields, the picture’s own theme, and a 304 for a current copy', async () => {
    const { t, me, path, hash } = await setup();
    const res = await t.app.request(`${path}/bundle?theme=dark`, { headers: me.headers });
    expect(res.status).toBe(200);
    const etag = res.headers.get('etag')!;
    const b = withReader(res, (await res.json()) as Record<string, unknown>) as unknown as { theme: string; render: string; version: string; hub: { canEdit: boolean }; views: { id: string; variantIds?: string[] }[]; kit?: { views: { id: string }[] } };
    expect(b.theme).toBe('light');
    expect(b.render).toBe((await renderState(t.ctx.db, hash))!.render_id);
    expect(b.hub.canEdit).toBe(true);
    // The viewer lays out opened and zoomed pictures from the kit; none are drawn ahead.
    expect(b.kit?.views.map((v) => v.id)).toEqual(['main']);
    expect(b.views[0]!.variantIds).toBeUndefined();
    const again = await t.app.request(`${path}/bundle?theme=dark`, { headers: { ...me.headers, 'if-none-match': etag } });
    expect(again.status).toBe(304);
  });

  test('a bundle cut to one view carries that view alone, in its views and its kit', async () => {
    const { t, me, path } = await setup();
    const res = await t.app.request(`${path}/bundle`, { headers: me.headers });
    const full = (await res.json()) as { kit: { views: { id: string }[] } };
    const two = { ...full, views: [{ id: 'main' }, { id: 'other' }], kit: { ...full.kit, views: [...full.kit.views, { ...full.kit.views[0]!, id: 'other' }] } };
    const cut = JSON.parse(await t.ctx.render.run('oneView', { bundle: JSON.stringify(two), view: 'main' })) as { views: { id: string }[]; kit: { views: { id: string }[] } };
    expect(cut.views.map((v) => v.id)).toEqual(['main']);
    expect(cut.kit.views.map((v) => v.id)).toEqual(['main']);
  });

  test('a head drawn by an older release is redrawn when read, and read again until a current worker drew it', async () => {
    const { t, me, path, worker, hash } = await setup();
    const queued = async (): Promise<number> => (await t.ctx.db.query("select id from jobs where kind = 'overlay' and state = 'queued' and payload->>'reason' = 'drawn by an older release'")).length;
    expect((await renderState(t.ctx.db, hash))!.renderer).toBe(RENDERER);
    await t.app.request(`${path}/bundle`, { headers: me.headers });
    expect(await queued()).toBe(0);
    await t.ctx.db.query("update render_states set renderer = '0.0.1' where version_hash = $1", [hash]);
    const res = await t.app.request(`${path}/bundle`, { headers: me.headers });
    expect(res.status).toBe(200);
    expect(await queued()).toBe(1);
    // A second reader before the redraw adds no second job.
    await t.app.request(`${path}/bundle`, { headers: me.headers });
    expect(await queued()).toBe(1);
    await worker.drain();
    expect((await renderState(t.ctx.db, hash))!.renderer).toBe(RENDERER);
    await t.app.request(`${path}/bundle`, { headers: me.headers });
    expect(await queued()).toBe(0);
  });

  test('an overlay with nothing new draws nothing; a changed fact draws again', async () => {
    const { t, push, worker, hash } = await setup();
    const first = (await renderState(t.ctx.db, hash))!;
    await push('1.30');
    await worker.drain();
    const overlay = await t.ctx.db.query<{ log: { message: string }[] }>("select log from jobs where kind = 'overlay' order by created_at desc limit 1");
    expect(overlay[0]!.log.some((l) => l.message.includes('nothing drawn'))).toBe(true);
    expect((await renderState(t.ctx.db, hash))!.render_id).toBe(first.render_id);
    await push('1.31');
    await worker.drain();
    const next = (await renderState(t.ctx.db, hash))!;
    expect(next.render_id).not.toBe(first.render_id);
    expect(next.digest).not.toBe(first.digest);
    const kinds = await t.ctx.db.query<{ render_id: string }>('select distinct render_id from artifacts where version_hash = $1', [hash]);
    expect(kinds.map((k) => k.render_id)).toEqual([next.render_id]);
    // The replaced render's files stay readable for a while; a job removes them later.
    const older = (await t.ctx.blob.list(`${hash}/${first.render_id}/`));
    expect(older.length).toBeGreaterThan(0);
    // The new render replaced the first one.
    const drop = await t.ctx.db.query<{ keys: string[]; later: boolean }>("select payload->'keys' as keys, run_at > now() + interval '60 seconds' as later from jobs where kind = 'drop-files' and state = 'queued'");
    expect(drop.every((d) => d.later)).toBe(true);
    const dropped = drop.flatMap((d) => d.keys);
    expect(older.every((k) => dropped.includes(k))).toBe(true);
    expect(dropped.some((k) => k.startsWith(`${hash}/${next.render_id}/`))).toBe(false);
  });

  test('while a save draws, a reader gets the last drawn picture marked drawing, then the new one', async () => {
    const { t, me, slug, worker, path } = await setup();
    const doc = await t.json(`/api/v1/workspaces/${slug}/documents/nested`, { headers: me.headers });
    const v1 = (doc.body['headVersion'] as { id: string }).id;
    const saved = await t.json(`/api/v1/workspaces/${slug}/documents/nested`, { method: 'PUT', headers: me.headers, body: JSON.stringify({ yaml: NESTED.replace('title: Main', 'title: Main, edited'), expectedVersion: v1 }) });
    expect(saved.status).toBe(200);
    const v2 = String((saved.body['version'] as { id: string }).id);
    const during = await t.app.request(`${path}/bundle`, { headers: me.headers });
    expect(during.status).toBe(200);
    const b = withReader(during, (await during.json()) as Record<string, unknown>) as unknown as Listed & { drawing?: boolean; pending?: boolean; hub: { version: string } };
    expect(b.pending).toBeUndefined();
    expect(b.drawing).toBe(true);
    expect(b.version).toBe(v1);
    expect(b.hub.version).toBe(v2);
    expect((await entry(t, me.headers, path, b, 0)).title).toBe('Main');
    // The viewer lays the view out itself from the drawing version's kit.
    const kit = await t.app.request(`${path}/bundle/kit?version=${v2}`, { headers: me.headers });
    expect(kit.status).toBe(200);
    expect(((await kit.json()) as { views: { title: string }[] }).views[0]!.title).toBe('Main, edited');
    await worker.drain();
    const after = await t.app.request(`${path}/bundle`, { headers: me.headers });
    const a = withReader(after, (await after.json()) as Record<string, unknown>) as unknown as Listed & { drawing?: boolean };
    expect(a.drawing).toBeUndefined();
    expect(a.version).toBe(v2);
    expect((await entry(t, me.headers, path, a, 0)).title).toBe('Main, edited');
  });

  test('a view entry is read by its digest, and the browser keeps it', async () => {
    const { t, me, path } = await setup();
    const res = await t.app.request(`${path}/bundle`, { headers: me.headers });
    const b = withReader(res, (await res.json()) as Record<string, unknown>) as unknown as Listed;
    expect(b.lazy).toBe(true);
    const v = b.views[0]!;
    const kept = await t.app.request(`${path}/bundle/view?view=${v.id}&d=${v.digest}`, { headers: me.headers });
    expect(kept.status).toBe(200);
    expect(kept.headers.get('cache-control')).toContain('immutable');
    const missing = await t.app.request(`${path}/bundle/view?view=${v.id}&d=nope`, { headers: me.headers });
    expect(missing.status).toBe(404);
  });
});

interface Listed {
  readonly lazy?: boolean;
  readonly version: string;
  readonly views: readonly { id: string; digest: string }[];
}

/** One listed view's entry, read the way the viewer reads it. */
async function entry(t: Awaited<ReturnType<typeof testApp>>, headers: Record<string, string>, path: string, b: Listed, i: number): Promise<{ title: string }> {
  const v = b.views[i]!;
  const res = await t.app.request(`${path}/bundle/view?view=${v.id}&d=${v.digest}`, { headers });
  expect(res.status).toBe(200);
  return (await res.json()) as { title: string };
}

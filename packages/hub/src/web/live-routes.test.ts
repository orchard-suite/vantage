import { describe, expect, test } from 'bun:test';
import { testApp, SAMPLE_YAML } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';
import { createHubApp } from './app.ts';
import { BEAT_LIMIT } from './live-routes.ts';

async function seeded() {
  const t = await testApp();
  const me = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
  await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML }) });
  await createWorker(t.ctx).drain();
  return { t, me, file: `${ws.slug}/sample`, base: `/api/v1/workspaces/${ws.slug}/documents/sample` };
}

/** Reads `presence` events off an event stream as they arrive. */
function presenceEvents(res: Response): { next: () => Promise<Record<string, unknown>> } {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const queue: Record<string, unknown>[] = [];
  let buf = '';
  return {
    async next() {
      while (!queue.length) {
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended');
        buf += dec.decode(value);
        const blocks = buf.split('\n\n');
        buf = blocks.pop()!;
        for (const b of blocks) {
          const lines = b.split('\n');
          if (!lines.includes('event: presence')) continue;
          queue.push(JSON.parse(lines.find((l) => l.startsWith('data: '))!.slice(6)) as Record<string, unknown>);
        }
      }
      return queue.shift()!;
    },
  };
}

const SEAT = { view: 'context', step: { path: 0, step: 1 }, groups: { open: ['shop-api'], shut: [] }, cam: { x: 10, y: 20, w: 800, h: 600 } };

describe('presence', () => {
  test('a beat posted to one pod reaches a viewer on another pod with the name the hub knows, not one the browser claims', async () => {
    const { t, me, file } = await seeded();
    await t.ctx.db.query("update users set display_name = 'Ana Author' where id = $1", [me.principal.userId]);
    const other = createHubApp(t.ctx);
    const viewer = await t.bearer('reader', { admin: true });
    const controller = new AbortController();
    const stream = await other.request(`/api/events?file=${file}`, { headers: viewer.headers, signal: controller.signal });
    const heard = presenceEvents(stream);
    await new Promise((r) => setTimeout(r, 20));

    const post = await t.app.request(`/api/presence?file=${file}`, { method: 'POST', headers: me.headers, body: JSON.stringify({ session: 'sess-author-1', event: 'join', name: 'Spoofed', ...SEAT }) });
    expect(post.status).toBe(204);
    const got = await heard.next();
    expect(got).toMatchObject({ session: 'sess-author-1', event: 'join', name: 'Ana Author', guest: false, ...SEAT });
    expect(got).not.toHaveProperty('user');
    expect(got).not.toHaveProperty('named');
    expect(got).not.toHaveProperty('mine');

    // A follow names the leader's session and rides the same channel.
    await other.request(`/w/${file}/api/presence`, { method: 'POST', headers: viewer.headers, body: JSON.stringify({ session: 'sess-reader-1', event: 'follow', following: 'sess-author-1', view: 'context' }) });
    expect(await heard.next()).toMatchObject({ session: 'sess-reader-1', event: 'follow', following: 'sess-author-1', mine: true, name: 'reader' });
    controller.abort();
    await t.ctx.db.close();
  });

  test('a guest on a link limited to one view sees display names only, and no seat on another view', async () => {
    const { t, me, file, base } = await seeded();
    const link = await t.json(`${base}/guest-links`, { method: 'POST', headers: me.headers, body: JSON.stringify({ expiresInHours: 24, view: 'context' }) });
    const token = new URL(link.body['url'] as string).pathname.slice(3);
    const controller = new AbortController();
    const heard = presenceEvents(await t.app.request(`/api/events?file=g/${token}`, { signal: controller.signal }));
    await new Promise((r) => setTimeout(r, 20));

    // The author has no display name: a guest sees "Member", never the subject.
    await t.ctx.db.query('update users set display_name = null where id = $1', [me.principal.userId]);
    await t.app.request(`/api/presence?file=${file}`, { method: 'POST', headers: me.headers, body: JSON.stringify({ session: 'sess-author-2', view: 'elsewhere', cam: SEAT.cam }) });
    const hidden = await heard.next();
    expect(hidden).toMatchObject({ session: 'sess-author-2', event: 'beat', name: 'Member' });
    expect(hidden).not.toHaveProperty('view');
    expect(hidden).not.toHaveProperty('cam');

    await t.app.request(`/api/presence?file=${file}`, { method: 'POST', headers: me.headers, body: JSON.stringify({ session: 'sess-author-2', ...SEAT, presenting: true }) });
    expect(await heard.next()).toMatchObject({ view: 'context', cam: SEAT.cam, presenting: true });

    // A guest posts as Guest and may follow.
    const guest = await t.app.request(`/api/presence?file=g/${token}`, { method: 'POST', body: JSON.stringify({ session: 'sess-guest-1', event: 'follow', following: 'sess-author-2' }) });
    expect(guest.status).toBe(204);
    expect(await heard.next()).toMatchObject({ session: 'sess-guest-1', name: 'Guest', guest: true, following: 'sess-author-2' });
    controller.abort();
    await t.ctx.db.close();
  });

  test('beats are checked: a reader without access, a bad body, an oversized seat, and a flood are refused', async () => {
    const { t, me, file } = await seeded();
    expect((await t.app.request(`/api/presence?file=${file}`, { method: 'POST', body: JSON.stringify({ session: 'sess-anon-1' }) })).status).toBe(401);
    expect((await t.app.request(`/api/presence?file=${file}`, { method: 'POST', headers: me.headers, body: JSON.stringify({ session: 'x' }) })).status).toBe(400);
    const many = Array.from({ length: 200 }, (_, i) => `group-${i}-${'x'.repeat(40)}`);
    expect((await t.app.request(`/api/presence?file=${file}`, { method: 'POST', headers: me.headers, body: JSON.stringify({ session: 'sess-big-1', groups: { open: many, shut: [] } }) })).status).toBe(413);
    let last = 0;
    for (let i = 0; i < BEAT_LIMIT.requests + 2 && last !== 429; i++) last = (await t.app.request(`/api/presence?file=${file}`, { method: 'POST', headers: me.headers, body: JSON.stringify({ session: 'sess-flood-1' }) })).status;
    expect(last).toBe(429);
    await t.ctx.db.close();
  });

  test('the bundle tells the viewer presence is on', async () => {
    const { t, me, file } = await seeded();
    expect((await t.json(`/api/bundle?file=${file}`, { headers: me.headers })).body['presence']).toBe(true);
    await t.ctx.db.close();
  });
});

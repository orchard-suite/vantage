import { describe, expect, test } from 'bun:test';
import { testApp, SAMPLE_YAML, withReader } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';
import { GUEST_LIMIT } from './pages.ts';

async function seeded() {
  const t = await testApp();
  const me = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
  const created = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML }) });
  await createWorker(t.ctx).drain();
  return { t, me, ws, versionId: (created.body['version'] as { id: string }).id };
}

describe('viewer, guest links, embed, live', () => {
  test('viewer page, bundle, and events keep the viewer contract per document', async () => {
    const { t, me, ws } = await seeded();
    const page = await t.app.request(`/w/${ws.slug}/sample`, { headers: me.headers });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(`"${ws.slug}/sample"`);
    expect(html).toContain('/viewer.js');
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(page.headers.get('content-security-policy')).toContain('nonce-');
    expect((await t.app.request('/viewer.js', { headers: me.headers })).status).toBe(200);

    const bundle = await t.json(`/api/bundle?file=${ws.slug}/sample`, { headers: me.headers });
    expect(bundle.status).toBe(200);
    expect(bundle.body['live']).toBe(true);
    expect((bundle.body['views'] as { id: string; svg: string }[])[0]!.id).toBe('context');
    const alias = await t.json(`/w/${ws.slug}/sample/api/bundle`, { headers: me.headers });
    expect(alias.body['version']).toBe(bundle.body['version']);
    expect((await t.json(`/api/bundle?file=${ws.slug}/missing`, { headers: me.headers })).status).toBe(404);
    expect((await t.json(`/api/bundle?file=${ws.slug}/sample`)).status).toBe(401);

    const zipped = await t.app.request(`/api/bundle?file=${ws.slug}/sample`, { headers: { ...me.headers, 'accept-encoding': 'gzip' } });
    expect(zipped.headers.get('content-encoding')).toBe('gzip');
    const unzipped = withReader(zipped, JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await zipped.arrayBuffer())))) as Record<string, unknown>);
    expect(unzipped['version']).toBe(bundle.body['version'] as string);

    const controller = new AbortController();
    const events = await t.app.request(`/api/events?file=${ws.slug}/sample`, { headers: { ...me.headers, 'accept-encoding': 'gzip' }, signal: controller.signal });
    expect(events.headers.get('content-type')).toBe('text/event-stream');
    expect(events.headers.get('content-encoding')).toBeNull();
    const reader = events.body!.getReader();
    const dec = new TextDecoder();
    expect(dec.decode((await reader.read()).value)).toBe(': connected\n\nretry: 1000\n\n');
    await t.json(`/api/v1/workspaces/${ws.slug}/documents/sample`, { method: 'PUT', headers: me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML.replace('Sample', 'Live') }) });
    await createWorker(t.ctx).drain();
    // The save is heard as it commits, then the render when it is stored.
    const heard: Record<string, unknown>[] = [];
    while (!heard.some((e) => 'hash' in e)) {
      const chunk = dec.decode((await reader.read()).value);
      for (const line of chunk.split('\n')) if (line.startsWith('data: ')) heard.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
    }
    expect(heard[0]).toMatchObject({ saved: true });
    expect(heard.at(-1)).toHaveProperty('hash');
    controller.abort();
    await t.ctx.db.close();
  });

  test('embed serves one read-only view with a frameable policy', async () => {
    const { t, me, ws } = await seeded();
    const res = await t.app.request(`/embed/${ws.slug}/sample/context`, { headers: me.headers });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('window.__VANTAGE__=');
    expect(html).not.toContain('"live":true');
    expect(res.headers.get('content-security-policy')).toContain('frame-ancestors *');
    expect((await t.app.request(`/embed/${ws.slug}/sample/nope`, { headers: me.headers })).status).toBe(404);
    await t.ctx.db.close();
  });

  test('guest links: signed url, passcode, every open audited, revoke, rate limit, disabled by workspace setting', async () => {
    const { t, me, ws } = await seeded();
    const base = `/api/v1/workspaces/${ws.slug}/documents/sample/guest-links`;
    const link = await t.json(base, { method: 'POST', headers: me.headers, body: JSON.stringify({ expiresInHours: 24, view: 'context' }) });
    expect(link.status).toBe(201);
    const url = new URL(link.body['url'] as string);
    const token = url.pathname.slice(3);
    expect((await t.app.request(url.pathname)).status).toBe(200);
    const bundle = await t.json(`/api/bundle?file=g/${token}`);
    expect(bundle.status).toBe(200);
    expect((bundle.body['views'] as unknown[]).length).toBe(1);
    const tampered = `${token.split('.')[0]}.AAAA`;
    expect((await t.app.request(`/g/${tampered}`)).status).toBe(404);

    const opens = await t.ctx.db.query<{ who: string }>("select who from audit where what = 'guest_link.open'");
    expect(opens.length).toBe(1);
    expect(opens[0]!.who.startsWith('guest:')).toBe(true);

    const locked = await t.json(base, { method: 'POST', headers: me.headers, body: JSON.stringify({ passcode: 'open-sesame' }) });
    const lockedToken = new URL(locked.body['url'] as string).pathname.slice(3);
    expect(await (await t.app.request(`/g/${lockedToken}`)).text()).toContain('passcode');
    expect((await t.json(`/api/bundle?file=g/${lockedToken}`)).status).toBe(403);
    const wrong = await t.app.request(`/g/${lockedToken}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'passcode=nope' });
    expect(wrong.status).toBe(403);
    const right = await t.app.request(`/g/${lockedToken}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'passcode=open-sesame' });
    expect(right.status).toBe(303);
    const cookie = right.headers.get('set-cookie')!.split(';')[0]!;
    expect((await t.json(`/api/bundle?file=g/${lockedToken}`, { headers: { cookie } })).status).toBe(200);
    expect((await t.json(`/api/bundle?file=g/${lockedToken}&passcode=open-sesame`)).status).toBe(200);

    const listed = await t.json(base, { headers: me.headers });
    expect((listed.body['guestLinks'] as { opens: number }[]).map((g) => g.opens).sort()).toEqual([1, 2]);
    expect((await t.json(`${base}/${link.body['id'] as string}`, { method: 'DELETE', headers: me.headers })).status).toBe(204);
    expect((await t.app.request(url.pathname)).status).toBe(404);

    await t.json(`/api/v1/workspaces/${ws.slug}`, { method: 'PATCH', headers: me.headers, body: JSON.stringify({ settings: { guestLinks: false } }) });
    expect((await t.json(base, { method: 'POST', headers: me.headers, body: JSON.stringify({}) })).status).toBe(403);

    let last = 200;
    for (let i = 0; i < GUEST_LIMIT.requests + 2 && last !== 429; i++) last = (await t.json(`/api/bundle?file=g/${lockedToken}`, { headers: { cookie, 'x-forwarded-for': '203.0.113.9' } })).status;
    expect(last).toBe(429);
    await t.ctx.db.close();
  });
});

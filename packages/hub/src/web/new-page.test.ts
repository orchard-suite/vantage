import { beforeAll, describe, expect, test } from 'bun:test';
import { testApp, type TestApp } from '../testing.ts';
import { starters } from './starters.ts';

describe('new diagram', () => {
  // One hub for the file: each in-memory database costs real memory.
  let t: TestApp;
  let me: Awaited<ReturnType<TestApp['bearer']>>;
  beforeAll(async () => {
    t = await testApp();
    me = await t.bearer('nina');
  });

  test('the page opens on the chosen example in the reader\'s own space', async () => {
    const res = await t.app.request('/new?from=shop', { headers: me.headers });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('title: Shop Architecture');
    expect(html).toContain('aria-current="page">Shop Architecture</a>');
    expect(html).toContain('<option value="nina" selected>');
  });

  test('preview draws unsaved yaml and reports problems without storing anything', async () => {
    const blank = starters()[0]!;
    const ok = await t.json('/api/v1/preview', { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: blank.yaml }) });
    expect(ok.status).toBe(200);
    expect(String(ok.body['svg'])).toStartWith('<svg');
    expect(ok.body['views']).toEqual([{ id: 'context', title: 'Context' }]);
    const bad = await t.json('/api/v1/preview', { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: 'nodes: [' }) });
    expect(bad.body['svg']).toBeNull();
    expect((bad.body['diagnostics'] as unknown[]).length).toBeGreaterThan(0);
    const docs = await t.json('/api/v1/workspaces/nina/documents', { headers: me.headers });
    expect(docs.body['documents']).toEqual([]);
  });

  test('examples draw for signed in readers only', async () => {
    expect((await t.app.request('/starters/shop.svg')).status).toBe(401);
    const res = await t.app.request('/starters/shop.svg', { headers: me.headers });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
  });

  test('home narrows to one workspace and keeps the filter on its switches', async () => {
    await t.json('/api/v1/workspaces/nina/documents', { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: starters()[0]!.yaml, name: 'Mine' }) });
    const html = await (await t.app.request('/?in=nina&sort=name', { headers: me.headers })).text();
    expect(html).toContain('Start something');
    expect(html).toContain('href="/new?in=nina"');
    expect(html).toContain('Mine');
    const none = await (await t.app.request('/?in=elsewhere', { headers: me.headers })).text();
    expect(none).toContain('Nothing matches these filters.');
  });
});

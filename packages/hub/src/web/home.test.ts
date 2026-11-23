import { describe, expect, test } from 'bun:test';
import { testApp, SAMPLE_YAML } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';
import { familyFor, initials } from './frame.ts';
import pkg from '../../../../package.json';

async function seeded() {
  const t = await testApp();
  const me = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
  await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML }) });
  return { t, me, ws };
}

describe('home page', () => {
  test('a card links to the viewer, counts the views, and shows the first view once the worker drew it', async () => {
    const { t, me, ws } = await seeded();
    const before = await (await t.app.request('/', { headers: me.headers })).text();
    expect(before).toContain('Rendering');
    expect(before).not.toContain('/thumb.svg');
    await createWorker(t.ctx).drain();

    const html = await (await t.app.request('/', { headers: me.headers })).text();
    expect(html).toContain(`href="/w/${ws.slug}/sample"`);
    expect(html).toContain(`src="/w/${ws.slug}/sample/thumb.svg"`);
    expect(html).toContain('Your space');
    expect(html).toMatch(/\d+ views?/);
    expect(html).toContain('Welcome back');
    expect(html).toContain('/mcp');
    expect(html).toContain(`Vantage ${pkg.version}`);

    const thumb = await t.app.request(`/w/${ws.slug}/sample/thumb.svg`, { headers: me.headers });
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('content-type')).toBe('image/svg+xml');
    expect(await thumb.text()).toContain('<svg');
    expect((await t.app.request(`/w/${ws.slug}/sample/thumb.svg`)).status).toBe(401);
  });

  test('shows only what others shared, switches to the list, and sends old workspace links to the workspace page', async () => {
    const { t, me, ws } = await seeded();
    await createWorker(t.ctx).drain();
    const shared = await (await t.app.request('/?show=shared', { headers: me.headers })).text();
    expect(shared).toContain('Shared with you');
    expect(shared).not.toContain(`href="/w/${ws.slug}/sample"`);
    const list = await (await t.app.request('/?layout=list&sort=name', { headers: me.headers })).text();
    expect(list).toContain('class="lrow"');
    expect(list).toContain('All diagrams');
    expect(list).toContain('aria-current="page" aria-label="List"');
    const old = await t.app.request(`/?ws=${ws.slug}`, { headers: me.headers });
    expect(old.status).toBe(302);
    expect(old.headers.get('location')).toBe(`/w/${ws.slug}`);
    expect(await (await t.app.request('/?ws=nope', { headers: me.headers })).text()).toContain('Welcome back');
  });

  test('a reader with nothing yet sees how to get the first diagram in', async () => {
    const t = await testApp();
    const me = await t.bearer('newcomer');
    const html = await (await t.app.request('/', { headers: me.headers })).text();
    expect(html).toContain('Nothing here yet.');
    expect(html).toContain('Copy the MCP address');
  });

  test('search keeps the frame and finds the document', async () => {
    const { t, me } = await seeded();
    await createWorker(t.ctx).drain();
    const html = await (await t.app.request('/?q=sample', { headers: me.headers })).text();
    expect(html).toContain('class="side"');
    expect(html).toMatch(/1 result for|No results for/);
    expect(html).toContain('Clear search');
  });

  test('a phone opens the sidebar from the top bar as a drawer', async () => {
    const { t, me } = await seeded();
    const html = await (await t.app.request('/', { headers: me.headers })).text();
    expect(html).toContain('id="side"');
    expect(html).toContain('data-nav="open" aria-controls="side" aria-expanded="false"');
    expect(html).toContain('aria-label="Close the menu"');
    expect(html).toContain('<span class="label">New diagram</span>');
  });

  test('names keep their initials and color', () => {
    expect(initials('Ada Example')).toBe('AE');
    expect(initials('local-developer')).toBe('LD');
    expect(initials('fay')).toBe('FA');
    expect(familyFor('platform')).toBe(familyFor('platform'));
    expect(familyFor('platform')).not.toBe('red');
  });
});

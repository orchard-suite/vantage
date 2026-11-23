import { describe, expect, test } from 'bun:test';
import { snippetHtml, updatedLabel } from './html.ts';
import { homeHtml, type HomeModel } from './home.ts';
import { kitHtml } from './kit.ts';
import { testApp } from '../testing.ts';

const EMPTY: HomeModel = { nonce: 'n', user: { id: 'u', name: 'A User', email: 'user@example.com', signOut: true }, workspaces: [], documents: [], place: { kind: 'home' }, sort: 'recent', layout: 'grid', agents: { mcpUrl: 'https://hub.example/mcp', ways: [] } };

describe('hub pages', () => {
  test('a search snippet keeps the hit marks and escapes everything else from the source', () => {
    const html = snippetHtml('name: Key <b>Vault</b> note: <img src=x onerror=alert(1)>');
    expect(html).toBe('name: Key <mark>Vault</mark> note: &lt;img src=x onerror=alert(1)&gt;');
  });

  test('the home page renders a hostile snippet as text', () => {
    const page = homeHtml({ ...EMPTY, query: 'vault', results: [{ workspaceSlug: 'w', documentSlug: 'd', name: 'D', headline: '<script>alert(1)</script> <b>vault</b>' }] });
    expect(page).not.toContain('<script>alert');
    expect(page).toContain('<mark>vault</mark>');
  });

  test('updated reads relative while recent and as a date after two weeks', () => {
    const now = Date.parse('2026-10-28T12:00:00Z');
    expect(updatedLabel(new Date(now - 30_000), now)).toBe('Updated just now');
    expect(updatedLabel(new Date(now - 3 * 3_600_000), now)).toBe('Updated 3h ago');
    expect(updatedLabel(new Date('2026-09-01T00:00:00Z'), now)).toBe('Updated 2026-09-01');
  });

  test('the home page loads the kit and shows the outlined lockup, not a retyped wordmark', () => {
    const page = homeHtml(EMPTY);
    expect(page).toContain('.btn.primary{');
    expect(page).toContain('/assets/brand/vantage-lockup-color-ink.svg');
    expect(page).toContain('alt="Vantage"');
  });

  test('the kit page shows every part and carries no dashes a person would read', () => {
    const html = kitHtml('n');
    for (const part of ['class="btn primary"', 'role="switch"', 'class="seg"', 'class="pill warn"', 'role="menu"', 'class="doc-card"', 'class="progress"', 'class="empty-state"']) expect(html).toContain(part);
    expect(html).toContain('<script nonce="n">');
    const text = html.replace(/<style>[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]+>/g, ' ');
    expect(text).not.toMatch(/[\u2013\u2014]|--/);
  });

  test('fonts and brand files are public and cached; /kit needs a signed in reader', async () => {
    const t = await testApp();
    const font = await t.app.request('/assets/fonts/JetBrainsMono-Variable.woff2');
    expect(font.status).toBe(200);
    expect(font.headers.get('content-type')).toBe('font/woff2');
    expect(font.headers.get('cache-control')).toContain('max-age');
    expect((await t.app.request('/assets/fonts/Inter-Regular.ttf')).status).toBe(404);
    expect((await t.app.request('/assets/brand/vantage-lockup-color-paper.svg')).headers.get('content-type')).toBe('image/svg+xml');
    expect((await t.app.request('/kit')).status).toBe(401);
    const me = await t.bearer('reader');
    const kit = await t.app.request('/kit', { headers: me.headers });
    expect(kit.status).toBe(200);
    expect(await kit.text()).toContain('The parts every screen is built from');
  });

  test('a page is asked for again on every visit, so a release reaches an open tab', async () => {
    const t = await testApp();
    const me = await t.bearer('reader');
    const kit = await t.app.request('/kit', { headers: me.headers });
    expect(kit.headers.get('cache-control')).toBe('no-cache');
    const font = await t.app.request('/assets/fonts/JetBrainsMono-Variable.woff2');
    expect(font.headers.get('cache-control')).not.toBe('no-cache');
  });
});


describe('the sidebar foot', () => {
  test('the reader is one menu: account and tokens, the look, and sign out sit inside it, and no sign-in ID shows', () => {
    const page = homeHtml(EMPTY);
    const menu = page.slice(page.indexOf('<details class="me-menu">'), page.indexOf('</details>', page.indexOf('<details class="me-menu">')));
    expect(menu).toContain('user@example.com');
    expect(menu).toContain('href="/account"');
    expect(menu).toContain('data-theme-pick="dark"');
    expect(menu).toContain('href="/auth/logout"');
    expect(menu).toContain('class="release"');
    expect(page.split('data-theme-pick="dark"').length).toBe(2);
  });

  test('with no ways set, the agent box offers the MCP address', () => {
    const page = homeHtml(EMPTY);
    expect(page).toContain('data-copy="https://hub.example/mcp"');
  });

  test('with ways set, the agent box offers each one and not the bare address', () => {
    const page = homeHtml({ ...EMPTY, agents: { mcpUrl: 'https://hub.example/mcp', ways: [
      { client: 'copilot', name: 'Microsoft Copilot', action: { kind: 'open', href: 'https://teams.microsoft.com/l/chat/0/0?users=28:abc', label: 'Open in Teams' } },
      { client: 'claude-code', name: 'Claude Code', action: { kind: 'run', command: 'claude plugin install vantage@example' } },
    ] } });
    const box = page.slice(page.indexOf('id="agent"'), page.indexOf('<details class="me-menu">'));
    expect(box).toContain('href="https://teams.microsoft.com/l/chat/0/0?users=28:abc" target="_blank" rel="noopener">Open in Teams');
    expect(box).toContain('data-copy="claude plugin install vantage@example"');
    expect(box).toContain('Run this once in a terminal:');
    expect(page).not.toContain('data-copy="https://hub.example/mcp"');
  });
});

describe('the account page', () => {
  test('lists the reader\'s live tokens, never their secret, and shows the sign-in ID in full', async () => {
    const t = await testApp();
    const me = await t.bearer('reader-subject-0123456789');
    const made = await t.json('/api/v1/tokens', { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'Claude Code on my laptop' }) });
    const gone = await t.json('/api/v1/tokens', { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'Old script' }) });
    await t.app.request(`/api/v1/tokens/${String(gone.body['id'])}`, { method: 'DELETE', headers: me.headers });
    const res = await t.app.request('/account', { headers: me.headers });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Claude Code on my laptop');
    expect(html).not.toContain('Old script');
    expect(html).not.toContain(String(made.body['token']));
    expect(html).toContain('data-copy="reader-subject-0123456789"');
    expect(html).toContain('aria-current="page">Account');
    expect((await t.app.request('/account')).status).toBe(401);
  });
});

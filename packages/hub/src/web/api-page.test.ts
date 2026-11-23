import { describe, expect, test } from 'bun:test';
import { testApp } from '../testing.ts';
import { apiGroups } from './api-page.ts';

describe('api page', () => {
  test('lists every route of the openapi document, grouped, with the raw document one copy away', async () => {
    const t = await testApp();
    const me = await t.bearer('reader');
    const res = await t.app.request('/api', { headers: me.headers });
    expect(res.status).toBe(200);
    const html = await res.text();
    const doc = await t.json('/api/v1/openapi.json');
    const paths = doc.body['paths'] as Record<string, Record<string, unknown>>;
    const count = Object.values(paths).reduce((n, ms) => n + Object.keys(ms).length, 0);
    expect(html.match(/class="api-op"/g)?.length).toBe(count);
    expect(html).toContain('data-copy="http://hub.test/api/v1/openapi.json"');
    expect(html).toContain('href="/api/v1/openapi.json"');
    expect(html).toContain('id="put-workspaces-workspace-documents-doc"');
    expect(html).toContain('<span class="api-var">{workspace}</span>');
    expect(html).toContain('id="api-admin"');
    expect(html).toContain('href="/api"');
    expect(html).not.toContain('href="/api/v1/openapi.json"><svg');
    await t.ctx.db.close();
  });

  test('asks for sign in', async () => {
    const t = await testApp();
    expect((await t.app.request('/api')).status).toBe(401);
    await t.ctx.db.close();
  });

  test('groups read in order, everyday work first, and an unknown tag still gets a group', () => {
    const groups = apiGroups([
      { method: 'get', path: '/admin/users', summary: 'Users', tag: 'admin', auth: 'admin' },
      { method: 'post', path: '/b', summary: 'B', tag: 'documents' },
      { method: 'get', path: '/b', summary: 'B', tag: 'documents' },
      { method: 'get', path: '/x', summary: 'X', tag: 'new-thing' },
      { method: 'get', path: '/me', summary: 'Me', tag: 'auth' },
    ]);
    expect(groups.map((g) => g.title)).toEqual(['You', 'Diagrams', 'Admin', 'New thing']);
    expect(groups[1]!.routes.map((r) => r.method)).toEqual(['get', 'post']);
  });
});

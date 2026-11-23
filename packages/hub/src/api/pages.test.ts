import { describe, expect, test } from 'bun:test';
import { testApp } from '../testing.ts';

const YAML = `title: Guide Book
nodes:
  - name: Shoppers
    type: users
  - name: Orders API
    type: api
relations:
  - { from: shoppers, to: orders-api, label: buys, tags: [context] }
views:
  - id: context
    title: Context
    include: { tags: [context] }
  - id: guide
    kind: doc
    title: Guide
    file: pages/guide.md
    beside: context
`;

describe('pages over the API', () => {
  test('a document is checked whole, a save refuses errors, and pages are read and written alone', async () => {
    const t = await testApp();
    const { headers } = await t.bearer('author');
    const ws = ((await t.json('/api/v1/workspaces', { headers })).body['workspaces'] as { slug: string }[])[0]!.slug;
    const post = (path: string, body: unknown, method = 'POST') => t.json(`/api/v1/workspaces/${ws}${path}`, { method, headers, body: JSON.stringify(body) });

    const bad = { yaml: YAML, pages: { 'pages/guide.md': 'The [[gone]] takes orders.' } };
    const checked = await post('/check', { ...bad, scores: true });
    expect(checked.status).toBe(200);
    expect((checked.body['errors'] as { message: string }[]).map((e) => e.message).join(' ')).toContain('box gone');
    const views = checked.body['views'] as { id: string; kind: string; score?: number }[];
    expect(views.find((v) => v.id === 'context')?.score).toBeGreaterThan(0);
    expect(views.find((v) => v.id === 'guide')?.score).toBeUndefined();

    const refused = await post('/documents', bad);
    expect(refused.status).toBe(422);
    expect((refused.body['details'] as { errors: unknown[] }).errors).not.toEqual([]);

    const created = await post('/documents', { yaml: YAML, pages: { 'pages/guide.md': '## Orders {#orders}\n\nThe [[orders-api]] takes orders.\n' } });
    expect(created.status).toBe(201);
    const v1 = (created.body['version'] as { id: string }).id;

    const listed = await t.json(`/api/v1/workspaces/${ws}/documents/guide-book/pages`, { headers });
    expect((listed.body['pages'] as { path: string }[]).map((p) => p.path)).toEqual(['pages/guide.md']);
    const read = await t.app.request(`/api/v1/workspaces/${ws}/documents/guide-book/pages?path=pages/guide.md`, { headers });
    expect(await read.text()).toContain('takes orders');
    expect(read.headers.get('x-vantage-version')).toBe(v1);

    const broken = await post('/documents/guide-book/pages', { pages: { 'pages/guide.md': 'See [nothing](view:nowhere).' }, expectedVersion: v1 }, 'PUT');
    expect(broken.status).toBe(422);
    const wrote = await post('/documents/guide-book/pages', { pages: { 'pages/guide.md': '## Orders {#orders}\n\nThe [[orders-api]] takes orders and refunds.\n' }, expectedVersion: v1 }, 'PUT');
    expect(wrote.status).toBe(200);
    expect(wrote.body['status']).toBe('saved');
    const again = await t.app.request(`/api/v1/workspaces/${ws}/documents/guide-book/pages?path=pages/guide.md`, { headers });
    expect(await again.text()).toContain('refunds');
    const guide = await t.app.request('/api/v1/guide', { headers });
    expect(await guide.text()).toContain('kind: doc');
    expect((await t.app.request('/api/v1/guide')).status).toBe(401);
    const notPage = await post('/documents/guide-book/pages', { pages: { 'pages/guide.txt': 'x' } }, 'PUT');
    expect(notPage.status).toBe(400);
  });

  test('a page sent back with the version comment a read put on it is stored without it', async () => {
    const t = await testApp();
    const { headers } = await t.bearer('author');
    const ws = ((await t.json('/api/v1/workspaces', { headers })).body['workspaces'] as { slug: string }[])[0]!.slug;
    const post = (path: string, body: unknown, method = 'POST') => t.json(`/api/v1/workspaces/${ws}${path}`, { method, headers, body: JSON.stringify(body) });
    const page = '## Orders\n\nThe [[orders-api]] takes orders.\n';
    const created = await post('/documents', { yaml: YAML, pages: { 'pages/guide.md': `<!-- version: 01ABC page: pages/guide.md -->\n${page}` } });
    expect(created.status).toBe(201);
    const read = async () => (await t.app.request(`/api/v1/workspaces/${ws}/documents/guide-book/pages?path=pages/guide.md`, { headers })).text();
    expect(await read()).toBe(page);
    const v1 = (created.body['version'] as { id: string }).id;
    const wrote = await post('/documents/guide-book/pages', { pages: { 'pages/guide.md': `<!-- version: ${v1} page: pages/guide.md -->\r\n${page}<!-- version: kept page: as written -->\n` }, expectedVersion: v1 }, 'PUT');
    expect(wrote.status).toBe(200);
    expect(await read()).toBe(`${page}<!-- version: kept page: as written -->\n`);
  });

  test('a page no doc view names is refused with its path, and nothing is saved', async () => {
    const t = await testApp();
    const { headers } = await t.bearer('author');
    const ws = ((await t.json('/api/v1/workspaces', { headers })).body['workspaces'] as { slug: string }[])[0]!.slug;
    const post = (path: string, body: unknown, method = 'POST') => t.json(`/api/v1/workspaces/${ws}${path}`, { method, headers, body: JSON.stringify(body) });
    const created = await post('/documents', { yaml: YAML, pages: { 'pages/guide.md': 'The [[orders-api]] takes orders.\n' } });
    const v1 = (created.body['version'] as { id: string }).id;

    const stray = await post('/documents/guide-book/pages', { pages: { 'pages/guide.md': 'The [[orders-api]] takes refunds.\n', 'pages/stray.md': '# Stray\n' }, expectedVersion: v1 }, 'PUT');
    expect(stray.status).toBe(400);
    expect(String(stray.body['error'] ?? stray.body['message'])).toContain('pages/stray.md');
    const full = await post('/documents', { yaml: YAML, pages: { 'pages/guide.md': 'x\n', 'pages/other.md': 'y\n' } });
    expect(full.status).toBe(400);
    expect(String(full.body['error'] ?? full.body['message'])).toContain('pages/other.md');

    const history = await t.json(`/api/v1/workspaces/${ws}/documents/guide-book/versions`, { headers });
    expect((history.body['versions'] as unknown[]).length).toBe(1);
  });

  test('a doc view whose file is not attached is refused by a save and by edits', async () => {
    const t = await testApp();
    const { headers } = await t.bearer('author');
    const ws = ((await t.json('/api/v1/workspaces', { headers })).body['workspaces'] as { slug: string }[])[0]!.slug;
    const post = (path: string, body: unknown, method = 'POST') => t.json(`/api/v1/workspaces/${ws}${path}`, { method, headers, body: JSON.stringify(body) });

    const refused = await post('/documents', { yaml: YAML });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toContain('pages/guide.md');

    const created = await post('/documents', { yaml: YAML, pages: { 'pages/guide.md': 'The [[orders-api]] takes orders.\n' } });
    expect(created.status).toBe(201);
    const edit = await post('/documents/guide-book/edits', { operations: [{ op: 'add', path: 'views', value: { id: 'runbook', kind: 'doc', title: 'Runbook', file: 'pages/runbook.md' } }] });
    expect(edit.status).toBe(400);
    expect(String(edit.body['error'] ?? edit.body['message'])).toContain('pages/runbook.md');
    const fine = await post('/documents/guide-book/edits', { operations: [{ op: 'set', path: 'views.guide.title', value: 'The Guide' }] });
    expect(fine.status).toBe(200);
  });
});


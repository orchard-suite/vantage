import { describe, expect, test } from 'bun:test';
import { testApp, withReader } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';

const YAML = `title: Runbook
nodes:
  - name: Web App
views:
  - id: guide
    kind: doc
    title: Guide
    file: pages/guide.md
`;

/** The smallest PNG: one transparent pixel, as base64. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const PAGE = '## Sign in\n\n![The sign-in screen](assets/screen.png)\n';

async function setup() {
  const t = await testApp();
  const { headers } = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers })).body['workspaces'] as { slug: string }[])[0]!.slug;
  const call = (path: string, body: unknown, method = 'POST') => t.json(`/api/v1/workspaces/${ws}${path}`, { method, headers, body: JSON.stringify(body) });
  const files = async (): Promise<string[]> => {
    const head = (await t.json(`/api/v1/workspaces/${ws}/documents/runbook`, { headers })).body['headVersion'] as { id: string };
    return ((await t.json(`/api/v1/workspaces/${ws}/documents/runbook/versions/${head.id}`, { headers })).body['attachments'] as { path: string }[]).map((a) => a.path);
  };
  return { t, headers, ws, call, files };
}

describe('pictures a page embeds', () => {
  test('a file only a page names survives every save, and goes when no page names it', { timeout: 20_000 }, async () => {
    const { call, files } = await setup();
    const created = await call('/documents', { yaml: YAML, pages: { 'pages/guide.md': PAGE }, assets: { 'assets/screen.png': PNG } });
    expect(created.status).toBe(201);
    expect(await files()).toEqual(['assets/screen.png', 'pages/guide.md']);

    // A page save that keeps naming the picture keeps it without sending it again.
    const kept = await call('/documents/runbook/pages', { pages: { 'pages/guide.md': `${PAGE}\nMore words.\n` } }, 'PUT');
    expect(kept.body['status']).toBe('saved');
    expect(await files()).toEqual(['assets/screen.png', 'pages/guide.md']);

    // A page save may bring a new picture with it.
    const added = await call('/documents/runbook/pages', { pages: { 'pages/guide.md': `${PAGE}\n![Then](assets/next.png)\n` }, assets: { 'assets/next.png': PNG } }, 'PUT');
    expect(added.body['status']).toBe('saved');
    expect(await files()).toEqual(['assets/next.png', 'assets/screen.png', 'pages/guide.md']);

    // The YAML saved alone keeps what the pages embed.
    const yamlOnly = await call('/documents/runbook', { yaml: YAML.replace('title: Guide', 'title: The guide') }, 'PUT');
    expect(yamlOnly.body['status']).toBe('saved');
    expect(await files()).toEqual(['assets/next.png', 'assets/screen.png', 'pages/guide.md']);

    await call('/documents/runbook/pages', { pages: { 'pages/guide.md': 'No pictures now.\n' } }, 'PUT');
    expect(await files()).toEqual(['pages/guide.md']);
  });

  test('a save refuses a page that names a missing file or a path outside the document', { timeout: 20_000 }, async () => {
    const { call } = await setup();
    const missing = await call('/check', { yaml: YAML, pages: { 'pages/guide.md': '![x](assets/gone.png)' } });
    expect((missing.body['errors'] as { message: string }[]).map((e) => e.message).join(' ')).toContain('file assets/gone.png');
    const refused = await call('/documents', { yaml: YAML, pages: { 'pages/guide.md': '![x](assets/gone.png)' } });
    expect(refused.status).toBe(422);
    const outside = await call('/check', { yaml: YAML, pages: { 'pages/guide.md': '![x](../other/secret.png)' } });
    expect((outside.body['errors'] as { message: string }[]).map((e) => e.message).join(' ')).toContain('outside its document: ../other/secret.png');
    const escaped = await call('/documents', { yaml: YAML, pages: { 'pages/guide.md': '![x](../other/secret.png)' }, assets: { '../other/secret.png': PNG } });
    expect(escaped.status).toBe(400);
  });

  test('the hub viewer draws the attached picture inside the page', { timeout: 20_000 }, async () => {
    const { t, headers, ws, call } = await setup();
    expect((await call('/documents', { yaml: YAML, pages: { 'pages/guide.md': PAGE }, assets: { 'assets/screen.png': PNG } })).status).toBe(201);
    await createWorker(t.ctx).drain();
    const res = await t.app.request(`/w/${ws}/runbook/api/bundle`, { headers });
    expect(res.status).toBe(200);
    const b = withReader(res, (await res.json()) as Record<string, unknown>) as unknown as { views: { id: string; digest: string }[] };
    const digest = b.views.find((v) => v.id === 'guide')!.digest;
    const entry = await t.app.request(`/w/${ws}/runbook/api/bundle/view?view=guide&d=${digest}`, { headers });
    expect(entry.status).toBe(200);
    const html = ((await entry.json()) as { doc?: { html: string } }).doc?.html ?? '';
    expect(html).toContain(`<img class="v-file" src="data:image/png;base64,${PNG}"`);
  });
});

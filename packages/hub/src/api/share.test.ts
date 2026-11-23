import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { testApp, SAMPLE_YAML } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';
import { DEFAULT_ORG } from '../auth/authenticate.ts';

const FIXTURES = join(import.meta.dir, '..', '..', '..', 'import', 'fixtures');

async function seeded() {
  const t = await testApp();
  const me = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string; id: string }[])[0]!;
  const created = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML }) });
  await createWorker(t.ctx).drain();
  return { t, me, ws, id: (created.body['document'] as { id: string }).id };
}

describe('export, share, and import', () => {
  test('exports one file, or a zip of several, in any publication format', async () => {
    const { t, me, id } = await seeded();
    const png = await t.app.request(`/api/v1/documents/${id}/export?format=png&views=context`, { headers: me.headers });
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect(png.headers.get('content-disposition')).toContain('sample.context.png');
    const partial = await t.app.request(`/api/v1/documents/${id}/export?format=png&views=context,nowhere`, { headers: me.headers });
    expect(partial.status).toBe(200);
    expect(partial.headers.get('x-vantage-warnings')).toBe('view nowhere is not in the document');
    const pdf = await t.app.request(`/api/v1/documents/${id}/export?format=pdf&titleBlock=true&theme=print`, { headers: me.headers });
    expect(pdf.status).toBe(200);
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
    const svgs = await t.app.request(`/api/v1/documents/${id}/export?format=svg`, { headers: me.headers });
    const views = (await t.ctx.db.query<{ n: number }>("select count(*)::int as n from artifacts where kind = 'svg'"))[0]!.n;
    if (views > 1) {
      expect(svgs.headers.get('content-type')).toBe('application/zip');
      expect(Object.keys(unzipSync(new Uint8Array(await svgs.arrayBuffer()))).every((n) => n.endsWith('.svg'))).toBe(true);
    } else {
      expect(svgs.headers.get('content-type')).toBe('image/svg+xml');
    }
    const html = await t.app.request(`/api/v1/documents/${id}/export?format=drawio`, { headers: me.headers });
    expect(html.headers.get('content-disposition')).toContain('sample.drawio');
    expect((await t.app.request(`/api/v1/documents/${id}/export?format=gif`, { headers: me.headers })).status).toBe(400);
    expect((await t.app.request(`/api/v1/documents/${id}/export?format=png`)).status).toBe(401);
  });

  test('share info, guest links by document id, and who may make them', async () => {
    const { t, me, ws, id } = await seeded();
    const info = await t.json(`/api/v1/documents/${id}/share`, { headers: me.headers });
    expect(info.body['canShare']).toBe(true);
    expect(String(info.body['embedBase'])).toContain(`/embed/${ws.slug}/sample`);
    const link = await t.json(`/api/v1/documents/${id}/guest-links`, { method: 'POST', headers: me.headers, body: JSON.stringify({ expiresInHours: 24, passcode: 'harbor', view: 'context' }) });
    expect(link.status).toBe(201);
    expect(String(link.body['url'])).toContain('/g/');
    const listed = await t.json(`/api/v1/documents/${id}/share`, { headers: me.headers });
    expect((listed.body['guestLinks'] as unknown[]).length).toBe(1);
    const del = await t.app.request(`/api/v1/documents/${id}/guest-links/${String(link.body['id'])}`, { method: 'DELETE', headers: me.headers });
    expect(del.status).toBe(204);
    expect(((await t.json(`/api/v1/documents/${id}/share`, { headers: me.headers })).body['guestLinks'] as unknown[]).length).toBe(0);

    const viewer = await t.bearer('viewer');
    const wsId = (await t.ctx.db.query<{ id: string }>('select id from workspaces where slug = $1', [ws.slug]))[0]!.id;
    await t.ctx.db.query("insert into grants (id, org_id, workspace_id, role, subject_kind, subject_id) values ('g1', $1, $2, 'viewer', 'user', $3)", [DEFAULT_ORG, wsId, viewer.principal.userId]);
    const seen = await t.json(`/api/v1/documents/${id}/share`, { headers: viewer.headers });
    expect(seen.body['canShare']).toBe(false);
    expect(seen.body['guestLinks']).toEqual([]);
    expect((await t.app.request(`/api/v1/documents/${id}/guest-links`, { method: 'POST', headers: { ...viewer.headers, 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
  });

  test('a drawing previews without saving, then imports as a document the viewer opens', async () => {
    const { t, me, ws } = await seeded();
    const bytes = readFileSync(join(FIXTURES, 'containers.drawio'));
    const preview = await t.json(`/api/v1/workspaces/${ws.slug}/drawings?filename=containers.drawio&preview=true`, { method: 'POST', headers: { ...me.headers, 'content-type': 'application/octet-stream' }, body: bytes });
    expect(preview.status).toBe(200);
    const report = preview.body['report'] as { format: string; counts: { nodes: number }; pages: unknown[] };
    expect(report.format).toBe('drawio');
    expect(report.counts.nodes).toBeGreaterThan(0);
    expect(report.pages.length).toBeGreaterThan(0);
    expect((await t.ctx.db.query('select id from documents')).length).toBe(1);

    const made = await t.json(`/api/v1/workspaces/${ws.slug}/drawings?filename=containers.drawio`, { method: 'POST', headers: { ...me.headers, 'content-type': 'application/octet-stream' }, body: bytes });
    expect(made.status).toBe(201);
    expect(String(made.body['url'])).toStartWith(`/w/${ws.slug}/`);
    expect((await t.ctx.db.query('select id from documents')).length).toBe(2);

    const junk = await t.json(`/api/v1/workspaces/${ws.slug}/drawings?filename=nope.drawio`, { method: 'POST', headers: { ...me.headers, 'content-type': 'application/octet-stream' }, body: 'not a drawing' });
    expect(junk.status).toBe(400);
    expect((await t.json(`/api/v1/workspaces/${ws.slug}/drawings`, { method: 'POST', headers: me.headers, body: 'x' })).status).toBe(400);

    const page = await t.app.request(`/import/${ws.slug}`, { headers: me.headers });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Import a drawing');
    expect(html).toContain(`data-api="/api/v1/workspaces/${ws.slug}/drawings"`);
  });
});

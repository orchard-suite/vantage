import { describe, expect, test } from 'bun:test';
import { unzipSync } from 'fflate';
import { renderPng } from '@vantage/render';
import { testApp, type TestApp } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';
import { runGc } from '../worker/gc.ts';
import { JobLog } from '../worker/jobs.ts';
import { assetKey, type Attachment } from './assets.ts';
import { iconKey } from '../workspace-icons.ts';

const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#c33"/></svg>';
const PNG = renderPng('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#3c3"/></svg>', { scale: 1 }).bytes;
const b64 = (data: string | Uint8Array): string => Buffer.from(data).toString('base64');

const yaml = (opts: { shot: boolean; icon?: string }): string => `title: Branded
icons:
  acme/logo: logo.svg
nodes:
  - { name: Acme, icon: ${opts.icon ?? 'acme/logo'} }
  - { name: Vault, type: secret }
${opts.shot ? '  - { name: Screen, type: image, image: shots/screen.png, imageWidth: 40, imageHeight: 30 }\n' : ''}relations:
  - { from: Acme, to: Vault, label: reads }
views:
  - { id: main, title: Main, include: { nodes: [Acme, Vault${opts.shot ? ', Screen' : ''}] } }
`;

interface Setup {
  readonly t: TestApp;
  readonly headers: Record<string, string>;
  readonly ws: string;
  readonly doc: string;
}

async function setup(env: Record<string, string> = {}): Promise<Setup> {
  const t = await testApp({ env });
  const me = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!.slug;
  const created = await t.json(`/api/v1/workspaces/${ws}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: yaml({ shot: true }), assets: { 'logo.svg': b64(LOGO), 'shots/screen.png': b64(PNG) } }) });
  expect(created.status).toBe(201);
  return { t, headers: me.headers, ws, doc: (created.body['document'] as { slug: string }).slug };
}

const head = async (s: Setup): Promise<{ id: string; hash: string; attachments: Attachment[] }> =>
  (await s.t.ctx.db.query<{ id: string; hash: string; attachments: Attachment[] }>('select v.id, v.hash, v.attachments from versions v join documents d on d.head_version_id = v.id where d.slug = $1', [s.doc]))[0]!;

const svgOf = async (s: Setup): Promise<string> => {
  await createWorker(s.t.ctx).drain();
  const res = await s.t.app.request(`/api/v1/workspaces/${s.ws}/documents/${s.doc}/artifacts/svg?view=main`, { headers: s.headers });
  expect(res.status).toBe(200);
  return res.text();
};

describe('document files', () => {
  test('a save stores the files the YAML names, and the render draws them', async () => {
    const s = await setup();
    const h = await head(s);
    expect(h.attachments.map((a) => `${a.path} ${a.contentType}`)).toEqual(['logo.svg image/svg+xml', 'shots/screen.png image/png']);
    for (const a of h.attachments) expect(await s.t.ctx.blob.get(assetKey('default', a.hash))).toBeDefined();
    const svg = await svgOf(s);
    expect(svg).toContain('<symbol id="i-acme-logo"');
    expect(svg).toMatch(/<image href="data:image\/png;base64,[^"]+" x=/);
  });

  test('files stay across saves that do not send them, and go when the YAML stops naming them', async () => {
    const s = await setup();
    const before = await head(s);
    const same = await s.t.json(`/api/v1/workspaces/${s.ws}/documents/${s.doc}`, { method: 'PUT', headers: s.headers, body: JSON.stringify({ yaml: yaml({ shot: true }) }) });
    expect(same.body['status']).toBe('unchanged');
    const dropped = await s.t.json(`/api/v1/workspaces/${s.ws}/documents/${s.doc}`, { method: 'PUT', headers: s.headers, body: JSON.stringify({ yaml: yaml({ shot: false }) }) });
    expect(dropped.body['status']).toBe('saved');
    const after = await head(s);
    expect(after.attachments.map((a) => a.path)).toEqual(['logo.svg']);
    expect(after.hash).not.toBe(before.hash);
  });

  test('a path outside the document or a file that is not a picture is refused', async () => {
    const s = await setup();
    for (const path of ['../escape.png', '/abs.png', 'notes.txt']) {
      const r = await s.t.json(`/api/v1/workspaces/${s.ws}/documents/${s.doc}`, { method: 'PUT', headers: s.headers, body: JSON.stringify({ yaml: yaml({ shot: true }), assets: { [path]: b64(PNG) } }) });
      expect(r.status).toBe(400);
    }
  });

  test('gc deletes the files only pruned versions held', async () => {
    const s = await setup({ RETENTION_VERSIONS: '1' });
    const shot = (await head(s)).attachments.find((a) => a.path === 'shots/screen.png')!;
    const logo = (await head(s)).attachments.find((a) => a.path === 'logo.svg')!;
    await s.t.json(`/api/v1/workspaces/${s.ws}/documents/${s.doc}`, { method: 'PUT', headers: s.headers, body: JSON.stringify({ yaml: yaml({ shot: false }) }) });
    const gc = await runGc(s.t.ctx, 'default', new JobLog());
    expect(gc.versionsRemoved).toBe(1);
    expect(await s.t.ctx.blob.get(assetKey('default', shot.hash))).toBeUndefined();
    expect(await s.t.ctx.blob.get(assetKey('default', logo.hash))).toBeDefined();
  });

  test('export writes the files beside the YAML and import brings them back', async () => {
    const s = await setup();
    const res = await s.t.app.request(`/api/v1/workspaces/${s.ws}/export`, { headers: s.headers });
    const zip = new Uint8Array(await res.arrayBuffer());
    const files = unzipSync(zip);
    expect(new TextDecoder().decode(files[`${s.doc}/logo.svg`])).toBe(LOGO);
    expect(files[`${s.doc}/shots/screen.png`]?.byteLength).toBe(PNG.byteLength);
    const team = await s.t.json('/api/v1/workspaces', { method: 'POST', headers: s.headers, body: JSON.stringify({ name: 'Copy' }) });
    const copy = (team.body['slug'] ?? (team.body['workspace'] as { slug: string } | undefined)?.slug) as string;
    const imported = await s.t.app.request(`/api/v1/workspaces/${copy}/import`, { method: 'POST', headers: { ...s.headers, 'content-type': 'application/zip' }, body: zip });
    expect(imported.status).toBe(200);
    const rows = await s.t.ctx.db.query<{ attachments: Attachment[] }>('select v.attachments from versions v join documents d on d.head_version_id = v.id join workspaces w on w.id = d.workspace_id where w.slug = $1', [copy]);
    expect(rows[0]!.attachments.map((a) => a.path)).toEqual(['logo.svg', 'shots/screen.png']);
  });
});

describe('workspace icons', () => {
  test('an uploaded icon draws in every document, re-renders them, and deletes cleanly', async () => {
    const s = await setup();
    await createWorker(s.t.ctx).drain();
    const put = await s.t.app.request(`/api/v1/workspaces/${s.ws}/icons/acme/mark`, { method: 'PUT', headers: { ...s.headers, 'content-type': 'image/svg+xml' }, body: LOGO });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { id: string }).id).toBe('acme/mark');
    // A render's second pass leaves its first pass's files to a delayed drop-files job.
    const queued = await s.t.ctx.db.query<{ kind: string }>("select kind from jobs where state = 'queued' and kind <> 'drop-files'");
    expect(queued.map((j) => j.kind)).toEqual(['overlay']);
    const saved = await s.t.json(`/api/v1/workspaces/${s.ws}/documents/${s.doc}`, { method: 'PUT', headers: s.headers, body: JSON.stringify({ yaml: yaml({ shot: true, icon: 'acme/mark' }) }) });
    expect(saved.body['status']).toBe('saved');
    expect(await svgOf(s)).toContain('<symbol id="i-acme-mark"');
    const list = await s.t.json(`/api/v1/workspaces/${s.ws}/icons`, { headers: s.headers });
    expect((list.body['icons'] as { id: string }[]).map((i) => i.id)).toEqual(['acme/mark']);
    const one = await s.t.app.request(`/api/v1/workspaces/${s.ws}/icons/acme/mark`, { headers: s.headers });
    expect(one.headers.get('content-security-policy')).toContain('sandbox');
    const hash = (await s.t.ctx.db.query<{ hash: string }>('select hash from workspace_icons'))[0]!.hash;
    const del = await s.t.app.request(`/api/v1/workspaces/${s.ws}/icons/acme/mark`, { method: 'DELETE', headers: s.headers });
    expect(del.status).toBe(204);
    expect(await s.t.ctx.blob.get(iconKey('default', hash))).toBeUndefined();
  });

  test('shipped pack names, bad ids, and non-pictures are refused', async () => {
    const s = await setup();
    const put = (path: string, type: string): Promise<Response> => Promise.resolve(s.t.app.request(`/api/v1/workspaces/${s.ws}/icons/${path}`, { method: 'PUT', headers: { ...s.headers, 'content-type': type }, body: LOGO }));
    expect((await put('azure/mine', 'image/svg+xml')).status).toBe(400);
    expect((await put('Acme/Mark', 'image/svg+xml')).status).toBe(400);
    expect((await put('acme/notes', 'text/plain')).status).toBe(400);
  });
});

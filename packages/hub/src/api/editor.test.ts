import { describe, expect, test } from 'bun:test';
import { testApp, type TestApp } from '../testing.ts';
import { DEFAULT_EDIT_MESSAGE } from './editor.ts';

const YAML = `title: Edited
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
`;

async function setup(): Promise<{ t: TestApp; headers: Record<string, string>; id: string; v1: string; ws: string }> {
  const t = await testApp();
  const me = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
  const created = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: YAML, message: 'first' }) });
  return { t, headers: me.headers, id: (created.body['document'] as { id: string }).id, v1: (created.body['version'] as { id: string }).id, ws: ws.slug };
}

describe('editing YAML in the viewer', () => {
  test('the head text, a draw of edited text with lines and a score, and a save with a message', async () => {
    const { t, headers, id, v1 } = await setup();
    const src = await t.json(`/api/v1/documents/${id}/source`, { headers });
    expect(src.body).toEqual({ version: v1, yaml: YAML });

    const edited = YAML.replace('    type: api\n', '    type: api\n    subtitle: Bun\n');
    const drawn = await t.json(`/api/v1/documents/${id}/preview`, { method: 'POST', headers, body: JSON.stringify({ yaml: edited }) });
    expect(drawn.status).toBe(200);
    expect(drawn.body['view']).toBe('context');
    expect((drawn.body['metrics'] as { score: number }).score).toBeGreaterThan(0);
    const entry = drawn.body['entry'] as { id: string; boxes: { id: string; subtitle?: string }[]; svg: string };
    expect(entry.id).toBe('context');
    expect(entry.boxes.find((b) => b.id === 'orders-api')?.subtitle).toBe('Bun');
    expect(entry.svg).toStartWith('<svg');

    const broken = await t.json(`/api/v1/documents/${id}/preview`, { method: 'POST', headers, body: JSON.stringify({ yaml: YAML.replace('    type: users\n', '    type: users\n   bad: [\n') }) });
    const errors = (broken.body['diagnostics'] as { severity: string; line?: number }[]).filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.line).toBeGreaterThan(0);

    const saved = await t.json(`/api/v1/documents/${id}/source`, { method: 'POST', headers, body: JSON.stringify({ yaml: edited, message: 'say the runtime', expectedVersion: v1 }) });
    expect(saved.status).toBe(200);
    expect(saved.body['status']).toBe('saved');
    const v2 = (saved.body['version'] as { id: string; message: string });
    expect(v2.message).toBe('say the runtime');
    const plain = await t.json(`/api/v1/documents/${id}/source`, { method: 'POST', headers, body: JSON.stringify({ yaml: `${edited}# more\n`, expectedVersion: v2.id }) });
    expect((plain.body['version'] as { message: string }).message).toBe(DEFAULT_EDIT_MESSAGE);
    await t.ctx.db.close();
  });

  test('a head that moved is merged on save, or answered with conflict markers; merge does the same without saving', async () => {
    const { t, headers, id, v1, ws } = await setup();
    const theirs = YAML.replace('title: Edited', 'title: Theirs');
    await t.json(`/api/v1/workspaces/${ws}/documents/edited`, { method: 'PUT', headers, body: JSON.stringify({ yaml: theirs, expectedVersion: v1 }) });

    const mine = YAML.replace('label: buys', 'label: buys online');
    const merged = await t.json(`/api/v1/documents/${id}/merge`, { method: 'POST', headers, body: JSON.stringify({ yaml: mine, base: v1 }) });
    expect(merged.body['status']).toBe('merged');
    expect(String(merged.body['yaml'])).toContain('title: Theirs');
    expect(String(merged.body['yaml'])).toContain('buys online');

    const saved = await t.json(`/api/v1/documents/${id}/source`, { method: 'POST', headers, body: JSON.stringify({ yaml: mine, message: 'mine', expectedVersion: v1 }) });
    expect(saved.body['merged']).toBe(true);
    expect(String(saved.body['yaml'])).toContain('title: Theirs');
    const head = (saved.body['version'] as { id: string }).id;

    const clash = await t.json(`/api/v1/documents/${id}/source`, { method: 'POST', headers, body: JSON.stringify({ yaml: YAML.replace('title: Edited', 'title: Mine'), message: 'clash', expectedVersion: v1 }) });
    expect(clash.status).toBe(409);
    expect(clash.body['conflicts']).toBe(1);
    expect(String(clash.body['preview'])).toContain('<<<<<<< yours\ntitle: Mine\n=======\ntitle: Theirs\n>>>>>>> saved');
    expect((clash.body['head'] as { id: string }).id).toBe(head);

    const current = await t.json(`/api/v1/documents/${id}/merge`, { method: 'POST', headers, body: JSON.stringify({ yaml: mine, base: head }) });
    expect(current.body['status']).toBe('current');
    await t.ctx.db.close();
  });

  test('readers and strangers never reach the editor', async () => {
    const { t, headers, id, v1, ws } = await setup();
    const viewer = await t.bearer('viewer');
    await t.json(`/api/v1/workspaces/${ws}/grants`, { method: 'POST', headers, body: JSON.stringify({ role: 'viewer', subjectKind: 'user', subjectId: viewer.principal.userId }) });
    expect((await t.json(`/api/v1/documents/${id}/source`, { headers: viewer.headers })).status).toBe(403);
    expect((await t.json(`/api/v1/documents/${id}/preview`, { method: 'POST', headers: viewer.headers, body: JSON.stringify({ yaml: YAML }) })).status).toBe(403);
    expect((await t.json(`/api/v1/documents/${id}/source`, { method: 'POST', headers: viewer.headers, body: JSON.stringify({ yaml: YAML, expectedVersion: v1 }) })).status).toBe(403);
    const stranger = await t.bearer('stranger');
    expect((await t.json(`/api/v1/documents/${id}/source`, { headers: stranger.headers })).status).toBe(404);
    await t.ctx.db.close();
  });
});

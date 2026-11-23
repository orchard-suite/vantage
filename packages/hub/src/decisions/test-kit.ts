/** What the citation and move tests share: a hub with a registry, a record maker, and a document that cites a record from a box and a page. */
import { expect } from 'bun:test';
import { testApp, SAMPLE_YAML, type TestApp } from '../testing.ts';
import { DEFAULT_ORG } from '../auth/authenticate.ts';
import type { Backlinks } from './backlinks.ts';
import type { Decision } from './types.ts';

export const RECORD = {
  title: 'Orders go through one API',
  category: 2,
  deciders: ['Avery Example'],
  decidedOn: '2026-11-01',
  updatedOn: '2026-11-01',
  context: 'Two apps wrote to the orders store.',
  decision: 'Only the Shop API writes orders.',
  consequences: '### Benefits\n\nOne writer.\n\n### Costs\n\nOne more hop.',
  alternatives: [{ option: 'Shared database', rejected: 'Two writers drift.' }],
};

/** SAMPLE_YAML with the Shop API citing `cite` and a doc view whose page cites it too. */
export function citingYaml(cite: string): string {
  return `${SAMPLE_YAML.replace('    description: Takes orders\n', `    description: Takes orders\n    decisions: [${cite}]\n`)}  - id: guide
    kind: doc
    title: Guide
    file: pages/guide.md
`;
}

export const citingPage = (cite: string): string => `## Orders\n\nThe [[shop-api]] follows [[decision:${cite}]].\n`;

export async function workspaceOf(t: TestApp, headers: Record<string, string>): Promise<{ slug: string; id: string }> {
  const slug = ((await t.json('/api/v1/workspaces', { headers })).body['workspaces'] as { slug: string }[])[0]!.slug;
  const id = (await t.ctx.db.query<{ id: string }>('select id from workspaces where slug = $1', [slug]))[0]!.id;
  return { slug, id };
}

export async function grant(t: TestApp, workspaceId: string, userId: string, role: 'viewer' | 'author'): Promise<void> {
  await t.ctx.db.query('insert into grants (id, org_id, workspace_id, role, subject_kind, subject_id) values ($1, $2, $3, $4, $5, $6)', [`g-${workspaceId}-${userId}`, DEFAULT_ORG, workspaceId, role, 'user', userId]);
}

export async function seeded() {
  const t = await testApp();
  const me = await t.bearer('author');
  const ws = await workspaceOf(t, me.headers);
  expect((await t.json(`/api/v1/workspaces/${ws.slug}/registries`, { method: 'POST', headers: me.headers, body: JSON.stringify({ prefix: 'SHOP', name: 'Shop decisions' }) })).status).toBe(201);
  const create = async (extra: Record<string, unknown> = {}, prefix = 'SHOP') => {
    const r = await t.json(`/api/v1/registries/${prefix}/decisions`, { method: 'POST', headers: me.headers, body: JSON.stringify({ ...RECORD, ...extra }) });
    expect(r.status).toBe(201);
    return r.body['decision'] as Decision;
  };
  const save = async (cite: string, opts: { workspace?: string; headers?: Record<string, string>; name?: string } = {}) =>
    t.json(`/api/v1/workspaces/${opts.workspace ?? ws.slug}/documents`, { method: 'POST', headers: opts.headers ?? me.headers, body: JSON.stringify({ name: opts.name ?? 'Shop', yaml: citingYaml(cite), pages: { 'pages/guide.md': citingPage(cite) } }) });
  const cited = async (ref: string, headers = me.headers) => (await t.json(`/api/v1/decisions/${ref}/citations`, { headers })).body as unknown as Backlinks;
  return { t, me, ws, create, save, cited };
}

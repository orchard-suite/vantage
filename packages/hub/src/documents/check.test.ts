import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { randomId } from '../crypto.ts';
import { createRevision, moveRevision } from '../revise/repo.ts';
import { testApp, SAMPLE_YAML, type TestApp } from '../testing.ts';

/** A box whose type is neither built in nor declared. */
const UNKNOWN_TYPE = SAMPLE_YAML.replace('type: users', 'type: phone');
/** Text a bad replacement left behind: it no longer parses. */
const MALFORMED = SAMPLE_YAML.replace('nodes:', 'nodes: [');
/** A doc view and its page, for the page saves. */
const WITH_PAGE = `${SAMPLE_YAML}  - id: guide
    kind: doc
    title: Guide
    file: pages/guide.md
    beside: context
`;

interface Finding {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly line?: number;
}

type Answer = { status: number; body: Record<string, unknown> };

async function setup(): Promise<{ t: TestApp; headers: Record<string, string>; userId: string; ws: string; call: (path: string, body: unknown, method?: string) => Promise<Answer>; versions: (doc: string) => Promise<number> }> {
  const t = await testApp();
  const { headers, principal } = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers })).body['workspaces'] as { slug: string }[])[0]!.slug;
  const call = (path: string, body: unknown, method = 'POST'): Promise<Answer> => t.json(path, { method, headers, body: JSON.stringify(body) });
  const versions = async (doc: string): Promise<number> => Number((await t.ctx.db.query<{ n: number }>('select count(*)::int as n from versions where document_id = $1', [doc]))[0]!.n);
  return { t, headers, userId: principal.userId, ws, call, versions };
}

/** Saves the clean sample and answers its id and first version. */
async function sample(s: Awaited<ReturnType<typeof setup>>, yaml = SAMPLE_YAML, pages?: Record<string, string>): Promise<{ id: string; slug: string; v1: string }> {
  const created = await s.call(`/api/v1/workspaces/${s.ws}/documents`, { yaml, ...(pages ? { pages } : {}) });
  expect(created.status).toBe(201);
  const doc = created.body['document'] as { id: string; slug: string };
  return { id: doc.id, slug: doc.slug, v1: (created.body['version'] as { id: string }).id };
}

/** The refusal names each error by code, path, and line. */
function refused(r: Answer, code: string): Finding[] {
  expect(r.status).toBe(422);
  expect(String(r.body['error'])).toContain('nothing was saved');
  const errors = ((r.body['details'] as { errors?: Finding[] } | undefined)?.errors ?? []) as Finding[];
  const hit = errors.find((e) => e.code === code);
  expect(hit).toBeDefined();
  return errors;
}

async function mcp(t: TestApp, headers: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'test', version: '0' });
  const fetchViaApp = (input: string | URL, init?: RequestInit): Promise<Response> => Promise.resolve(t.app.request(String(input), init));
  await client.connect(new StreamableHTTPClientTransport(new URL('http://hub.test/mcp'), { fetch: fetchViaApp, requestInit: { headers } }));
  return client;
}

type Text = { text: string }[];

describe('every write refuses a document with errors', () => {
  test('create refuses an unknown type, saves nothing, and names its code, path, and line', async () => {
    const s = await setup();
    const r = await s.call(`/api/v1/workspaces/${s.ws}/documents`, { yaml: UNKNOWN_TYPE });
    const errors = refused(r, 'unknown-type');
    expect(errors.find((e) => e.code === 'unknown-type')).toMatchObject({ path: 'nodes[0].type', line: 4, message: 'node shoppers has unknown type phone' });
    expect((await s.t.ctx.db.query('select id from documents')).length).toBe(0);
  });

  test('a full save refuses an unknown type and malformed YAML', async () => {
    const s = await setup();
    const doc = await sample(s);
    refused(await s.call(`/api/v1/workspaces/${s.ws}/documents/${doc.slug}`, { yaml: UNKNOWN_TYPE, expectedVersion: doc.v1 }, 'PUT'), 'unknown-type');
    const bad = refused(await s.call(`/api/v1/workspaces/${s.ws}/documents/${doc.slug}`, { yaml: MALFORMED, assets: { 'logo.svg': btoa('<svg/>') }, expectedVersion: doc.v1 }, 'PUT'), 'yaml-syntax');
    expect(bad.every((e) => typeof e.line === 'number')).toBe(true);
    expect(await s.versions(doc.id)).toBe(1);
  });

  test('a save with warnings only still saves', async () => {
    const s = await setup();
    const doc = await sample(s);
    const warned = SAMPLE_YAML.replace('views:', 'views:\n  - id: empty\n    title: Empty\n    include: { tags: [nothing] }');
    const checked = await s.call(`/api/v1/workspaces/${s.ws}/check`, { yaml: warned });
    expect(checked.body['errors']).toEqual([]);
    expect((checked.body['warnings'] as Finding[]).length).toBeGreaterThan(0);
    const r = await s.call(`/api/v1/workspaces/${s.ws}/documents/${doc.slug}`, { yaml: warned, expectedVersion: doc.v1 }, 'PUT');
    expect(r.status).toBe(200);
    expect(r.body['status']).toBe('saved');
  });

  test('the editor source save refuses errors', async () => {
    const s = await setup();
    const doc = await sample(s);
    refused(await s.call(`/api/v1/documents/${doc.id}/source`, { yaml: UNKNOWN_TYPE, expectedVersion: doc.v1 }), 'unknown-type');
    expect(await s.versions(doc.id)).toBe(1);
  });

  test('edits that set an unknown type on a clean document are refused', async () => {
    const s = await setup();
    const doc = await sample(s);
    const r = await s.call(`/api/v1/workspaces/${s.ws}/documents/${doc.slug}/edits`, { operations: [{ op: 'set', path: 'nodes.shoppers.type', value: 'phone' }] });
    expect(refused(r, 'unknown-type').find((e) => e.code === 'unknown-type')?.path).toBe('nodes[0].type');
    expect(await s.versions(doc.id)).toBe(1);
  });

  test('a steer that leaves a view naming no box is refused', async () => {
    const s = await setup();
    const doc = await sample(s);
    refused(await s.call(`/api/v1/documents/${doc.id}/steer`, { action: { kind: 'hide', view: 'context', node: 'ghost' }, expectedVersion: doc.v1 }), 'unknown-node');
    expect(await s.versions(doc.id)).toBe(1);
  });

  test('a page save refuses a page that links a box that does not exist', async () => {
    const s = await setup();
    const doc = await sample(s, WITH_PAGE, { 'pages/guide.md': 'The [[shop-api]] takes orders.\n' });
    const r = await s.call(`/api/v1/workspaces/${s.ws}/documents/${doc.slug}/pages`, { pages: { 'pages/guide.md': 'The [[gone]] takes orders.\n' }, expectedVersion: doc.v1 }, 'PUT');
    expect(r.status).toBe(422);
    expect(((r.body['details'] as { errors: Finding[] }).errors).map((e) => e.message).join(' ')).toContain('gone');
    expect(await s.versions(doc.id)).toBe(1);
  });

  test('a page may link the view a live block adds before its source fills it, and only that view', async () => {
    const s = await setup();
    const live = WITH_PAGE.replace('nodes:\n', 'nodes:\n  - id: lab\n    name: The lab\n    observe: { source: orrery, types: [host], view: { title: Where it runs } }\n');
    const created = await s.call(`/api/v1/workspaces/${s.ws}/documents`, { yaml: live, pages: { 'pages/guide.md': 'See [where it runs](view:lab-placement).\n' } });
    expect(created.status).toBe(201);
    const doc = created.body['document'] as { slug: string; id: string };
    const v1 = (created.body['version'] as { id: string }).id;
    const r = await s.call(`/api/v1/workspaces/${s.ws}/documents/${doc.slug}/pages`, { pages: { 'pages/guide.md': 'See [the gaps](view:lab-boundaries).\n' }, expectedVersion: v1 }, 'PUT');
    expect(r.status).toBe(422);
    expect(((r.body['details'] as { errors: Finding[] }).errors).map((e) => e.message).join(' ')).toContain('view lab-boundaries');
    expect(await s.versions(doc.id)).toBe(1);
  });

  test('restoring a version with errors is refused', async () => {
    const s = await setup();
    const doc = await sample(s);
    // A version saved before the hub refused errors.
    const old = randomId();
    await s.t.ctx.db.query("insert into versions (id, org_id, document_id, hash, yaml, author_user_id, surface, parent_id) values ($1, 'default', $2, $3, $4, null, 'api', $5)", [old, doc.id, `old-${old}`, UNKNOWN_TYPE, doc.v1]);
    refused(await s.call(`/api/v1/documents/${doc.id}/restore`, { version: old, expectedVersion: doc.v1 }), 'unknown-type');
    expect(await s.versions(doc.id)).toBe(2);
  });

  test('accepting a revision with errors is refused', async () => {
    const s = await setup();
    const doc = await sample(s);
    const rev = await createRevision(s.t.ctx.db, { orgId: 'default', documentId: doc.id, baseVersionId: doc.v1, requestedBy: s.userId, commentIds: [], model: 'test' });
    expect(await moveRevision(s.t.ctx.db, rev.id, ['queued'], 'ready', { yaml: UNKNOWN_TYPE, summary: 'adds a phone' })).toBe(true);
    refused(await s.call(`/api/v1/documents/${doc.id}/revisions/${rev.id}/accept`, {}), 'unknown-type');
    expect(await s.versions(doc.id)).toBe(1);
  });

  test('an mcp write and an mcp patch refuse errors, and name the guide topic that explains each', async () => {
    const s = await setup();
    const doc = await sample(s, WITH_PAGE, { 'pages/guide.md': 'The [[shop-api]] takes orders.\n' });
    const client = await mcp(s.t, s.headers);
    const tool = async (name: string, args: Record<string, unknown>): Promise<string> => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError).toBe(true);
      return (r.content as Text).map((c) => c.text).join('\n');
    };
    const at = `${s.ws}/${doc.slug}`;
    const refusedWrite = await tool('vantage_write', { writes: [{ address: at, text: UNKNOWN_TYPE }] });
    expect(refusedWrite).toContain('unknown-type at nodes[0].type, line 4: node shoppers has unknown type phone');
    expect(refusedWrite).toContain('(guide#nodes)');
    expect(await tool('vantage_write', { writes: [{ address: `${at}/pages/guide.md`, text: 'The [[gone]] takes orders.\n' }] })).toContain('nothing was saved');
    expect(await tool('vantage_patch', { edits: [{ address: at, op: 'set', path: 'nodes.shoppers.type', value: 'phone' }] })).toContain('unknown-type');
    expect(await tool('vantage_patch', { edits: [{ address: `${at}/pages/guide.md`, old: '[[shop-api]]', new: '[[gone]]' }] })).toContain('(guide#doc-a-page-of-prose)');
    const created = await client.callTool({ name: 'vantage_write', arguments: { writes: [{ address: s.ws, text: UNKNOWN_TYPE.replace('title: Sample', 'title: Phones') }] } });
    expect(created.isError).toBe(true);
    expect(await s.versions(doc.id)).toBe(1);
    expect((await s.t.ctx.db.query('select id from documents')).length).toBe(1);
  });
});

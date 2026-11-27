import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOL_DOOR } from '@vantage/mcp';
import { agent } from '../mcp/testing.ts';
import { testApp, SAMPLE_YAML } from '../testing.ts';
import { DecisionPatchSchema, type Decision } from './types.ts';

const RECORD = {
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

async function seeded() {
  const t = await testApp();
  const me = await t.bearer('author');
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
  const doc = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML }) });
  const documentId = (doc.body['document'] as { id: string; slug: string }).id;
  const slug = (doc.body['document'] as { id: string; slug: string }).slug;
  const reg = await t.json(`/api/v1/workspaces/${ws.slug}/registries`, { method: 'POST', headers: me.headers, body: JSON.stringify({ prefix: 'SHOP', name: 'Shop decisions' }) });
  expect(reg.status).toBe(201);
  const create = async (extra: Record<string, unknown> = {}) => t.json('/api/v1/registries/SHOP/decisions', { method: 'POST', headers: me.headers, body: JSON.stringify({ ...RECORD, ...extra }) });
  return { t, me, ws, documentId, slug, create };
}

const dec = (body: Record<string, unknown>): Decision => body['decision'] as Decision;

describe('decision records', () => {
  test('a registry prefix is unique in the organization, and ADR is never one', async () => {
    const { t, me, ws } = await seeded();
    expect((await t.json(`/api/v1/workspaces/${ws.slug}/registries`, { method: 'POST', headers: me.headers, body: JSON.stringify({ prefix: 'SHOP', name: 'Again' }) })).status).toBe(409);
    expect((await t.json(`/api/v1/workspaces/${ws.slug}/registries`, { method: 'POST', headers: me.headers, body: JSON.stringify({ prefix: 'ADR', name: 'No' }) })).status).toBe(400);
    const list = (await t.json('/api/v1/registries', { headers: me.headers })).body['registries'] as { prefix: string; categories: unknown[] }[];
    expect(list.map((r) => r.prefix)).toEqual(['SHOP']);
    expect(list[0]!.categories).toHaveLength(7);
  });

  test('records take the next number in their category, and a number is never handed out twice', async () => {
    const { t, me, create } = await seeded();
    const a = dec((await create()).body);
    expect(a.ref).toBe('SHOP-2001');
    expect(a.machineRef).toMatch(/^adr:[0-9A-Z]{26}$/);
    expect(dec((await create({ category: 1 })).body).ref).toBe('SHOP-1001');
    expect(dec((await create()).body).ref).toBe('SHOP-2002');
    expect((await t.json('/api/v1/registries/SHOP/next?category=2', { headers: me.headers })).body['ref']).toBe('SHOP-2003');
    expect((await create({ category: 8 })).status).toBe(400);
    expect((await create({ deciders: [] })).status).toBe(400);
  });

  test('a refinement edits in place and moves Last updated; a minor fix does not; history keeps each', async () => {
    const { t, me, create } = await seeded();
    await create();
    const patch = (body: Record<string, unknown>) => t.json('/api/v1/decisions/SHOP-2001', { method: 'PATCH', headers: me.headers, body: JSON.stringify(body) });
    expect(dec((await patch({ decision: 'Only the Shop API writes orders, and it owns the schema.', updatedOn: '2026-11-10' })).body).updatedOn).toBe('2026-11-10');
    const fixed = dec((await patch({ title: 'Orders go through one API only', minor: true })).body);
    expect(fixed.updatedOn).toBe('2026-11-10');
    expect(dec((await patch({ updatedOn: '2026-11-08', minor: true })).body).updatedOn).toBe('2026-11-08');
    expect((await patch({ status: 'superseded' })).status).toBe(400);
    const history = (await t.json('/api/v1/decisions/SHOP-2001/history', { headers: me.headers })).body['revisions'] as { message: string }[];
    expect(history.map((h) => h.message)).toEqual(['fixed wording', 'fixed wording', 'refined', 'created']);
  });

  test('the OpenAPI document lists the refine fields flat, as the hub reads them', async () => {
    const { t } = await seeded();
    const paths = (await t.json('/api/v1/openapi.json')).body['paths'] as Record<string, Record<string, { requestBody: { content: { 'application/json': { schema: { properties: Record<string, unknown> } } } } }>>;
    const props = Object.keys(paths['/decisions/{ref}']!['patch']!.requestBody.content['application/json'].schema.properties).sort();
    expect(props).toEqual(Object.keys(DecisionPatchSchema.shape).sort());
  });

  test('a pivot supersedes: the new record links back and governs the same boxes, the old one keeps its body', async () => {
    const { t, me, slug, create } = await seeded();
    await create({ governs: [{ document: slug, box: 'shop-api' }] });
    const r = await t.json('/api/v1/decisions/SHOP-2001/supersede', { method: 'POST', headers: me.headers, body: JSON.stringify({ ...RECORD, category: undefined, title: 'Orders go through a queue' }) });
    expect(r.status).toBe(201);
    const { old, new: next } = r.body as { old: Decision; new: Decision };
    expect(next.ref).toBe('SHOP-2002');
    expect(next.supersedes?.ref).toBe('SHOP-2001');
    expect(next.governs.map((g) => g.box)).toEqual(['shop-api']);
    expect(old.status).toBe('superseded');
    expect(old.supersededBy?.ref).toBe('SHOP-2002');
    expect(old.decision).toBe(RECORD.decision);
    expect((await t.json('/api/v1/decisions/SHOP-2001/supersede', { method: 'POST', headers: me.headers, body: JSON.stringify(RECORD) })).status).toBe(400);
  });

  test('a record governs boxes; the document lists it per box, and resolves what its YAML cites', async () => {
    const { t, me, ws, slug, documentId, create } = await seeded();
    expect((await create({ governs: [{ document: slug, box: 'no-such-box' }] })).status).toBe(400);
    const d = dec((await create({ governs: [{ document: `${ws.slug}/${slug}`, box: 'shop-api' }, { document: slug, view: 'context' }] })).body);
    expect(d.governs.map((g) => g.box ?? g.view)).toEqual(['shop-api', 'context']);
    const r = await t.json(`/api/v1/documents/${documentId}/decisions?cite=SHOP-2001,SHOP-2999`, { headers: me.headers });
    const list = r.body['decisions'] as { ref: string; boxes: string[]; views: string[]; url: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ ref: 'SHOP-2001', boxes: ['shop-api'], views: ['context'], url: `/w/${ws.slug}/decisions/SHOP-2001` });
    expect(r.body['cited']).toEqual({ 'SHOP-2001': d.id });
  });

  test('a save refuses a citation that names no record', async () => {
    const { t, me, ws, create } = await seeded();
    await create();
    const save = (cite: string) => t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ name: `cites ${cite}`, yaml: `nodes:\n  - { name: Orders API, decisions: [${cite}] }\n` }) });
    expect((await save('SHOP-2001')).status).toBe(201);
    const bad = await save('SHOP-2999');
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).toContain('decision SHOP-2999 is not a record');
  });

  test('someone with no access to the workspace cannot see the registry or its records', async () => {
    const { t, create } = await seeded();
    await create();
    const other = await t.bearer('stranger');
    expect((await t.json('/api/v1/decisions/SHOP-2001', { headers: other.headers })).status).toBe(404);
    expect(((await t.json('/api/v1/registries', { headers: other.headers })).body['registries'] as unknown[]).length).toBe(0);
  });

  test('search finds a record by its words and its citation, beside documents', async () => {
    const { t, me, create } = await seeded();
    await create();
    const hits = (q: string) => t.json(`/api/v1/search?q=${encodeURIComponent(q)}`, { headers: me.headers }).then((r) => (r.body['decisions'] as { ref: string }[]).map((d) => d.ref));
    expect(await hits('drift')).toEqual(['SHOP-2001']);
    expect(await hits('SHOP-2001')).toEqual(['SHOP-2001']);
  });

  test('the registry tab and a record page render, and a body citation links its record', async () => {
    const { t, me, ws, create } = await seeded();
    await create();
    await create({ title: 'Read replicas stay private', context: 'Follows [[decision:ADR-2001]] and SHOP-2001.' });
    const tab = await (await t.app.request(`/w/${ws.slug}?tab=decisions&status=accepted`, { headers: me.headers })).text();
    expect(tab).toContain('SHOP-2001');
    expect(tab).toContain('Read replicas stay private');
    const page = await (await t.app.request(`/w/${ws.slug}/decisions/SHOP-2002`, { headers: me.headers })).text();
    expect(page).toContain('Read replicas stay private');
    expect(page).toContain(`href="/w/${ws.slug}/decisions/SHOP-2001"`);
    const moved = await t.app.request(`/w/elsewhere/decisions/SHOP-2002`, { headers: me.headers });
    expect(moved.status).toBe(302);
  });
});

describe('decision tools', () => {
  test('records are written, read, and changed as text, and the record tools import, keeping numbers and supersede links', async () => {
    const { t, me } = await seeded();
    const a = await agent(t, me.headers);
    const door = (tool: string, args: Record<string, unknown>): Promise<string> => a.call(TOOL_DOOR, { tool, arguments: args });
    expect(await a.call(TOOL_DOOR, { group: 'records' })).toContain('vantage_decision_supersede');

    const text = `---\ntitle: ${RECORD.title}\nstatus: accepted\ncategory: 2\ndecided: ${RECORD.decidedOn}\nupdated: ${RECORD.updatedOn}\ndeciders: [Avery Example]\n---\n\n## Context\n\n${RECORD.context}\n\n## Decision\n\n${RECORD.decision}\n\n## Consequences\n\n${RECORD.consequences}\n\n## Alternatives considered\n\n### Shared database\n\nTwo writers drift.\n`;
    expect(await a.call('vantage_write', { writes: [{ address: 'SHOP', text }] })).toContain('created SHOP-2001');
    const read = await a.call('vantage_read', { addresses: ['SHOP-2001'] });
    expect(read).toContain('deciders:\n  - Avery Example');
    expect(read).toContain('### Shared database\n\nTwo writers drift.');
    expect(await a.call('vantage_find', { query: 'one writer', in: 'SHOP' })).toContain('SHOP-2001:');
    expect(await a.call('vantage_outline', { address: 'SHOP' })).toContain('SHOP-2001  Accepted');
    expect(await a.call('vantage_outline', { address: 'SHOP-2001' })).toContain('#decision  Decision');

    // Writing back what was read changes nothing: no new revision.
    const whole = read.slice(read.indexOf('\n') + 1);
    expect(await a.call('vantage_write', { writes: [{ address: 'SHOP-2001', text: whole }] })).toContain('unchanged');
    // A patch sends one sentence; only that section is a new revision. Its header is text too.
    expect(await a.call('vantage_patch', { edits: [{ address: 'SHOP-2001#decision', old: 'writes orders.', new: 'writes orders, through one queue.' }, { address: 'SHOP-2001', old: 'status: accepted', new: 'status: deprecated' }], message: 'the queue' })).toBe('saved SHOP-2001 (status, decision); last updated ' + new Date().toISOString().slice(0, 10));
    const after = await a.call('vantage_read', { addresses: ['SHOP-2001#decision'] });
    expect(after).toContain('Only the Shop API writes orders, through one queue.');
    expect(after).not.toContain('## Context');
    expect((await door('vantage_history', { address: 'SHOP-2001' })).split('\n')[0]).toContain('the queue');
    // The same sentence is in no other section, so a patch scoped to the wrong one misses and saves nothing.
    expect((await a.attempt('vantage_patch', { edits: [{ address: 'SHOP-2001#context', old: 'through one queue', new: 'x' }] })).text).toContain('old was not found');
    expect((await a.attempt('vantage_patch', { edits: [{ address: 'SHOP-2001', old: 'category: 2', new: 'category: 3' }] })).text).toContain('vantage_decision_move');

    const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
    expect(await door('vantage_registries', { action: 'create', workspace: ws.slug, prefix: 'LEGACY', name: 'Legacy' })).toContain('created LEGACY');
    const dir = join(import.meta.dir, 'fixtures');
    // Newest first: a supersede link must not depend on the order the files arrive in.
    const files = readdirSync(dir)
      .sort()
      .reverse()
      .map((f) => ({ path: `docs/decisions/${f}`, text: readFileSync(join(dir, f), 'utf8') }));
    const dry = await door('vantage_decision_import', { registry: 'LEGACY', files, dryRun: true });
    expect(dry).toContain('Would import 3 into LEGACY');
    expect(await a.call('vantage_outline', { address: 'LEGACY' })).toContain('0 records');
    const done = await door('vantage_decision_import', { registry: 'LEGACY', files });
    expect(done).toContain('Imported 3 into LEGACY');
    expect(done).toContain('docs/decisions/2001-agents-sign-in-through-the-hub.md -> LEGACY-2001 superseded http://hub.test/w/');
    expect(done).toContain('docs/decisions/notes-without-number.md: no record number');
    expect(done).toContain('related to 1001, which is not in this registry');
    const old = await a.call('vantage_read', { addresses: ['LEGACY-2001'] });
    expect(old).toContain('superseded_by: LEGACY-2002');
    expect(old).toContain('decided: 2026-03-02');
    expect(await a.call('vantage_read', { addresses: ['LEGACY-2002'] })).toContain('supersedes: LEGACY-2001');
    expect(await a.call('vantage_outline', { address: 'LEGACY#deprecated' })).toContain('LEGACY-0003  Deprecated');
    expect(await door('vantage_decision_next', { registry: 'LEGACY', category: 2 })).toBe('LEGACY-2003 (Security)');
    expect(await door('vantage_decision_import', { registry: 'LEGACY', files })).toContain('Imported 0 into LEGACY; 3 already there');
    expect(await a.call('vantage_find', { query: 'device code', in: 'LEGACY' })).toContain('LEGACY-2002:');

    // The same files in the other order link the same way.
    await door('vantage_registries', { action: 'create', workspace: ws.slug, prefix: 'OLDER', name: 'Older' });
    await door('vantage_decision_import', { registry: 'OLDER', files: [...files].reverse() });
    expect(await a.call('vantage_read', { addresses: ['OLDER-2001'] })).toContain('superseded_by: OLDER-2002');
    expect(await a.call('vantage_read', { addresses: ['OLDER-2002'] })).toContain('supersedes: OLDER-2001');

    // A record marked superseded with no successor was marked so by mistake, and may be set right; one with a
    // successor stays superseded.
    const stray = { path: 'docs/decisions/2005-left-alone.md', text: '# ADR-2005: Left alone\n\n## Status\n\nSuperseded\n\n## Context\n\nA.\n\n## Decision\n\nB.\n' };
    await door('vantage_decision_import', { registry: 'OLDER', files: [stray] });
    expect(await a.call('vantage_patch', { edits: [{ address: 'OLDER-2005', old: 'status: superseded', new: 'status: accepted' }], minor: true })).toContain('saved OLDER-2005 (status)');
    expect((await a.attempt('vantage_patch', { edits: [{ address: 'OLDER-2001', old: 'status: superseded', new: 'status: accepted' }] })).text).toContain('its status stays as it is');
    expect((await a.attempt('vantage_patch', { edits: [{ address: 'OLDER-2005', old: 'status: accepted', new: 'status: superseded' }] })).text).toContain('vantage_decision_supersede');
  });
});

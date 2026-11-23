import { describe, expect, test } from 'bun:test';
import { testContext, testUser, SAMPLE_YAML } from '../testing.ts';
import { saveDocument } from './save.ts';
import { incomingFiles, pageFiles, readPage } from './pages.ts';
import { storedBundle } from './derived.ts';
import { accessibleWorkspaces } from '../authz.ts';
import { createWorker } from '../worker/loop.ts';
import { searchDocuments } from '../search.ts';

const WITH_PAGE = `${SAMPLE_YAML}  - id: guide
    kind: doc
    title: Guide
    file: pages/guide.md
    beside: context
`;

const GUIDE = '## Orders {#orders}\n\nThe [[shop-api]] takes orders.\n\n## Storage {#storage}\n\nOrders land in [[orders-db]].\n';

describe('pages', () => {
  test('a save carries pages, the worker draws them, and search finds a heading', async () => {
    const ctx = await testContext();
    const { principal } = await testUser(ctx, 'author');
    const ws = (await accessibleWorkspaces(ctx.db, principal))[0]!;
    const base = { orgId: 'default', workspaceId: ws.id, authorUserId: principal.userId, who: principal.userId, surface: 'api' as const };
    const saved = await saveDocument(ctx, { ...base, yaml: WITH_PAGE, files: incomingFiles(ctx, 'default', pageFiles({ 'pages/guide.md': GUIDE })) });
    if (saved.status !== 'saved') throw new Error('expected save');
    expect(saved.version.attachments.map((a) => [a.path, a.contentType])).toEqual([['pages/guide.md', 'text/markdown; charset=utf-8']]);
    expect(await readPage(ctx, saved.version, 'pages/guide.md')).toBe(GUIDE);

    await createWorker(ctx).drain();
    const bundle = JSON.parse((await storedBundle(ctx, saved.version))!.bundle) as { views: { id: string; kind: string; beside?: string; doc?: { html: string; nodes: string[]; headings: { id: string }[] } }[]; diagnostics: { severity: string }[] };
    const guide = bundle.views.find((v) => v.id === 'guide')!;
    expect(guide.kind).toBe('doc');
    expect(guide.beside).toBe('context');
    expect(guide.doc!.nodes).toEqual(['shop-api', 'orders-db']);
    expect(guide.doc!.headings.map((h) => h.id)).toEqual(['orders', 'storage']);
    expect(guide.doc!.html).toContain('data-node="shop-api"');
    expect(bundle.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect((await searchDocuments(ctx.db, principal, 'storage')).map((h) => h.documentId)).toEqual([saved.document.id]);

    // A page the YAML stops naming is dropped with it.
    const dropped = await saveDocument(ctx, { ...base, documentId: saved.document.id, yaml: SAMPLE_YAML });
    if (dropped.status !== 'saved') throw new Error('expected save');
    expect(dropped.version.attachments).toEqual([]);
    await ctx.db.close();
  });

  test('a page two sides changed is merged line by line, and the same lines are a conflict that names the page', async () => {
    const ctx = await testContext();
    const { principal } = await testUser(ctx, 'author');
    const ws = (await accessibleWorkspaces(ctx.db, principal))[0]!;
    const base = { orgId: 'default', workspaceId: ws.id, authorUserId: principal.userId, who: principal.userId, surface: 'api' as const };
    const page = (text: string) => incomingFiles(ctx, 'default', pageFiles({ 'pages/guide.md': text }));
    const first = await saveDocument(ctx, { ...base, yaml: WITH_PAGE, files: page(GUIDE) });
    if (first.status !== 'saved') throw new Error('expected save');
    const doc = { ...base, documentId: first.document.id, yaml: WITH_PAGE };

    // A person edits the first section on the head.
    const person = await saveDocument(ctx, { ...doc, files: page(GUIDE.replace('takes orders', 'takes orders and refunds')), expectedVersionId: first.version.id });
    if (person.status !== 'saved') throw new Error('expected save');

    // An agent that read the first version rewrites the second section: both land.
    const agent = await saveDocument(ctx, { ...doc, files: page(GUIDE.replace('Orders land in', 'Every order is written to')), expectedVersionId: first.version.id });
    if (agent.status !== 'saved') throw new Error('expected save');
    const merged = (await readPage(ctx, agent.version, 'pages/guide.md'))!;
    expect(merged).toContain('takes orders and refunds');
    expect(merged).toContain('Every order is written to');

    // The agent sends the page as it first read it: the person's edit stays.
    const stale = await saveDocument(ctx, { ...doc, files: page(GUIDE), expectedVersionId: first.version.id });
    expect(stale.status).toBe('unchanged');

    // Both change the same line: the save comes back, naming the page.
    const clash = await saveDocument(ctx, { ...doc, files: page(GUIDE.replace('takes orders', 'rejects orders')), expectedVersionId: first.version.id });
    expect(clash.status).toBe('conflict');
    if (clash.status !== 'conflict') return;
    expect(clash.path).toBe('pages/guide.md');
    expect(clash.preview).toContain('<<<<<<< yours');
    await ctx.db.close();
  });

  test('only a .md path is a page', () => {
    expect(() => pageFiles({ 'pages/guide.txt': 'x' })).toThrow();
  });
});

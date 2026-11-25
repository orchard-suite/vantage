import { describe, expect, test } from 'bun:test';
import { testContext, testUser, SAMPLE_YAML } from '../testing.ts';
import type { AppContext } from '../context.ts';
import { createLogger } from '../log.ts';
import { accessibleWorkspaces } from '../authz.ts';
import { saveDocument } from '../documents/save.ts';
import { RENDERER } from '../render/renderer.ts';
import { claim, enqueueDraw } from './jobs.ts';
import { createWorker } from './loop.ts';
import { startReleaseRedraw } from './release-redraw.ts';

const TWO_VIEWS = `${SAMPLE_YAML}  - id: store
    title: Store
    include: { nodes: [shop-api, orders-db] }
`;

/** A hub with three drawn documents, all drawn by an older release, and the log lines it writes. */
async function drawnByAnOlderRelease(): Promise<{ ctx: AppContext; lines: Record<string, unknown>[]; docs: { id: string; version: string }[]; save: (doc: { id: string; version: string }, yaml: string) => Promise<string> }> {
  const base = await testContext();
  const lines: Record<string, unknown>[] = [];
  const ctx = { ...base, log: createLogger('info', { write: (l) => lines.push(JSON.parse(l) as Record<string, unknown>) }) };
  const { principal } = await testUser(ctx, 'author');
  const ws = (await accessibleWorkspaces(ctx.db, principal))[0]!;
  const input = { orgId: 'default', workspaceId: ws.id, authorUserId: principal.userId, who: principal.userId, surface: 'api' as const };
  const docs: { id: string; version: string }[] = [];
  for (const name of ['One', 'Two', 'Three']) {
    const r = await saveDocument(ctx, { ...input, name, yaml: TWO_VIEWS.replace('title: Sample', `title: ${name}`) });
    if (r.status !== 'saved') throw new Error(r.status);
    docs.push({ id: r.document.id, version: r.version.id });
  }
  await createWorker(ctx).drain();
  await ctx.db.query("update render_states set renderer = 'older'");
  const save = async (doc: { id: string; version: string }, yaml: string): Promise<string> => {
    const r = await saveDocument(ctx, { ...input, documentId: doc.id, yaml, expectedVersionId: doc.version });
    if (r.status !== 'saved') throw new Error(r.status);
    return r.version.id;
  };
  return { ctx, lines, docs, save };
}

const msgs = (lines: Record<string, unknown>[], msg: string) => lines.filter((l) => l['msg'] === msg);

async function until(check: () => Promise<boolean>, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('a new release redraws in the background', () => {
  test("a worker of a new release redraws every document, so the first save after it draws from cache", async () => {
    const { ctx, lines, docs, save } = await drawnByAnOlderRelease();
    const worker = createWorker(ctx);
    await worker.start();
    await until(async () => msgs(lines, 'release.redraw.end').length === 1);
    await worker.stop();
    expect((await ctx.db.query<{ renderer: string }>('select distinct renderer from render_states rs join versions v on v.hash = rs.version_hash join documents d on d.head_version_id = v.id')).map((r) => r.renderer)).toEqual([RENDERER]);
    expect(msgs(lines, 'release.redraw.end')[0]).toMatchObject({ documents: 3, drawn: 3, failed: 0 });
    expect(typeof msgs(lines, 'release.redraw.end')[0]!['ms']).toBe('number');

    const version = await save(docs[0]!, TWO_VIEWS.replace('title: Sample', 'title: One, renamed'));
    await createWorker(ctx).drain();
    expect(msgs(lines, 'render.picture').find((l) => l['versionId'] === version)).toMatchObject({ drawn: 0, reused: 2 });
  }, 30_000);

  test('one redraw per release, however many workers start, and a restart goes on where it stopped', async () => {
    const { ctx, lines } = await drawnByAnOlderRelease();
    expect(await startReleaseRedraw(ctx)).toBe(1);
    expect(await startReleaseRedraw(ctx)).toBe(0);
    const worker = createWorker(ctx);
    // The driver queues the first document, which is drawn; then the worker stops.
    expect(await worker.tick()).toBe(true);
    expect(await worker.tick()).toBe(true);
    // A restarted worker starts nothing new and finishes what was left.
    expect(await startReleaseRedraw(ctx)).toBe(0);
    await createWorker(ctx).drain();
    expect(msgs(lines, 'release.redraw.start')).toHaveLength(1);
    expect(msgs(lines, 'release.redraw.end')).toHaveLength(1);
    const redraws = await ctx.db.query<{ doc: string; n: number }>("select payload->>'documentId' as doc, count(*)::int as n from jobs where kind = 'redraw' and state = 'done' group by 1");
    expect(redraws.map((r) => r.n)).toEqual([1, 1, 1]);
  }, 30_000);

  test('a redraw is claimed after every other draw, and a save that comes while it waits takes its place', async () => {
    const ctx = await testContext();
    const release = await enqueueDraw(ctx.db, { orgId: 'default', kind: 'redraw', documentId: 'a', payload: { release: RENDERER } });
    const refresh = await enqueueDraw(ctx.db, { orgId: 'default', kind: 'overlay', documentId: 'b' });
    const save = await enqueueDraw(ctx.db, { orgId: 'default', kind: 'render', documentId: 'c' });
    expect([(await claim(ctx.db, 'w'))?.id, (await claim(ctx.db, 'w'))?.id, (await claim(ctx.db, 'w'))?.id]).toEqual([save, refresh, release]);
    const waiting = await enqueueDraw(ctx.db, { orgId: 'default', kind: 'redraw', documentId: 'd', payload: { release: RENDERER } });
    expect(await enqueueDraw(ctx.db, { orgId: 'default', kind: 'render', documentId: 'd', payload: { versionId: 'v' } })).toBe(waiting);
    expect((await claim(ctx.db, 'w'))).toMatchObject({ id: waiting, kind: 'render', payload: { versionId: 'v' } });
  });
});

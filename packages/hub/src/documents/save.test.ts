import { describe, expect, test } from 'bun:test';
import { testContext, testUser, SAMPLE_YAML } from '../testing.ts';
import { refreshBindSources, saveDocument } from './save.ts';
import { listVersions } from './repo.ts';
import { accessibleWorkspaces } from '../authz.ts';
import { createWorker } from '../worker/loop.ts';
import { artifactsFor } from './repo.ts';
import { storedArtifact } from './derived.ts';
import { runGc } from '../worker/gc.ts';
import { JobLog } from '../worker/jobs.ts';
import { channelName } from '../db/db.ts';
import { createLogger } from '../log.ts';

describe('save and render', () => {
  test('every save logs one line with the milliseconds of each phase, refused saves too', async () => {
    const base = await testContext();
    const lines: Record<string, unknown>[] = [];
    const ctx = { ...base, log: createLogger('info', { write: (l) => lines.push(JSON.parse(l) as Record<string, unknown>) }) };
    const { principal } = await testUser(ctx, 'author');
    const ws = (await accessibleWorkspaces(ctx.db, principal))[0]!;
    const input = { orgId: 'default', workspaceId: ws.id, authorUserId: principal.userId, who: principal.userId, surface: 'api' as const, yaml: SAMPLE_YAML };
    expect((await saveDocument(ctx, input)).status).toBe('saved');
    await expect(saveDocument(ctx, { ...input, yaml: 'nodes: [' })).rejects.toThrow();
    const timed = lines.filter((l) => l['msg'] === 'save.phases');
    expect(timed.map((l) => l['status'])).toEqual(['saved', 'failed']);
    const phases = timed[0]!['phases'] as Record<string, number>;
    expect(Object.keys(phases)).toEqual(expect.arrayContaining(['lock', 'check.resources', 'check.document', 'version', 'citations', 'draw', 'commit']));
    expect(Object.values(phases).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(timed[0]!['ms'] as number);
  });

  test('save creates versions, merges parallel edits, and reports conflicts with a diff', async () => {
    const ctx = await testContext();
    const { principal } = await testUser(ctx, 'author');
    const ws = (await accessibleWorkspaces(ctx.db, principal))[0]!;
    const base = { orgId: 'default', workspaceId: ws.id, authorUserId: principal.userId, who: principal.userId, surface: 'api' as const };
    const first = await saveDocument(ctx, { ...base, yaml: SAMPLE_YAML, message: 'first' });
    expect(first.status).toBe('saved');
    if (first.status !== 'saved') return;
    expect(first.document.slug).toBe('sample');
    const v1 = first.version.id;

    const second = await saveDocument(ctx, { ...base, documentId: first.document.id, yaml: SAMPLE_YAML.replace('title: Sample', 'title: Renamed'), expectedVersionId: v1 });
    expect(second.status).toBe('saved');
    if (second.status !== 'saved') return;
    expect(second.document.name).toBe('Renamed');

    const merged = await saveDocument(ctx, { ...base, documentId: first.document.id, yaml: SAMPLE_YAML.replace('label: buys', 'label: orders'), expectedVersionId: v1 });
    expect(merged.status).toBe('saved');
    if (merged.status !== 'saved') return;
    expect(merged.merged).toBe(true);
    expect(merged.version.yaml).toContain('title: Renamed');
    expect(merged.version.yaml).toContain('label: orders');

    const conflict = await saveDocument(ctx, { ...base, documentId: first.document.id, yaml: SAMPLE_YAML.replace('title: Sample', 'title: Other'), expectedVersionId: v1 });
    expect(conflict.status).toBe('conflict');
    if (conflict.status !== 'conflict') return;
    expect(conflict.diff).toContain('+title: Renamed');
    expect(conflict.preview).toContain('<<<<<<< yours');

    const unchanged = await saveDocument(ctx, { ...base, documentId: first.document.id, yaml: merged.version.yaml, expectedVersionId: merged.version.id });
    expect(unchanged.status).toBe('unchanged');

    expect((await listVersions(ctx.db, first.document.id)).length).toBe(3);
    // Three saves while nothing drew: one draw waits, for whatever is head when it runs.
    const jobs = await ctx.db.query<{ kind: string; payload: { head: boolean } }>("select kind, payload from jobs where state = 'queued'");
    expect(jobs.map((j) => [j.kind, j.payload.head])).toEqual([['render', true]]);
    const audit = await ctx.db.query<{ what: string }>('select what from audit');
    expect(audit.filter((a) => a.what === 'document.save').length).toBe(3);
    await ctx.db.close();
  });

  test('the worker renders every view into artifacts, notifies, and gc keeps N versions', async () => {
    const ctx = await testContext({ env: { RETENTION_VERSIONS: '2' } });
    const { principal } = await testUser(ctx, 'author');
    const ws = (await accessibleWorkspaces(ctx.db, principal))[0]!;
    const base = { orgId: 'default', workspaceId: ws.id, authorUserId: principal.userId, who: principal.userId, surface: 'api' as const };
    const saved = await saveDocument(ctx, { ...base, yaml: SAMPLE_YAML });
    if (saved.status !== 'saved') throw new Error('expected save');
    const notified: string[] = [];
    const un = await ctx.db.listen(channelName('vantage_doc', saved.document.id), (p) => notified.push(p));
    const worker = createWorker(ctx);
    expect(await worker.drain()).toBe(1);
    const arts = await artifactsFor(ctx.db, saved.version.hash);
    expect(arts.map((a) => a.kind).sort()).toEqual(['bundle', 'view']);
    // SVG, PNG, and HTML are made on first request, beside the render they came from.
    const png = await storedArtifact(ctx, saved.version, 'context', 'png');
    expect(png?.contentType).toBe('image/png');
    expect(png?.renderId).toBe(arts[0]!.render_id);
    expect((await artifactsFor(ctx.db, saved.version.hash)).map((a) => a.kind).sort()).toEqual(['bundle', 'png', 'svg', 'view']);
    await ctx.db.query("delete from artifacts where kind in ('png', 'svg')");
    const bundle = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array((await ctx.blob.get(arts.find((a) => a.kind === 'bundle')!.blob_key))!)))) as { views: { id: string }[] };
    expect(bundle.views.map((v) => v.id)).toEqual(['context']);
    await new Promise((r) => setTimeout(r, 30));
    // Once, when the render is stored.
    expect(notified.length).toBe(1);
    await un();
    const job = await ctx.db.query<{ state: string; log: unknown[] }>("select state, log from jobs where kind = 'render'");
    expect(job[0]!.state).toBe('done');
    expect(job[0]!.log.length).toBeGreaterThan(0);

    for (const t of ['A', 'B', 'C']) {
      const r = await saveDocument(ctx, { ...base, documentId: saved.document.id, yaml: SAMPLE_YAML.replace('title: Sample', `title: ${t}`) });
      expect(r.status).toBe('saved');
    }
    // The burst draws once: the last version, whose renamed title reuses the first render's view entry.
    expect(await worker.drain()).toBe(1);
    const head = (await listVersions(ctx.db, saved.document.id))[0]!;
    expect((await artifactsFor(ctx.db, head.hash)).map((a) => a.kind).sort()).toEqual(['bundle', 'view']);
    expect((await ctx.db.query('select id from artifacts')).length).toBe(4);
    const gc = await runGc(ctx, 'default', new JobLog());
    expect(gc.versionsRemoved).toBe(2);
    // The first version's bundle goes; its view entry stays, since the head's render names it too.
    expect(gc.blobsRemoved).toBe(1);
    expect((await listVersions(ctx.db, saved.document.id)).length).toBe(2);
    await ctx.db.query("update jobs set run_at = now() where kind = 'drop-files' and state = 'queued'");
    await worker.drain();
    const kept = await ctx.blob.list('');
    expect(kept.filter((k) => k.endsWith('bundle.json.gz')).length).toBe(1);
    expect(kept.filter((k) => k.endsWith('.svg')).length).toBe(1);
    // Every file a row names is there.
    for (const a of await ctx.db.query<{ blob_key: string }>('select blob_key from artifacts')) expect(kept).toContain(a.blob_key);
    await ctx.db.close();
  });
});

describe('the sources a document draws from', () => {
  const OBSERVED = `title: Live
imports:
  - { path: shared.vantage.yaml, as: shared }
nodes:
  - id: fleet
    name: Fleet
    observe: { source: fleet, types: [cluster] }
  - id: api
    name: API
    bind: billing:api-1
views:
  - id: main
    title: Main
    include: { nodes: [fleet, api] }
`;
  const SHARED = `title: Shared
nodes:
  - id: db
    name: DB
    bind: dbs:primary
`;

  test('a save counts observe blocks and imported files, so their sources re-render it', async () => {
    const ctx = await testContext();
    const { principal } = await testUser(ctx, 'author');
    const ws = (await accessibleWorkspaces(ctx.db, principal))[0]!;
    const r = await saveDocument(ctx, { orgId: 'default', workspaceId: ws.id, authorUserId: principal.userId, who: principal.userId, surface: 'api', yaml: OBSERVED, imports: { 'shared.vantage.yaml': SHARED } });
    expect(r.status).toBe('saved');
    expect(r.document.id).toBeTruthy();
    const row = await ctx.db.query<{ bind_sources: string[] }>('select bind_sources from documents where id = $1', [r.document.id]);
    expect(row[0]!.bind_sources).toEqual(['billing', 'dbs', 'fleet']);
  });

  test('the migrate step refreshes documents saved with an older list', async () => {
    const ctx = await testContext();
    const { principal } = await testUser(ctx, 'author');
    const ws = (await accessibleWorkspaces(ctx.db, principal))[0]!;
    const r = await saveDocument(ctx, { orgId: 'default', workspaceId: ws.id, authorUserId: principal.userId, who: principal.userId, surface: 'api', yaml: OBSERVED, imports: { 'shared.vantage.yaml': SHARED } });
    await ctx.db.query(`update documents set bind_sources = '["billing"]'::jsonb where id = $1`, [r.document.id]);
    expect(await refreshBindSources(ctx.db, ctx.log)).toBe(1);
    expect(await refreshBindSources(ctx.db, ctx.log)).toBe(0);
    const row = await ctx.db.query<{ bind_sources: string[] }>('select bind_sources from documents where id = $1', [r.document.id]);
    expect(row[0]!.bind_sources).toEqual(['billing', 'dbs', 'fleet']);
  });
});

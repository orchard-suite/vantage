/**
 * Retention: keep the newest N versions per document (the workspace may
 * set its own N), drop artifacts and the blobs no artifact names any more,
 * drop voice walkthrough audio no recording names (a purged workspace's), prune
 * run history older than HISTORY_DAYS, and
 * purge disabled workspaces once their grace period ends. A removed
 * version's files go when no other version names them; files are only
 * judged when a version that held them goes, so a save in flight never
 * loses its upload.
 */
import { pruneOAuth } from '../auth/oauth.ts';
import type { AppContext } from '../context.ts';
import { audit } from '../audit.ts';
import type { JobLog } from './jobs.ts';
import { assetKey, type Attachment } from '../documents/assets.ts';
import { iconKey } from '../workspace-icons.ts';
import { dropOrphanRecordings } from '../recordings.ts';

export interface GcOutcome {
  readonly versionsRemoved: number;
  readonly artifactsRemoved: number;
  readonly blobsRemoved: number;
  readonly jobsRemoved: number;
  readonly runsRemoved: number;
  readonly notificationsRemoved: number;
  readonly signInsRemoved: number;
}

export async function runGc(ctx: AppContext, orgId: string, jlog: JobLog): Promise<GcOutcome> {
  const log = ctx.log.child({ task: 'gc', orgId });
  log.info('gc.start', { defaultRetention: ctx.config.RETENTION_VERSIONS });
  const docs = await ctx.db.query<{ id: string; head_version_id: string | null; retention: number | null }>(
    `select d.id, d.head_version_id, (w.settings->>'retentionVersions')::int as retention from documents d join workspaces w on w.id = d.workspace_id where d.org_id = $1`,
    [orgId],
  );
  let versionsRemoved = 0;
  const released = new Set<string>();
  for (const d of docs) {
    const keep = Math.max(1, d.retention ?? ctx.config.RETENTION_VERSIONS);
    const gone = await ctx.db.query<{ id: string; attachments: readonly Attachment[] }>(
      `delete from versions where document_id = $1 and id <> coalesce($2, '') and id in (
         select id from versions where document_id = $1 order by created_at desc offset $3
       ) returning id, attachments`,
      [d.id, d.head_version_id, keep],
    );
    for (const v of gone) for (const a of v.attachments) released.add(a.hash);
    if (gone.length) {
      versionsRemoved += gone.length;
      log.info('gc.versions.removed', { documentId: d.id, keep, removed: gone.length });
    }
  }
  const orphan = await ctx.db.query<{ id: string; blob_key: string }>('delete from artifacts a where a.org_id = $1 and not exists (select 1 from versions v where v.hash = a.version_hash) returning id, blob_key', [orgId]);
  let blobsRemoved = 0;
  const named = await stillNamed(ctx, orphan.map((a) => a.blob_key));
  for (const a of orphan) {
    if (named.has(a.blob_key)) continue;
    await ctx.blob.delete(a.blob_key);
    // Renders of 0.0.32 and 0.0.33 kept a `.gz` copy beside each raw bundle and variants file.
    if (a.blob_key.endsWith('.json')) await ctx.blob.delete(`${a.blob_key}.gz`);
    blobsRemoved++;
  }
  blobsRemoved += await releaseFiles(ctx, orgId, released, new Set());
  blobsRemoved += await dropOrphanPushes(ctx, orgId);
  blobsRemoved += await dropOrphanRecordings(ctx, orgId);
  const history = await pruneHistory(ctx, orgId);
  jlog.add('info', 'gc complete', { documents: docs.length, versionsRemoved, artifactsRemoved: orphan.length, blobsRemoved, ...history });
  log.info('gc.end', { documents: docs.length, versionsRemoved, artifactsRemoved: orphan.length, blobsRemoved, ...history });
  return { versionsRemoved, artifactsRemoved: orphan.length, blobsRemoved, ...history };
}

/** The files of a replaced render, once its grace has passed (see FILES_GRACE_MS). */
export async function dropFiles(ctx: AppContext, job: { payload: Record<string, unknown> }, jlog: JobLog): Promise<{ removed: number }> {
  const keys = Array.isArray(job.payload['keys']) ? (job.payload['keys'] as unknown[]).filter((k): k is string => typeof k === 'string') : [];
  // A later render that reused a view names its files too; those stay.
  const named = await stillNamed(ctx, keys);
  const gone = keys.filter((k) => !named.has(k));
  for (const key of gone) await ctx.blob.delete(key);
  jlog.add('info', 'replaced render files removed', { removed: gone.length, kept: keys.length - gone.length });
  return { removed: gone.length };
}

/** The files a render's rows still name: one render's file can be another's, when a later render reused the view. */
async function stillNamed(ctx: AppContext, keys: readonly string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const rows = await ctx.db.query<{ blob_key: string }>('select distinct blob_key from artifacts where blob_key = any($1)', [keys]);
  return new Set(rows.map((r) => r.blob_key));
}

/** Pushed batches no waiting or running ingest job names: their job gave up, or the source was deleted. */
async function dropOrphanPushes(ctx: AppContext, orgId: string): Promise<number> {
  const live = new Set((await ctx.db.query<{ key: string }>("select payload->>'key' as key from jobs where org_id = $1 and kind = 'ingest' and state in ('queued', 'running')", [orgId])).map((r) => r.key));
  let removed = 0;
  for (const key of await ctx.blob.list(`batches/${orgId}/`)) {
    if (live.has(key)) continue;
    await ctx.blob.delete(key);
    removed++;
  }
  if (removed) ctx.log.info('gc.pushes.removed', { orgId, removed });
  return removed;
}

/** Run history past HISTORY_DAYS: finished jobs, source and publication runs, notifications; and agent sign-ins that ended or never finished. The audit log stays. */
async function pruneHistory(ctx: AppContext, orgId: string): Promise<{ jobsRemoved: number; runsRemoved: number; notificationsRemoved: number; signInsRemoved: number }> {
  const days = String(ctx.config.HISTORY_DAYS);
  const count = async (sql: string): Promise<number> => (await ctx.db.query<{ id: string }>(sql, [orgId, days])).length;
  const jobsRemoved = await count("delete from jobs where org_id = $1 and state in ('done', 'failed') and updated_at < now() - ($2 || ' days')::interval returning id");
  const runsRemoved =
    (await count("delete from source_runs where org_id = $1 and started_at < now() - ($2 || ' days')::interval returning id")) +
    (await count("delete from publication_runs where org_id = $1 and started_at < now() - ($2 || ' days')::interval returning id"));
  const notificationsRemoved = await count("delete from notifications where org_id = $1 and created_at < now() - ($2 || ' days')::interval returning id");
  const signInsRemoved = await pruneOAuth(ctx.db, orgId);
  return { jobsRemoved, runsRemoved, notificationsRemoved, signInsRemoved };
}

/** Deletes the document files and workspace icons whose hashes no remaining row of the org names. */
export async function releaseFiles(ctx: AppContext, orgId: string, assets: ReadonlySet<string>, icons: ReadonlySet<string>): Promise<number> {
  let removed = 0;
  if (assets.size) {
    const held = new Set((await ctx.db.query<{ hash: string }>("select distinct a->>'hash' as hash from versions v, jsonb_array_elements(v.attachments) a where v.org_id = $1", [orgId])).map((r) => r.hash));
    for (const hash of assets) {
      if (held.has(hash)) continue;
      await ctx.blob.delete(assetKey(orgId, hash));
      removed++;
      ctx.log.info('gc.asset.removed', { orgId, hash });
    }
  }
  if (icons.size) {
    const held = new Set((await ctx.db.query<{ hash: string }>('select distinct hash from workspace_icons where org_id = $1', [orgId])).map((r) => r.hash));
    for (const hash of icons) {
      if (held.has(hash)) continue;
      await ctx.blob.delete(iconKey(orgId, hash));
      removed++;
      ctx.log.info('gc.icon.removed', { orgId, hash });
    }
  }
  return removed;
}

export async function runPurge(ctx: AppContext, orgId: string, jlog: JobLog): Promise<{ purged: number }> {
  const log = ctx.log.child({ task: 'purge', orgId });
  log.info('purge.start', {});
  const due = await ctx.db.query<{ id: string; slug: string }>('select id, slug from workspaces where org_id = $1 and disabled_at is not null and purge_after is not null and purge_after <= now()', [orgId]);
  const assets = new Set<string>();
  const icons = new Set<string>();
  for (const w of due) {
    for (const r of await ctx.db.query<{ hash: string }>("select distinct a->>'hash' as hash from versions v join documents d on d.id = v.document_id, jsonb_array_elements(v.attachments) a where d.workspace_id = $1", [w.id])) assets.add(r.hash);
    for (const r of await ctx.db.query<{ hash: string }>('select hash from workspace_icons where workspace_id = $1', [w.id])) icons.add(r.hash);
    await ctx.db.transaction(async (tx) => {
      await tx.query('delete from workspaces where id = $1', [w.id]);
      await audit(tx, log, { orgId, who: 'worker', what: 'workspace.purge', surface: 'worker', target: `workspace:${w.id}`, details: { slug: w.slug } });
    });
    jlog.add('info', `purged workspace ${w.slug}`, { workspaceId: w.id });
    log.info('purge.workspace', { workspaceId: w.id, slug: w.slug });
  }
  if (due.length) {
    const files = await releaseFiles(ctx, orgId, assets, icons);
    const gc = await runGc(ctx, orgId, jlog);
    log.info('purge.gc', { ...gc, files });
  } else jlog.add('info', 'nothing due for purge');
  log.info('purge.end', { purged: due.length });
  return { purged: due.length };
}

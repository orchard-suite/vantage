/**
 * The publication-run job: refuse a publication an admin has not let
 * run, then produce the artifacts of the document's head
 * version, stamp them, hand them to the target through @vantage/publish
 * with the org's secret resolver, record the run, audit it, and notify the
 * workspace when it failed.
 */
import { runPublication, type PublishResult } from '@vantage/publish';
import type { AppContext } from '../context.ts';
import { audit } from '../audit.ts';
import { randomId } from '../crypto.ts';
import { documentById, headVersion } from '../documents/repo.ts';
import { notify } from '../notify/notify.ts';
import { blockedReason, publicationById, recordPublicationRun, toPublication, type PublicationRow } from '../publishing/repo.ts';
import { hubProducer } from '../publishing/producer.ts';
import { secretResolver } from '../secrets.ts';
import type { JobLog, JobRow } from './jobs.ts';

export interface PublicationOutcome {
  readonly publicationId: string;
  readonly versionId: string;
  readonly written: number;
  readonly skipped: number;
  readonly warnings: number;
}

export async function runPublicationJob(ctx: AppContext, job: JobRow, jlog: JobLog): Promise<PublicationOutcome> {
  const publicationId = String(job.payload['publicationId'] ?? '');
  const trigger = String(job.payload['trigger'] ?? 'manual');
  const pub = await publicationById(ctx.db, publicationId);
  if (!pub) throw new Error(`publication ${publicationId} not found`);
  const blocked = blockedReason(pub, ctx.config.PUBLICATION_APPROVAL);
  if (blocked) {
    ctx.log.warn('publication.blocked', { publicationId: pub.id, approval: pub.approval, trigger });
    throw new Error(blocked);
  }
  return publish(ctx, pub, { trigger, jobId: job.id, who: String(job.payload['who'] ?? 'worker'), jlog });
}

export async function publish(ctx: AppContext, pub: PublicationRow, opts: { trigger: string; jobId: string | null; who: string; jlog: JobLog }): Promise<PublicationOutcome> {
  const log = ctx.log.child({ publicationId: pub.id, documentId: pub.document_id, target: pub.target, trigger: opts.trigger });
  const started = new Date();
  log.info('publication.start', { formats: pub.formats, views: pub.views, audience: pub.audience });
  const doc = await documentById(ctx.db, pub.document_id);
  if (!doc) throw new Error(`document ${pub.document_id} not found`);
  const version = await headVersion(ctx.db, doc);
  if (!version) throw new Error(`document ${doc.slug} has no versions to publish`);
  const ws = await ctx.db.query<{ slug: string }>('select slug from workspaces where id = $1', [doc.workspace_id]);
  const warnings: string[] = [];
  const stamp = { title: doc.name, version: version.id, publishedAt: started.toISOString(), liveUrl: `${ctx.config.PUBLIC_URL}/w/${ws[0]?.slug ?? doc.workspace_id}/${doc.slug}` };
  const producer = hubProducer(ctx, { document: doc, version, stamp, onWarning: (m) => warnings.push(m) });
  let result: PublishResult | undefined;
  let error: string | undefined;
  try {
    result = await runPublication(toPublication(pub), stamp, producer, ctx.targets, { secrets: secretResolver(ctx.db, ctx.config.SECRETS_KEY, pub.org_id, log), log, now: () => new Date(), fetch: ctx.fetch });
  } catch (err) {
    error = (err as Error).message;
    log.error('publication.failed', { error: err as Error });
  }
  const finished = new Date();
  const written = result?.written ?? [];
  const skipped = result?.skipped ?? [];
  const status = error ? 'failed' : 'ok';
  await recordPublicationRun(ctx.db, { id: randomId(), orgId: pub.org_id, publication_id: pub.id, job_id: opts.jobId, trigger: opts.trigger, status, version_id: version.id, started_at: started, finished_at: finished, written: [...written], skipped: [...skipped, ...warnings.map((w) => ({ artifact: '-', reason: w }))], error: error ?? null });
  await audit(ctx.db, log, { orgId: pub.org_id, who: opts.who, what: 'publication.run', surface: opts.jobId ? 'worker' : 'api', target: `publication:${pub.id}`, details: { trigger: opts.trigger, status, versionId: version.id, written: written.length, skipped: skipped.length, audience: pub.audience, target: pub.target } });
  for (const w of warnings) opts.jlog.add('warn', w);
  opts.jlog.add(error ? 'error' : 'info', error ? `publication failed: ${error}` : 'publication complete', { written: written.length, skipped: skipped.length });
  if (error) {
    await notify(ctx, { orgId: pub.org_id, workspaceId: pub.workspace_id, kind: 'publication-failed', title: `Publication ${pub.name} failed`, body: `${doc.name} to ${pub.target}: ${error}`, link: stamp.liveUrl });
    log.info('publication.end', { status, ms: finished.getTime() - started.getTime() });
    throw new Error(error);
  }
  log.info('publication.end', { status, written: written.length, skipped: skipped.length, warnings: warnings.length, ms: finished.getTime() - started.getTime() });
  return { publicationId: pub.id, versionId: version.id, written: written.length, skipped: skipped.length, warnings: warnings.length };
}

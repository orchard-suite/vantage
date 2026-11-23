/**
 * The render job: one version in, every artifact out. A save's job draws
 * the document's head as it is when the job runs, so a burst of saves draws
 * the last one only; a job naming a version draws that version (an older
 * version asked for by a reader). Artifacts are keyed by the version hash,
 * so a second version with the same text reuses them and the job is a no-op
 * that says so. A rendered head then triggers the publications that run on
 * save.
 */
import type { AppContext } from '../context.ts';
import { documentById, headVersion, versionById, type VersionRow } from '../documents/repo.ts';
import { onSavePublications } from '../publishing/repo.ts';
import { enqueue, type JobLog, type JobRow } from './jobs.ts';
import { notifyDocument, renderVersion, type RenderOutcome } from './artifacts.ts';

export { DOC_CHANNEL_PREFIX } from './artifacts.ts';

export async function runRender(ctx: AppContext, job: JobRow, jlog: JobLog): Promise<RenderOutcome> {
  const version = await versionToDraw(ctx, job);
  if (!version) {
    jlog.add('warn', 'nothing to draw: the document or version is gone', { payload: job.payload });
    ctx.log.warn('render.gone', { job: job.id, payload: job.payload });
    return { hash: '', artifacts: 0, reused: true, skipped: true, errors: 0, drift: { declaredNotObserved: 0, observedNotDeclared: 0, factMismatch: 0 }, driftChanged: false, sources: [] };
  }
  const log = ctx.log.child({ job: job.id, versionId: version.id, documentId: version.document_id });
  if (job.payload['head'] === true && job.payload['versionId'] && job.payload['versionId'] !== version.id) log.info('render.coalesced', { saved: job.payload['versionId'] });
  const existing = await ctx.db.query<{ n: string }>('select count(*)::text as n from artifacts where version_hash = $1', [version.hash]);
  let outcome: RenderOutcome;
  if (Number(existing[0]?.n ?? '0') > 0) {
    jlog.add('info', 'artifacts already exist for this hash; reusing', { hash: version.hash });
    log.info('render.reuse', { hash: version.hash, artifacts: Number(existing[0]!.n) });
    // The same text was rendered before: copy its per-view scores onto this version too.
    await ctx.db.query("update versions set scores = coalesce((select scores from versions where hash = $1 and scores <> '{}'::jsonb limit 1), '{}'::jsonb) where id = $2", [version.hash, version.id]);
    outcome = { hash: version.hash, artifacts: Number(existing[0]!.n), reused: true, errors: 0, drift: { declaredNotObserved: 0, observedNotDeclared: 0, factMismatch: 0 }, driftChanged: false, sources: [] };
    await notifyDocument(ctx, version.document_id, version.id, version.hash);
  } else {
    // The render tells open viewers after each pass that stores a picture.
    outcome = await renderVersion(ctx, version, { replace: false, jlog, trigger: 'save' });
  }
  if (job.payload['head'] !== true) return outcome;
  const pubs = await onSavePublications(ctx.db, version.document_id, ctx.config.PUBLICATION_APPROVAL);
  for (const pub of pubs) {
    const jobId = await enqueue(ctx.db, { orgId: version.org_id, kind: 'publication-run', payload: { publicationId: pub.id, trigger: 'on-save' } });
    jlog.add('info', `queued on-save publication ${pub.name}`, { publicationId: pub.id, jobId });
  }
  log.info('render.publications', { onSave: pubs.length });
  return outcome;
}

/** A head job draws the document's head now; any other names its version. */
async function versionToDraw(ctx: AppContext, job: JobRow): Promise<VersionRow | undefined> {
  if (job.payload['head'] === true) {
    const doc = await documentById(ctx.db, String(job.payload['documentId'] ?? ''));
    return doc ? headVersion(ctx.db, doc) : undefined;
  }
  return versionById(ctx.db, String(job.payload['versionId'] ?? ''));
}

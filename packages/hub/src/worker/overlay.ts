/**
 * The overlay job: a source changed, so every document bound to it is
 * re-rendered under its current version with the new observed layer.
 * Drift that appeared or changed raises a notification.
 */
import type { AppContext } from '../context.ts';
import { documentById, headVersion } from '../documents/repo.ts';
import { notify } from '../notify/notify.ts';
import type { JobLog, JobRow } from './jobs.ts';
import { renderVersion, type RenderOutcome } from './artifacts.ts';

export async function runOverlay(ctx: AppContext, job: JobRow, jlog: JobLog): Promise<RenderOutcome | { skipped: string }> {
  const documentId = String(job.payload['documentId'] ?? '');
  const doc = await documentById(ctx.db, documentId);
  if (!doc) {
    jlog.add('warn', 'document is gone; nothing to overlay', { documentId });
    ctx.log.warn('overlay.skip', { documentId, reason: 'document not found' });
    return { skipped: 'document not found' };
  }
  const head = await headVersion(ctx.db, doc);
  if (!head) {
    jlog.add('warn', 'document has no versions; nothing to overlay', { documentId });
    ctx.log.warn('overlay.skip', { documentId, reason: 'no head version' });
    return { skipped: 'no head version' };
  }
  const log = ctx.log.child({ job: job.id, documentId, versionId: head.id });
  log.info('overlay.start', { source: job.payload['source'] ?? null });
  // The render tells open viewers after each pass that stores a picture.
  const outcome = await renderVersion(ctx, head, { replace: true, jlog, trigger: 'overlay' });
  const total = outcome.drift.declaredNotObserved + outcome.drift.observedNotDeclared + outcome.drift.factMismatch;
  if (outcome.driftChanged && total > 0) {
    await notify(ctx, {
      orgId: doc.org_id,
      workspaceId: doc.workspace_id,
      kind: 'drift',
      title: `Drift in ${doc.name}`,
      body: `${total} disagreement${total === 1 ? '' : 's'} between the document and what sources observe: ${outcome.drift.declaredNotObserved} declared but not observed, ${outcome.drift.observedNotDeclared} observed but not declared, ${outcome.drift.factMismatch} fact mismatch${outcome.drift.factMismatch === 1 ? '' : 'es'}.`,
      link: `${ctx.config.PUBLIC_URL}/api/v1/documents/${doc.id}/drift`,
    });
    jlog.add('info', 'drift notification sent', { total });
  }
  log.info('overlay.end', { skipped: outcome.skipped ?? false, artifacts: outcome.artifacts, drift: outcome.drift, driftChanged: outcome.driftChanged, notified: outcome.driftChanged && total > 0 });
  return outcome;
}

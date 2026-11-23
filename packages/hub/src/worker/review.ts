/**
 * The nightly review of one workspace: every document is re-validated
 * against the current observed layer, its layout score and drift counts
 * are compared with the last review, and a review row records the
 * deltas. A change raises a notification.
 */
import { reworkWorkspace } from '../tracking/worked.ts';
import type { AppContext } from '../context.ts';
import { audit } from '../audit.ts';
import { randomId } from '../crypto.ts';
import { maybe } from '../db/db.ts';
import { headVersion, listDocuments } from '../documents/repo.ts';
import { notify } from '../notify/notify.ts';
import { observedForDocument } from './artifacts.ts';
import type { JobLog, JobRow } from './jobs.ts';

export interface DocumentReview {
  readonly name: string;
  readonly versionId: string | null;
  readonly errors: number;
  /** Mean layout score across views, 0 to 100. */
  readonly score: number;
  readonly drift: number;
}

export interface ReviewSummary {
  readonly documents: Record<string, DocumentReview>;
  readonly changed: readonly string[];
}

export interface ReviewRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly started_at: Date;
  readonly finished_at: Date;
  readonly documents: number;
  readonly errors: number;
  readonly score_delta: number;
  readonly drift_delta: number;
  readonly summary: ReviewSummary;
}

export interface ReviewOutcome {
  readonly reviewId: string;
  readonly documents: number;
  readonly errors: number;
  readonly scoreDelta: number;
  readonly driftDelta: number;
  readonly changed: readonly string[];
}

export async function runReview(ctx: AppContext, job: JobRow, jlog: JobLog): Promise<ReviewOutcome> {
  const workspaceId = String(job.payload['workspaceId'] ?? '');
  const ws = await maybe<{ id: string; org_id: string; name: string; slug: string }>(ctx.db, 'select id, org_id, name, slug from workspaces where id = $1 and disabled_at is null', [workspaceId]);
  if (!ws) throw new Error(`workspace ${workspaceId} not found or disabled`);
  const log = ctx.log.child({ job: job.id, workspaceId, task: 'review' });
  const started = new Date();
  log.info('review.start', {});
  // The nightly review works out every roadmap item's state again from its proof, as the spec's review job says.
  const reworked = await reworkWorkspace(ctx.db, ws.org_id, ws.id);
  if (reworked.length) log.info('review.items.reworked', { items: reworked });
  const previous = await maybe<ReviewRow>(ctx.db, 'select * from reviews where workspace_id = $1 order by started_at desc limit 1', [workspaceId]);
  const docs = await listDocuments(ctx.db, ws.id);
  const documents: Record<string, DocumentReview> = {};
  const changed: string[] = [];
  let errors = 0;
  let scoreDelta = 0;
  let driftDelta = 0;
  for (const d of docs) {
    const head = await headVersion(ctx.db, d);
    let review: DocumentReview = { name: d.name, versionId: head?.id ?? null, errors: 0, score: 0, drift: 0 };
    if (head) {
      const observed = await observedForDocument(ctx, d, head);
      const r = await ctx.render.run('review', { yaml: head.yaml, imports: head.imports, observed: observed.model });
      for (const f of r.failedViews) log.warn('review.layout.failed', { documentId: d.id, viewId: f.viewId, error: f.error });
      const errs = r.errors;
      const score = r.score;
      const driftTotal = r.drift;
      review = { name: d.name, versionId: head.id, errors: errs, score, drift: driftTotal };
    }
    documents[d.id] = review;
    errors += review.errors;
    const before = previous?.summary.documents[d.id];
    if (before) {
      scoreDelta += review.score - before.score;
      driftDelta += review.drift - before.drift;
      if (before.errors !== review.errors || before.score !== review.score || before.drift !== review.drift || before.versionId !== review.versionId) changed.push(d.id);
    } else changed.push(d.id);
    log.debug('review.document', { documentId: d.id, ...review, changed: changed.includes(d.id) });
  }
  const finished = new Date();
  const reviewId = randomId();
  const summary: ReviewSummary = { documents, changed };
  await ctx.db.query('insert into reviews (id, org_id, workspace_id, started_at, finished_at, documents, errors, score_delta, drift_delta, summary) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [reviewId, ws.org_id, ws.id, started, finished, docs.length, errors, scoreDelta, driftDelta, JSON.stringify(summary)]);
  await audit(ctx.db, log, { orgId: ws.org_id, who: 'worker', what: 'workspace.review', surface: 'worker', target: `workspace:${ws.id}`, details: { reviewId, documents: docs.length, errors, scoreDelta, driftDelta, changed: changed.length } });
  if (previous && changed.length) {
    const names = changed.map((id) => documents[id]?.name ?? id);
    await notify(ctx, { orgId: ws.org_id, workspaceId: ws.id, kind: 'review', title: `Review of ${ws.name}: ${changed.length} document${changed.length === 1 ? '' : 's'} changed`, body: `${names.slice(0, 10).join(', ')}${names.length > 10 ? ` and ${names.length - 10} more` : ''}. Errors ${errors}, score delta ${scoreDelta.toFixed(1)}, drift delta ${driftDelta}.`, link: `${ctx.config.PUBLIC_URL}/w/${ws.slug}` });
  } else log.debug('review.quiet', { reason: previous ? 'nothing changed' : 'first review sets the baseline' });
  jlog.add('info', 'review complete', { reviewId, documents: docs.length, errors, scoreDelta, driftDelta, changed: changed.length });
  log.info('review.end', { reviewId, documents: docs.length, errors, scoreDelta, driftDelta, changed: changed.length, notified: Boolean(previous && changed.length), ms: finished.getTime() - started.getTime() });
  return { reviewId, documents: docs.length, errors, scoreDelta, driftDelta, changed };
}

export async function listReviews(ctx: AppContext, workspaceId: string, limit = 30): Promise<ReviewRow[]> {
  return ctx.db.query<ReviewRow>('select id, workspace_id, started_at, finished_at, documents, errors, score_delta, drift_delta, summary from reviews where workspace_id = $1 order by started_at desc limit $2', [workspaceId, Math.min(limit, 500)]);
}

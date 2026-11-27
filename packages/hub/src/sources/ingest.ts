/**
 * Folding one batch into a source's observed model: apply the org's
 * mapping, merge against the stored model, store model and run, audit,
 * and queue an overlay for every document of its workspace bound to it.
 * The ingest job, fed by the push endpoint, ends here.
 */
import { applyMapping, mergeObserved, type Batch } from '@vantage/connectors';
import type { AppContext } from '../context.ts';
import { audit } from '../audit.ts';
import { randomId } from '../crypto.ts';
import { documentsBindingAny, documentsBoundTo } from '../documents/repo.ts';
import { enqueueDraw } from '../worker/jobs.ts';
import { reworkSource } from '../tracking/worked.ts';
import { keepHistory } from './history.ts';
import { fillFromCatalog } from '../scopes/catalog.ts';
import { activeMapping, recordRun, updateObservedModel, type RunCounts, type RunTrigger, type SourceRow } from './repo.ts';

export interface IngestInput {
  readonly source: SourceRow;
  readonly batch: Batch;
  readonly trigger: RunTrigger;
  readonly startedAt: Date;
  readonly jobId: string | null;
  readonly who: string;
  /** Warnings from before the merge (connector, conversion). */
  readonly warnings?: readonly string[];
}

export interface IngestResult {
  readonly runId: string;
  readonly counts: RunCounts;
  readonly warnings: readonly string[];
  readonly modelVersion: number;
  readonly overlayJobs: readonly string[];
}

export async function ingestBatch(ctx: AppContext, input: IngestInput): Promise<IngestResult> {
  const { source } = input;
  const log = ctx.log.child({ sourceId: source.id, source: source.slug, trigger: input.trigger });
  log.info('ingest.start', { entities: input.batch.entities.length, relations: input.batch.relations.length, partial: input.batch.partial ?? false });
  const warnings = [...(input.warnings ?? [])];
  if (input.batch.changes?.length) await keepHistory(ctx, source.org_id, source.slug, input.batch.observed, input.batch.changes);
  let batch: Batch = input.batch.source === source.slug ? input.batch : { ...input.batch, source: source.slug };
  if (input.batch.source !== source.slug) log.debug('ingest.source.renamed', { from: input.batch.source, to: source.slug });
  const mapping = await activeMapping(ctx.db, source);
  if (mapping) {
    const mapped = applyMapping(batch, mapping.mapping, log);
    batch = mapped.batch;
    warnings.push(...mapped.warnings);
    log.info('ingest.mapped', { mappingId: mapping.row.id, mapping: mapping.row.name, entities: batch.entities.length, warnings: mapped.warnings.length });
  } else log.debug('ingest.unmapped', { reason: 'no mapping for this source' });
  const merged = await updateObservedModel(ctx.db, source, batch, (previous) => mergeObserved(previous, batch, log, { retainMissingDays: ctx.config.OBSERVED_RETENTION_DAYS }));
  if (merged.stale !== undefined) {
    warnings.push(`batch is stale and changed nothing: ${merged.stale}`);
    const runId = randomId();
    const counts: RunCounts = { entities: batch.entities.length, relations: batch.relations.length, appeared: 0, vanished: 0, returned: 0, factChanges: 0, documentsOverlaid: 0 };
    await recordRun(ctx.db, { id: runId, orgId: source.org_id, source_id: source.id, job_id: input.jobId, trigger: input.trigger, status: 'ok', started_at: input.startedAt, finished_at: new Date(), counts, warnings, error: null });
    log.warn('ingest.stale', { runId, reason: merged.stale });
    return { runId, counts, warnings, modelVersion: 0, overlayJobs: [] };
  }
  const modelVersion = merged.version;
  log.info('ingest.stored', { modelVersion, rowsWritten: merged.written });
  // Items that point past this connector's own entities (another connector's key, or a fact) can land on any bound document.
  const own = `@${source.slug}:`;
  const wide = Object.values(merged.model.items ?? {}).some((i) => i.source === source.slug && !i.key.includes(own)) || merged.changes.items.closed.some((k) => !k.includes(own));
  const bound = wide ? await documentsBindingAny(ctx.db, source.workspace_id) : await documentsBoundTo(ctx.db, source.workspace_id, source.slug);
  if (wide) log.debug('ingest.items.wide', { documents: bound.length, opened: merged.changes.items.opened.length, closed: merged.changes.items.closed.length });
  const overlayJobs: string[] = [];
  for (const doc of bound) {
    overlayJobs.push(await enqueueDraw(ctx.db, { orgId: source.org_id, kind: 'overlay', documentId: doc.id, payload: { source: source.slug } }));
  }
  const counts: RunCounts = {
    entities: batch.entities.length,
    relations: batch.relations.length,
    appeared: merged.changes.appeared.length,
    vanished: merged.changes.vanished.length,
    returned: merged.changes.returned.length,
    factChanges: merged.changes.facts.length,
    itemsOpen: Object.values(merged.model.items ?? {}).filter((i) => i.source === source.slug).length,
    itemsOpened: merged.changes.items.opened.length,
    itemsClosed: merged.changes.items.closed.length,
    documentsOverlaid: bound.length,
  };
  const runId = randomId();
  await recordRun(ctx.db, { id: runId, orgId: source.org_id, source_id: source.id, job_id: input.jobId, trigger: input.trigger, status: 'ok', started_at: input.startedAt, finished_at: new Date(), counts, warnings, error: null });
  await audit(ctx.db, log, { orgId: source.org_id, who: input.who, what: 'source.run', surface: 'worker', target: `connector:${source.id}`, details: { runId, trigger: input.trigger, status: 'ok', ...counts, warnings: warnings.length, modelVersion } });
  // The organization's scope tree may come from this connector: its copy follows what was just stored.
  if (batch.entities.length) await fillFromCatalog(ctx, source.org_id, source).catch((err: unknown) => log.warn('ingest.scopes.failed', { error: (err as Error).message }));
  // A ticket this connector reads may be a roadmap item's proof: the item moves when the ticket opens or closes.
  const reworked = await reworkSource(ctx.db, source.org_id, source.id);
  if (reworked.length) log.info('ingest.items.reworked', { items: reworked });
  log.info('ingest.end', { runId, modelVersion, ...counts, warnings: warnings.length, overlayJobs: overlayJobs.length });
  return { runId, counts, warnings, modelVersion, overlayJobs };
}

/** Records a run that failed before anything merged, and audits it. */
export async function recordFailedRun(ctx: AppContext, input: Omit<IngestInput, 'batch'>, error: string): Promise<string> {
  const runId = randomId();
  await recordRun(ctx.db, { id: runId, orgId: input.source.org_id, source_id: input.source.id, job_id: input.jobId, trigger: input.trigger, status: 'failed', started_at: input.startedAt, finished_at: new Date(), counts: {}, warnings: input.warnings ?? [], error });
  await audit(ctx.db, ctx.log, { orgId: input.source.org_id, who: input.who, what: 'source.run', surface: 'api', target: `connector:${input.source.id}`, details: { runId, trigger: input.trigger, status: 'failed', error } });
  ctx.log.warn('ingest.failed', { sourceId: input.source.id, runId, trigger: input.trigger, error });
  return runId;
}

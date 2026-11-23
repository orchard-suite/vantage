/**
 * The ingest job: a batch a client pushed, merged into its source's
 * observed model in the worker so the web never does a merge. The push
 * endpoint validated the batch and stored it in the blob store; this job
 * reads it, ingests it, and deletes it.
 */
import type { StoredPush } from '../render/push-task.ts';
import type { AppContext } from '../context.ts';
import { ingestBatch, type IngestResult } from '../sources/ingest.ts';
import { sourceById } from '../sources/repo.ts';
import type { JobLog, JobRow } from './jobs.ts';

export const pushKey = (orgId: string, sourceId: string, id: string): string => `batches/${orgId}/${sourceId}/${id}.json`;

export async function runIngestJob(ctx: AppContext, job: JobRow, jlog: JobLog): Promise<IngestResult | { skipped: string }> {
  const sourceId = String(job.payload['sourceId'] ?? '');
  const key = String(job.payload['key'] ?? '');
  const source = await sourceById(ctx.db, sourceId);
  if (!source) {
    await ctx.blob.delete(key);
    jlog.add('warn', 'connector is gone; batch dropped', { sourceId });
    return { skipped: 'connector not found' };
  }
  const bytes = await ctx.blob.get(key);
  if (!bytes) throw new Error(`pushed batch ${key} is missing from the blob store`);
  const pushed = JSON.parse(new TextDecoder().decode(bytes)) as StoredPush;
  const result = await ingestBatch(ctx, { source, batch: pushed.batch, trigger: 'push', startedAt: new Date(pushed.startedAt), jobId: job.id, who: pushed.who, warnings: pushed.warnings });
  await ctx.blob.delete(key);
  jlog.add('info', 'pushed batch ingested', { runId: result.runId, ...result.counts });
  return result;
}

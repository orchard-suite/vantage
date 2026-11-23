/**
 * Runs one connector instance end to end: validates its config, drains its
 * batches, folds them into one full batch, and logs start, pages, and end
 * with counts. The hub calls this on the instance schedule.
 */
import type { Batch } from './batch.ts';
import { mergeBatches } from './batch.ts';
import type { Connector, ConnectorContext } from './connector.ts';

export interface RunResult {
  readonly batch: Batch;
  /** How many batches the connector yielded before they were folded. */
  readonly slices: number;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export async function runConnector<C>(connector: Connector<C>, ctx: ConnectorContext<unknown>, source: string): Promise<RunResult> {
  const startedAt = ctx.now().toISOString();
  ctx.log.info('connector run start', { connector: connector.id, source, startedAt });
  const parsed = connector.configSchema.safeParse(ctx.config);
  if (!parsed.success) {
    ctx.log.error('connector config invalid', { connector: connector.id, source, issues: parsed.error.issues });
    throw new Error(`connector ${connector.id} config invalid: ${parsed.error.message}`);
  }
  const typed: ConnectorContext<C> = { ...ctx, config: parsed.data };
  const slices: Batch[] = [];
  let entities = 0;
  let relations = 0;
  for await (const batch of connector.discover(typed)) {
    const withSource: Batch = { ...batch, source };
    slices.push(withSource);
    entities += batch.entities.length;
    relations += batch.relations.length;
    ctx.log.debug('connector slice', { connector: connector.id, source, slice: slices.length, entities: batch.entities.length, relations: batch.relations.length });
  }
  const finishedAt = ctx.now().toISOString();
  const batch: Batch = slices.length ? mergeBatches(slices, finishedAt) : { source, observed: finishedAt, entities: [], relations: [] };
  ctx.log.info('connector run end', {
    connector: connector.id,
    source,
    slices: slices.length,
    entities: batch.entities.length,
    relations: batch.relations.length,
    yieldedEntities: entities,
    yieldedRelations: relations,
    finishedAt,
  });
  return { batch, slices: slices.length, startedAt, finishedAt };
}

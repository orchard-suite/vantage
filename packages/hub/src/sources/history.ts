/**
 * A repository's recent history, as the last connector that read it
 * reported it: kept whole in the blob store under the repository's name,
 * one per organization, and replaced by every run that reads it again.
 */
import { createHash } from 'node:crypto';
import type { Changes } from '@vantage/connectors';
import type { AppContext } from '../context.ts';

export interface History extends Changes {
  /** When the connector read it. */
  readonly observed: string;
  /** The connector that read it. */
  readonly source: string;
}

/** A repository's name holds slashes and a port's colon, so its history is filed under a hash of the name. */
const key = (orgId: string, repository: string): string => `repositories/${orgId}/${createHash('sha256').update(repository).digest('hex')}.json`;

export async function keepHistory(ctx: Pick<AppContext, 'blob' | 'log'>, orgId: string, source: string, observed: string, changes: readonly Changes[]): Promise<void> {
  for (const c of changes) {
    const h: History = { ...c, observed, source };
    await ctx.blob.put(key(orgId, c.repository), new TextEncoder().encode(JSON.stringify(h)), 'application/json');
    ctx.log.info('history.kept', { orgId, source, repository: c.repository, branch: c.branch, head: c.head, commits: c.commits.length });
  }
}

export async function readHistory(ctx: Pick<AppContext, 'blob'>, orgId: string, repository: string): Promise<History | undefined> {
  const bytes = await ctx.blob.get(key(orgId, repository));
  return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as History) : undefined;
}

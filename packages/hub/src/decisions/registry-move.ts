/**
 * Moving a registry to another workspace: a program that gets its own
 * workspace takes its decisions with it. The registry keeps its prefix, so
 * every citation, alias, and link to its records still resolves; a
 * record's page is read from the workspace that holds its registry, and an
 * old link to it is sent there. Both workspaces' activity records the move.
 */
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { requireWorkspace } from '../authz.ts';
import { audit } from '../audit.ts';
import { requireRegistry } from './read.ts';

export async function moveRegistry(ctx: AppContext, p: Principal, who: string, prefix: string, toSlug: string): Promise<{ prefix: string; from: string; to: string; records: number }> {
  const { row, workspace } = await requireRegistry(ctx, p, prefix, 'author');
  const to = await requireWorkspace(ctx.db, p, toSlug, 'author');
  const records = Number((await ctx.db.query<{ n: number }>('select count(*)::int as n from decisions where registry_id = $1', [row.id]))[0]!.n);
  if (to.id === row.workspace_id) return { prefix: row.prefix, from: workspace, to: to.slug, records };
  await ctx.db.transaction(async (tx) => {
    await tx.query('update decision_registries set workspace_id = $2 where id = $1', [row.id, to.id]);
    const details = { registryId: row.id, prefix: row.prefix, from: row.workspace_id, to: to.id, records };
    await audit(tx, ctx.log, { orgId: p.orgId, who, what: 'registry.move', surface: p.surface, target: `workspace:${row.workspace_id}`, details });
    await audit(tx, ctx.log, { orgId: p.orgId, who, what: 'registry.move', surface: p.surface, target: `workspace:${to.id}`, details });
  });
  ctx.log.info('registry.moved', { registryId: row.id, prefix: row.prefix, from: row.workspace_id, to: to.id, by: p.userId });
  return { prefix: row.prefix, from: workspace, to: to.slug, records };
}

/** The scope tree as names, indented by depth, with each scope's workspaces: what `vantage_outline scopes` answers. */
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { memberWorkspaces } from '../authz.ts';
import { lineage } from './repo.ts';
import { scopesState, scopesText, scopesVersion, SCOPES } from './text.ts';

export async function scopesOutline(ctx: AppContext, p: Principal): Promise<string[]> {
  const s = await scopesState(ctx, p);
  const text = scopesText(s);
  const from = s.setting.source === 'catalog' ? `read from the catalog (${s.setting.catalog.connector}); edits to the tree are refused` : 'kept in the hub';
  const lines = [`${SCOPES}: ${s.scopes.length} scope${s.scopes.length === 1 ? '' : 's'}, ${from}  version ${await scopesVersion(text)}  ${text.length.toLocaleString('en-US')} chars`];
  const depth = new Map<string, number>();
  const byScope = new Map<string, string[]>();
  for (const [slug, scope] of s.workspaces) byScope.set(scope, [...(byScope.get(scope) ?? []), slug]);
  for (const x of s.scopes) {
    const d = x.parent !== undefined ? (depth.get(x.parent) ?? -1) + 1 : 0;
    depth.set(x.id, d);
    const extra = [x.steward ? `steward ${x.steward}` : '', x.facets.length ? `facets ${x.facets.join(', ')}` : '', byScope.has(x.id) ? `workspaces ${byScope.get(x.id)!.join(', ')}` : ''].filter(Boolean);
    lines.push(`${'  '.repeat(d + 1)}${x.id}  ${x.name}  ${x.kind}${extra.length ? `  ${extra.join('; ')}` : ''}`);
  }
  const unscoped = (await memberWorkspaces(ctx.db, p)).filter((w) => !s.workspaces.has(w.slug)).length;
  lines.push(`${unscoped} workspace${unscoped === 1 ? '' : 's'} name no scope and belong to the whole estate`);
  lines.push(`parts: ${SCOPES}#scopes.<id>, ${SCOPES}#workspaces; a workspace names its scope by a line under workspaces`);
  return lines;
}

/** One workspace's scope and the scopes above it, for its outline; undefined when it names none. */
export async function scopeLine(ctx: AppContext, orgId: string, scope: string | null): Promise<string | undefined> {
  if (scope === null) return undefined;
  const up = await lineage(ctx.db, orgId, scope);
  return `scope: ${up.map((s) => `${s.id} (${s.kind})`).join(' < ') || scope}`;
}

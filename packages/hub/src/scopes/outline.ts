/** The scope tree as names, indented by depth, with each scope's workspaces: what `vantage_outline scopes` answers. */
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { memberWorkspaces } from '../authz.ts';
import { lineage } from './repo.ts';
import { maybe } from '../db/db.ts';
import { bindingName } from '../standards/model.ts';
import { FACET_MAX } from '../decisions/types.ts';
import { scopeSetting } from './setting.ts';
import { profileLine, resolveProfile, type ProfileField } from './profile.ts';
import { scopesState, scopesText, scopesVersion, SCOPES } from './text.ts';

export async function scopesOutline(ctx: AppContext, p: Principal): Promise<string[]> {
  const s = await scopesState(ctx, p);
  const text = scopesText(s);
  const from = s.setting.source === 'catalog' ? `read from the catalog (${s.setting.catalog.connector}); edits to the tree are refused` : 'kept in the hub';
  const lines = [`${SCOPES}: ${s.scopes.length} scope${s.scopes.length === 1 ? '' : 's'}, ${from}  version ${await scopesVersion(text)}  ${text.length.toLocaleString('en-US')} chars`];
  const depth = new Map<string, number>();
  const byScope = new Map<string, string[]>();
  for (const [slug, scope] of s.workspaces) byScope.set(scope, [...(byScope.get(scope) ?? []), slug]);
  const byProgram = new Map<string, string[]>();
  for (const [slug, program] of s.programs) byProgram.set(program, [...(byProgram.get(program) ?? []), slug]);
  for (const x of s.scopes) {
    const d = x.parent !== undefined ? (depth.get(x.parent) ?? -1) + 1 : 0;
    depth.set(x.id, d);
    const extra = [
      x.steward ? `steward ${x.steward}` : '',
      x.facets.length ? `facets ${x.facets.join(', ')}` : '',
      x.refusedFacets?.length ? `refused ${x.refusedFacets.length === 1 ? 'a facet' : `${x.refusedFacets.length} facets`} past ${FACET_MAX} characters, which no line can name: ${x.refusedFacets.join(', ')}` : '',
      byScope.has(x.id) ? `workspaces ${byScope.get(x.id)!.join(', ')}` : '',
      byProgram.has(x.id) ? `served by ${byProgram.get(x.id)!.join(', ')}` : '',
    ].filter(Boolean);
    lines.push(`${'  '.repeat(d + 1)}${x.id}  ${x.name}  ${x.kind}${extra.length ? `  ${extra.join('; ')}` : ''}`);
  }
  const unscoped = (await memberWorkspaces(ctx.db, p)).filter((w) => !s.workspaces.has(w.slug)).length;
  lines.push(`${unscoped} workspace${unscoped === 1 ? '' : 's'} name no scope and belong to the whole estate`);
  lines.push(`parts: ${SCOPES}#scopes.<id>, ${SCOPES}#workspaces; a workspace names its scope by a line under workspaces (slug: <scope>, or slug: { owner: <scope>, program: <scope> })`);
  return lines;
}

/**
 * One workspace's scope and the scopes above it, then its profile, for its
 * outline; then the program it serves and that program's profile, and the
 * edition that binds it. Empty when it names neither.
 */
export async function scopeLines(ctx: AppContext, orgId: string, workspaceId: string, scope: string | null): Promise<string[]> {
  const program = (await maybe<{ program: string | null }>(ctx.db, 'select program from workspaces where id = $1', [workspaceId]))?.program ?? null;
  if (scope === null && program === null) return [];
  const fields = (await scopeSetting(ctx.db, orgId)).profile;
  const out: string[] = [];
  if (scope !== null) {
    const up = await lineage(ctx.db, orgId, scope);
    const profile = resolveProfile(up, fields);
    out.push(`scope: ${up.map((s) => `${s.id} (${s.kind})`).join(' < ') || scope}`, ...(profile.length ? [`profile: ${profileLine(profile)}; vantage_read scopes/${scope}`] : []));
  }
  if (program !== null) {
    const up = await lineage(ctx.db, orgId, program);
    const profile = resolveProfile(up, fields);
    out.push(`serves program: ${program}${up[0] ? ` (${up[0].name})` : ''}; its own lines bind this workspace, its ancestors' do not`, ...(profile.length ? [`program profile: ${profileLine(profile)}; vantage_read scopes/${program}`] : []));
  }
  out.push(`bound by: standard/${bindingName(scope, program)}`);
  return out;
}

/** A workspace's scope as its page shows it: the scope, the scopes above, and the profile. */
export interface WorkspaceScope {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly above: readonly { readonly id: string; readonly name: string }[];
  readonly profile: readonly ProfileField[];
}

export async function workspaceScope(ctx: Pick<AppContext, 'db'>, orgId: string, scope: string | null): Promise<WorkspaceScope | undefined> {
  if (scope === null) return undefined;
  const up = await lineage(ctx.db, orgId, scope);
  if (!up.length) return undefined;
  const names = new Map(up.map((s) => [s.id, s.name]));
  return { id: up[0]!.id, name: up[0]!.name, kind: up[0]!.kind, above: up.slice(1).map((s) => ({ id: s.id, name: s.name })), profile: resolveProfile(up, (await scopeSetting(ctx.db, orgId)).profile).map((f) => (f.from ? { ...f, from: names.get(f.from) ?? f.from } : f)) };
}

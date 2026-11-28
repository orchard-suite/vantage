/**
 * A scope's profile as it reads (VAN-3017): each field the estate names,
 * from the scope itself or, when it leaves one empty, from its nearest
 * ancestor that states it, marked with that scope. One scope's own text
 * at `scopes/<id>` opens with its place in the tree, then a section per
 * field. It is read-only: a field changes in the tree or in the catalog.
 */
import { stringify } from 'yaml';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { HttpError, badRequest } from '../http.ts';
import { sha256 } from '../crypto.ts';
import { lineage, type Scope } from './repo.ts';
import { scopesState } from './text.ts';

export interface ProfileField {
  readonly field: string;
  readonly value: string;
  /** The ancestor it is inherited from; absent when the scope states it. */
  readonly from?: string;
}

/** Each field that has a value at the scope or above, nearest first. */
export function resolveProfile(up: readonly Scope[], fields: readonly string[]): ProfileField[] {
  const me = up[0]?.id;
  return fields.flatMap((field) => {
    const at = up.find((s) => s.profile[field] !== undefined);
    return at ? [{ field, value: at.profile[field]!, ...(at.id !== me ? { from: at.id } : {}) }] : [];
  });
}

/** A field's name as a heading: north_star reads North star. */
export const fieldTitle = (f: string): string => `${f.charAt(0).toUpperCase()}${f.slice(1).replace(/_/g, ' ')}`;

export interface ScopeView {
  readonly scope: Scope;
  /** The scopes above it, nearest first. */
  readonly above: readonly Scope[];
  readonly profile: readonly ProfileField[];
  /** The fields the estate names. */
  readonly fields: readonly string[];
  /** The workspaces the reader may see that name it. */
  readonly workspaces: readonly string[];
}

export async function scopeView(ctx: AppContext, p: Principal, id: string): Promise<ScopeView> {
  const state = await scopesState(ctx, p);
  if (!state.scopes.some((s) => s.id === id)) throw new HttpError(404, `no scope ${id}; vantage_outline scopes lists them`);
  const up = await lineage(ctx.db, p.orgId, id);
  return { scope: up[0]!, above: up.slice(1), profile: resolveProfile(up, state.setting.profile), fields: state.setting.profile, workspaces: [...state.workspaces].filter(([, s]) => s === id).map(([slug]) => slug) };
}

export function scopeText(v: ScopeView): string {
  const s = v.scope;
  const header = {
    scope: s.id,
    name: s.name,
    kind: s.kind,
    ...(v.above.length ? { above: v.above.map((x) => x.id) } : {}),
    ...(s.steward ? { steward: s.steward } : {}),
    ...(s.facets.length ? { facets: [...s.facets] } : {}),
    ...(v.workspaces.length ? { workspaces: [...v.workspaces] } : {}),
    ...(s.url ? { url: s.url } : {}),
    standard: `standard/${s.id}`,
  };
  const body = v.profile.flatMap((f) => ['', `## ${fieldTitle(f.field)}`, '', f.value, ...(f.from ? ['', `Inherited from ${f.from}.`] : [])]);
  if (!body.length) body.push('', `No profile field (${v.fields.join(', ') || 'none named'}) is stated here or above.`);
  return `---\n${stringify(header, { lineWidth: 0 })}---\n${body.join('\n')}\n`;
}

export async function scopeThing(ctx: AppContext, p: Principal, id: string): Promise<{ address: string; version: string; text: string }> {
  const text = scopeText(await scopeView(ctx, p, id));
  return { address: `scopes/${id}`, version: (await sha256(text)).slice(0, 16), text };
}

export async function scopeOutline(ctx: AppContext, p: Principal, id: string): Promise<string[]> {
  const v = await scopeView(ctx, p, id);
  const text = scopeText(v);
  const out = [`scopes/${id}: ${v.scope.name} (${v.scope.kind})${v.above.length ? ` < ${v.above.map((x) => x.id).join(' < ')}` : ''}  ${text.length.toLocaleString('en-US')} chars`];
  out.push(`  profile: ${profileLine(v.profile) || 'nothing stated here or above'}`);
  if (v.workspaces.length) out.push(`  workspaces: ${v.workspaces.join(', ')}`);
  out.push(`parts: ${v.profile.map((f) => `scopes/${id}#${f.field.replace(/_/g, '-')}`).join(', ') || 'none'}; the standard that binds it: standard/${id}`);
  return out;
}

/** The profile as names and sizes, with where each inherited field comes from. */
export function profileLine(profile: readonly ProfileField[]): string {
  return profile.map((f) => `${f.field} (${f.from ? `from ${f.from}` : 'own'}, ${f.value.length} chars)`).join(', ');
}

export function refuseScopeWrite(address: string): never {
  throw badRequest(`${address} is read-only: change the scope in the tree at scopes, or in the catalog when the tree comes from there (guide#scopes-and-owners)`);
}

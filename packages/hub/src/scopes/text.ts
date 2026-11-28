/**
 * The scope tree as text at the address `scopes`: where it comes from, the
 * scopes parents first, and the workspaces that name one. A workspace not
 * listed belongs to the whole estate. One text form, read and written by
 * the five verbs and the REST text routes like every other thing
 * (VAN-5002).
 */
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { memberWorkspaces } from '../authz.ts';
import { sha256 } from '../crypto.ts';
import { badRequest } from '../http.ts';
import { listScopes, workspaceScopes, type Scope } from './repo.ts';
import { CatalogSettingSchema, scopeSetting, type ScopeSetting } from './setting.ts';
import { ESTATE } from '../standards/model.ts';

/** The address of the tree. */
export const SCOPES = 'scopes';

export interface ScopesState {
  readonly setting: ScopeSetting;
  readonly scopes: readonly Scope[];
  /** Workspace slug to the scope it names, for the workspaces the reader may see. */
  readonly workspaces: ReadonlyMap<string, string>;
}

/** The tree as the reader may see it: every scope, and the workspaces of their library that name one. */
export async function scopesState(ctx: AppContext, p: Principal): Promise<ScopesState> {
  const setting = await scopeSetting(ctx.db, p.orgId);
  const [scopes, named, mine] = await Promise.all([listScopes(ctx.db, p.orgId, setting.source), workspaceScopes(ctx.db, p.orgId), memberWorkspaces(ctx.db, p)]);
  const seen = new Set(mine.map((w) => w.slug));
  return { setting, scopes, workspaces: new Map([...named].filter(([slug]) => seen.has(slug))) };
}

export function scopesText(s: ScopesState): string {
  const doc: Record<string, unknown> = { source: s.setting.source };
  if (s.setting.source === 'catalog') doc['catalog'] = s.setting.catalog;
  doc['scopes'] = s.scopes.map((x) => ({ id: x.id, name: x.name, kind: x.kind, ...(x.parent ? { parent: x.parent } : {}), ...(x.steward ? { steward: x.steward } : {}), ...(x.facets.length ? { facets: [...x.facets] } : {}), ...(x.url ? { url: x.url } : {}) }));
  doc['workspaces'] = Object.fromEntries(s.workspaces);
  return stringify(doc, { lineWidth: 0 });
}

export async function scopesVersion(text: string): Promise<string> {
  return (await sha256(text)).slice(0, 16);
}

const ScopeSchema = z
  .object({
    id: z.string().regex(/^\S+$/, 'a scope id has no spaces'),
    name: z.string().min(1),
    kind: z.string().min(1),
    parent: z.string().min(1).optional(),
    steward: z.string().min(1).optional(),
    facets: z.array(z.string().min(1)).default([]),
    url: z.string().optional(),
  })
  .strict();

const TextSchema = z
  .object({
    source: z.enum(['hub', 'catalog']),
    catalog: CatalogSettingSchema.optional(),
    scopes: z.array(ScopeSchema).nullish(),
    workspaces: z.record(z.string(), z.string().min(1)).nullish(),
  })
  .strict();

export function parseScopesText(text: string): ScopesState {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    throw badRequest(`the scope tree is not YAML: ${(err as Error).message}`);
  }
  const r = TextSchema.safeParse(raw);
  if (!r.success) throw badRequest(`the scope tree does not read: ${r.error.issues.map((i) => `${i.path.join('.') || 'text'}: ${i.message}`).join('; ')}`);
  const t = r.data;
  if (t.source === 'catalog' && !t.catalog) throw badRequest('source: catalog needs catalog: { connector: workspace/connector }');
  if (t.source === 'hub' && t.catalog) throw badRequest('catalog: is for source: catalog; a tree kept in the hub names no connector');
  const setting: ScopeSetting = t.source === 'catalog' ? { source: 'catalog', catalog: t.catalog! } : { source: 'hub' };
  const scopes = (t.scopes ?? []).map((x): Scope => ({ id: x.id, name: x.name, kind: x.kind, ...(x.parent ? { parent: x.parent } : {}), ...(x.steward ? { steward: x.steward } : {}), facets: x.facets, ...(x.url ? { url: x.url } : {}) }));
  return { setting, scopes, workspaces: new Map(Object.entries(t.workspaces ?? {})) };
}

/** Refuses a tree an author keeps that does not hold together: an id twice, a parent that is not there, or a loop. */
export function checkTree(scopes: readonly Scope[]): void {
  const byId = new Map<string, Scope>();
  for (const s of scopes) {
    if (byId.has(s.id)) throw badRequest(`scope ${s.id} is in the tree twice`);
    if (s.id === ESTATE) throw badRequest(`the scope id ${ESTATE} names the whole estate (standard/${ESTATE}); give the scope another id`);
    byId.set(s.id, s);
  }
  for (const s of scopes) {
    if (s.parent !== undefined && !byId.has(s.parent)) throw badRequest(`scope ${s.id} names parent ${s.parent}, which is not in the tree`);
    const path = new Set<string>();
    for (let at: Scope | undefined = s; at; at = at.parent ? byId.get(at.parent) : undefined) {
      if (path.has(at.id)) throw badRequest(`scope ${s.id} is its own ancestor; a scope has one parent above it, never below`);
      path.add(at.id);
    }
  }
}

/**
 * A change to the scope tree's text. Where the tree comes from and the
 * tree an author keeps are an admin's to change; a workspace's scope is
 * its owner's. A tree read from the catalog is the catalog's: an edit to
 * it is refused, and the catalog connector fills it again on its next run
 * or when the setting first names it.
 */
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { audit, type Surface } from '../audit.ts';
import { whoOf } from '../decisions/write.ts';
import { isWorkspaceOwner, requireWorkspace } from '../authz.ts';
import { badRequest, forbidden } from '../http.ts';
import { workspaceAt } from '../text/things.ts';
import { fillFromCatalog } from './catalog.ts';
import { adoptScopes, listScopes, replaceScopes, setWorkspaceProgram, setWorkspaceScope, type Scope } from './repo.ts';
import { setScopeSetting } from './setting.ts';
import { checkTree, parseScopesText, scopesState, scopesText, scopesVersion, SCOPES } from './text.ts';
import { rebuildNow } from '../standards/publish.ts';
import { builtText } from '../standards/write.ts';

export interface ScopesWrite {
  readonly status: 'saved' | 'unchanged';
  readonly version: string;
  readonly message: string;
}

const sameTree = (a: readonly Scope[], b: readonly Scope[]): boolean => {
  const key = (xs: readonly Scope[]): string => JSON.stringify([...xs].sort((x, y) => x.id.localeCompare(y.id)).map((s) => [s.id, s.name, s.kind, s.parent ?? null, s.steward ?? null, [...s.facets], s.url ?? null, Object.entries(s.profile).sort(([a], [b]) => a.localeCompare(b))]));
  return key(a) === key(b);
};

function requireAdmin(p: Principal, what: string): void {
  if (!p.admin) throw forbidden(`only an admin changes ${what}`);
}

export async function writeScopes(ctx: AppContext, p: Principal, text: string, surface: Surface): Promise<ScopesWrite> {
  const next = parseScopesText(text);
  const now = await scopesState(ctx, p);
  const said: string[] = [];
  const { profile: wasFields, ...wasSource } = now.setting;
  const { profile: fields, ...source } = next.setting;
  const sourceMoved = JSON.stringify(wasSource) !== JSON.stringify(source);
  const profileMoved = JSON.stringify(wasFields) !== JSON.stringify(fields);
  if (sourceMoved) requireAdmin(p, 'where the scope tree comes from');
  if (profileMoved) requireAdmin(p, 'the profile fields a scope carries');
  if (sourceMoved || profileMoved) await setScopeSetting(ctx.db, p.orgId, next.setting);
  if (profileMoved) said.push(`profile fields: ${fields.join(', ') || 'none'}`);
  if (next.setting.source === 'catalog') {
    // Moving to the catalog replaces the tree with the catalog's; staying there, the copy is not the author's to change.
    if (!sourceMoved && !sameTree(now.scopes, next.scopes)) throw forbidden(`the scope tree comes from the catalog (${next.setting.catalog.connector}); the hub refuses edits to its copy. Change it in the catalog, or set source: hub to keep it here`);
    if (sourceMoved || profileMoved) {
      // The copy is read again, so new profile fields come in with it.
      const filled = await fillFromCatalog(ctx, p.orgId);
      if (sourceMoved) said.push(filled ? `the tree now comes from ${next.setting.catalog.connector}: ${filled.scopes} scopes` : `the tree now comes from ${next.setting.catalog.connector}, which is not there yet; it fills when that connector is made and runs`);
      else if (filled) said.push(`read again from ${next.setting.catalog.connector}: ${filled.scopes} scopes`);
    }
  } else {
    if (sourceMoved) {
      await adoptScopes(ctx.db, p.orgId, 'hub');
      said.push('the tree is kept in the hub now, starting from the catalog copy');
    }
    const held = sourceMoved ? await listScopes(ctx.db, p.orgId, 'hub') : now.scopes;
    if (!sameTree(held, next.scopes)) {
      requireAdmin(p, 'the scope tree');
      checkTree(next.scopes);
      const c = await replaceScopes(ctx.db, p.orgId, 'hub', next.scopes);
      said.push(`scopes: ${c.added} added, ${c.changed} changed, ${c.removed} removed`);
    }
  }
  const ids = new Set((await listScopes(ctx.db, p.orgId, next.setting.source)).map((s) => s.id));
  for (const slug of new Set([...now.workspaces.keys(), ...next.workspaces.keys()])) {
    const want = next.workspaces.get(slug) ?? null;
    if ((now.workspaces.get(slug) ?? null) === want) continue;
    const ws = await workspaceAt(ctx, p, slug, 'author');
    if (!isWorkspaceOwner(p, ws)) throw forbidden(`only the owner of ${slug} or an admin sets its scope`);
    if (want !== null && !ids.has(want)) throw badRequest(`workspace ${slug} names scope ${want}, which is not in the tree`);
    await setWorkspaceScope(ctx.db, p.orgId, ws.id, want);
    said.push(want === null ? `${slug} belongs to the whole estate` : `${slug} belongs to ${want}`);
  }
  for (const slug of new Set([...now.programs.keys(), ...next.programs.keys()])) {
    const want = next.programs.get(slug) ?? null;
    if ((now.programs.get(slug) ?? null) === want) continue;
    const ws = await workspaceAt(ctx, p, slug, 'author');
    if (!isWorkspaceOwner(p, ws)) throw forbidden(`only the owner of ${slug} or an admin sets the program it serves`);
    if (want !== null && !ids.has(want)) throw badRequest(`workspace ${slug} serves program ${want}, which is not in the tree`);
    if (want !== null && want === (next.workspaces.get(slug) ?? null)) throw badRequest(`workspace ${slug} names ${want} as its owner and its program; a workspace serves a program it does not belong to, or names it only as its owner`);
    await setWorkspaceProgram(ctx.db, p.orgId, ws.id, want);
    said.push(want === null ? `${slug} serves no program` : `${slug} serves ${want}`);
  }
  const version = await scopesVersion(scopesText(await scopesState(ctx, p)));
  if (!said.length) return { status: 'unchanged', version, message: `unchanged: ${SCOPES} is still version ${version}` };
  await audit(ctx.db, ctx.log, { orgId: p.orgId, who: whoOf(p), what: 'scopes.write', surface, target: SCOPES, details: { changes: said } });
  // The tree is what a line reaches down: every scope's standard follows it.
  const built = await rebuildNow(ctx, p.orgId, whoOf(p));
  if (built.length) said.push(`built ${builtText(built)}`);
  return { status: 'saved', version, message: `saved ${SCOPES} version ${version}: ${said.join('; ')}` };
}

/** Sets one workspace's scope, for the REST route: the same rule as a line under workspaces. */
export async function setScopeOf(ctx: AppContext, p: Principal, slug: string, scope: string | null, surface: Surface): Promise<ScopesWrite> {
  const now = await scopesState(ctx, p);
  await requireWorkspace(ctx.db, p, slug, 'viewer');
  const workspaces = new Map(now.workspaces);
  if (scope === null) workspaces.delete(slug);
  else workspaces.set(slug, scope);
  return writeScopes(ctx, p, scopesText({ ...now, workspaces }), surface);
}

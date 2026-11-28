/**
 * The scope rows and each workspace's owner scope. A tree is replaced as a
 * whole for one origin: what the new tree lacks is deleted, and a
 * workspace that named a deleted scope belongs to the whole estate again.
 */
import type { Db } from '../db/db.ts';

export type ScopeOrigin = 'catalog' | 'hub';

export interface Scope {
  readonly id: string;
  readonly name: string;
  /** The estate's own word for the level: organization, division, department, team, program. */
  readonly kind: string;
  readonly parent?: string;
  /** The owner the catalog names for it, as the catalog names them. */
  readonly steward?: string;
  /** The tags that let rules from elsewhere reach it. */
  readonly facets: readonly string[];
  /** The scope's page in the catalog. */
  readonly url?: string;
  /** The profile fields it states, by the names the estate's setting gives; an empty one is left out. */
  readonly profile: Readonly<Record<string, string>>;
  /** Facets the catalog gave it that are longer than a line can name; kept aside, never reached. */
  readonly refusedFacets?: readonly string[];
}

interface ScopeRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly parent: string | null;
  readonly steward: string | null;
  readonly facets: string[];
  readonly url: string | null;
  readonly profile: Record<string, string>;
  readonly refused_facets?: string[];
}

const fromRow = (r: ScopeRow): Scope => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  ...(r.parent ? { parent: r.parent } : {}),
  ...(r.steward ? { steward: r.steward } : {}),
  facets: r.facets,
  ...(r.url ? { url: r.url } : {}),
  // Keys in one order, so a copy read back compares equal to the one written.
  profile: Object.fromEntries(Object.entries(r.profile ?? {}).sort(([a], [b]) => a.localeCompare(b))),
  ...(r.refused_facets?.length ? { refusedFacets: r.refused_facets } : {}),
});

/** The tree of one origin, parents before children, then by name. */
export async function listScopes(db: Db, orgId: string, origin: ScopeOrigin): Promise<Scope[]> {
  const rows = await db.query<ScopeRow>('select id, name, kind, parent, steward, facets, url, profile, refused_facets from scopes where org_id = $1 and origin = $2 order by name, id', [orgId, origin]);
  return depthFirst(rows.map(fromRow));
}

/** Parents before their children; a scope whose parent is not in the tree is a root. */
export function depthFirst(scopes: readonly Scope[]): Scope[] {
  const ids = new Set(scopes.map((s) => s.id));
  const children = new Map<string | undefined, Scope[]>();
  for (const s of scopes) {
    const up = s.parent !== undefined && ids.has(s.parent) ? s.parent : undefined;
    children.set(up, [...(children.get(up) ?? []), s]);
  }
  const out: Scope[] = [];
  const seen = new Set<string>();
  const walk = (up: string | undefined): void => {
    for (const s of children.get(up) ?? []) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
      walk(s.id);
    }
  };
  walk(undefined);
  // A cycle has no root to start from; its scopes still answer, after the rest.
  for (const s of scopes) if (!seen.has(s.id)) out.push(s);
  return out;
}

/** Replaces one origin's tree with `next`, in one transaction. */
export async function replaceScopes(db: Db, orgId: string, origin: ScopeOrigin, next: readonly Scope[]): Promise<{ added: number; changed: number; removed: number }> {
  return db.transaction(async (tx) => {
    const before = new Map((await tx.query<ScopeRow>('select id, name, kind, parent, steward, facets, url, profile, refused_facets from scopes where org_id = $1 and origin = $2', [orgId, origin])).map((r) => [r.id, JSON.stringify(fromRow(r))]));
    // Another origin's rows give way: the tree has one source at a time.
    await tx.query('delete from scopes where org_id = $1 and origin <> $2', [orgId, origin]);
    let added = 0;
    let changed = 0;
    for (const s of next) {
      const was = before.get(s.id);
      before.delete(s.id);
      if (was === JSON.stringify(fromRow(toRow(s)))) continue;
      if (was === undefined) added += 1;
      else changed += 1;
      await tx.query(
        `insert into scopes (org_id, id, name, kind, parent, steward, facets, origin, url, profile, refused_facets) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (org_id, id) do update set name = excluded.name, kind = excluded.kind, parent = excluded.parent, steward = excluded.steward, facets = excluded.facets, origin = excluded.origin, url = excluded.url, profile = excluded.profile, refused_facets = excluded.refused_facets, updated_at = now()`,
        [orgId, s.id, s.name, s.kind, s.parent ?? null, s.steward ?? null, [...s.facets], origin, s.url ?? null, JSON.stringify(s.profile), [...(s.refusedFacets ?? [])]],
      );
    }
    const gone = [...before.keys()];
    if (gone.length) await tx.query('delete from scopes where org_id = $1 and id = any($2::text[])', [orgId, gone]);
    return { added, changed, removed: gone.length };
  });
}

/** Moves every row to `origin`: an estate that leaves the catalog starts from its copy. */
export async function adoptScopes(db: Db, orgId: string, origin: ScopeOrigin): Promise<void> {
  await db.query('update scopes set origin = $2, updated_at = now() where org_id = $1', [orgId, origin]);
}

const toRow = (s: Scope): ScopeRow => ({ id: s.id, name: s.name, kind: s.kind, parent: s.parent ?? null, steward: s.steward ?? null, facets: [...s.facets], url: s.url ?? null, profile: { ...s.profile }, refused_facets: [...(s.refusedFacets ?? [])] });

/** Each workspace that names a scope, by slug. */
export async function workspaceScopes(db: Db, orgId: string): Promise<Map<string, string>> {
  const rows = await db.query<{ slug: string; scope: string }>('select slug, scope from workspaces where org_id = $1 and scope is not null order by slug', [orgId]);
  return new Map(rows.map((r) => [r.slug, r.scope]));
}

/** Each workspace that names the program it serves, by slug. */
export async function workspacePrograms(db: Db, orgId: string): Promise<Map<string, string>> {
  const rows = await db.query<{ slug: string; program: string }>('select slug, program from workspaces where org_id = $1 and program is not null order by slug', [orgId]);
  return new Map(rows.map((r) => [r.slug, r.program]));
}

export async function setWorkspaceProgram(db: Db, orgId: string, workspaceId: string, program: string | null): Promise<void> {
  await db.query('update workspaces set program = $3 where org_id = $1 and id = $2', [orgId, workspaceId, program]);
}

export async function setWorkspaceScope(db: Db, orgId: string, workspaceId: string, scope: string | null): Promise<void> {
  await db.query('update workspaces set scope = $3 where org_id = $1 and id = $2', [orgId, workspaceId, scope]);
}

/** A scope and the scopes above it, nearest first: what a workspace in it inherits from. */
export async function lineage(db: Db, orgId: string, id: string): Promise<Scope[]> {
  const all = new Map((await db.query<ScopeRow>('select id, name, kind, parent, steward, facets, url, profile from scopes where org_id = $1', [orgId])).map((r) => [r.id, fromRow(r)]));
  const out: Scope[] = [];
  for (let at = all.get(id); at && !out.some((s) => s.id === at!.id); at = at.parent ? all.get(at.parent) : undefined) out.push(at);
  return out;
}

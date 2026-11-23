/**
 * What the workspace page shows beyond its diagrams: its connectors, its
 * publications, who holds a role in it, and what happened
 * in it lately (from the audit log).
 */
import type { Db } from '../db/db.ts';
import type { AccessibleWorkspace } from '../authz.ts';
import type { AppContext } from '../context.ts';
import { workspaceConnectors, type SourceRow } from '../sources/repo.ts';
import { nextRunAt, pendingRuns, runRefusal } from '../sources/runs.ts';
import { listPublications, type PublicationRow } from '../publishing/repo.ts';

export interface Member {
  /** The grant behind it; the owner of a personal space has none and cannot be removed. */
  readonly grant?: string;
  /** The user, team or org id the grant names. */
  readonly subject?: string;
  readonly kind: 'user' | 'team' | 'org';
  readonly name: string;
  readonly detail: string;
  readonly role: 'viewer' | 'author';
}

export interface WorkspaceSource {
  readonly source: SourceRow;
  /** Diagrams in this workspace whose head version reads the connector. */
  readonly bound: number;
  /** A run of it waiting or running in the shared pool. */
  readonly pending?: 'queued' | 'running';
  /** When the hub runs it next in the pool; null when it runs on a runner of its own. */
  readonly next: Date | null;
  /** Why it cannot be run from here now, or undefined when an author may. */
  readonly runRefused?: string;
}

export interface WorkspacePublication {
  readonly publication: PublicationRow;
  readonly documentName: string;
}

export interface Activity {
  readonly at: Date;
  readonly who: string;
  readonly what: string;
  /** The diagram, publication or connector it touched, by name, when there is one. */
  readonly subject: string | null;
}

export async function workspaceMembers(db: Db, ws: AccessibleWorkspace): Promise<Member[]> {
  const rows = await db.query<{ grant_id: string; subject_id: string; kind: Member['kind']; role: Member['role']; name: string | null; detail: string | null }>(
    `select g.id as grant_id, g.subject_id, g.subject_kind as kind, g.role,
            coalesce(u.display_name, u.subject, t.name, o.name) as name,
            coalesce(u.email, t.slug, o.id) as detail
       from grants g
       left join users u on g.subject_kind = 'user' and u.id = g.subject_id
       left join teams t on g.subject_kind = 'team' and t.id = g.subject_id
       left join orgs o on g.subject_kind = 'org' and o.id = g.subject_id
      where g.workspace_id = $1
      order by (g.role = 'author') desc, g.subject_kind desc, name`,
    [ws.id],
  );
  const members: Member[] = rows.map((r) => ({ grant: r.grant_id, subject: r.subject_id, kind: r.kind, role: r.role, name: r.name ?? '(unknown)', detail: r.detail ?? '' }));
  if (ws.kind === 'personal' && ws.owner_user_id) {
    const owner = await db.query<{ name: string | null; email: string | null }>('select coalesce(display_name, subject) as name, email from users where id = $1', [ws.owner_user_id]);
    if (owner[0]) members.unshift({ kind: 'user', role: 'author', name: owner[0].name ?? 'Owner', detail: owner[0].email ?? 'owner' });
  }
  return members;
}

export async function workspaceSources(ctx: Pick<AppContext, 'db' | 'connectors' | 'config'>, ws: AccessibleWorkspace, now = new Date()): Promise<WorkspaceSource[]> {
  const sources = await workspaceConnectors(ctx.db, ws.id);
  if (!sources.length) return [];
  const docs = await ctx.db.query<{ bind_sources: string[] | null }>('select bind_sources from documents where workspace_id = $1', [ws.id]);
  const pending = await pendingRuns(ctx.db, sources.map((s) => s.id));
  return sources.map((source) => {
    const p = pending.get(source.id);
    const refused = runRefusal(source, ctx);
    return { source, bound: docs.filter((d) => (d.bind_sources ?? []).includes(source.slug)).length, next: nextRunAt(source, now), ...(p ? { pending: p } : {}), ...(refused ? { runRefused: refused } : {}) };
  });
}

export async function workspacePublications(db: Db, ws: AccessibleWorkspace): Promise<WorkspacePublication[]> {
  const pubs = await listPublications(db, ws.id);
  if (!pubs.length) return [];
  const names = await db.query<{ id: string; name: string }>('select id, name from documents where workspace_id = $1', [ws.id]);
  const byId = new Map(names.map((n) => [n.id, n.name]));
  return pubs.map((publication) => ({ publication, documentName: byId.get(publication.document_id) ?? 'a deleted diagram' }));
}

/** Audit lines about the workspace, its diagrams and its publications, newest first; who is a person's name where we know it. */
export async function workspaceActivity(db: Db, ws: AccessibleWorkspace, limit = 40): Promise<Activity[]> {
  const rows = await db.query<{ at: Date; who: string; what: string; subject: string | null; person: string | null }>(
    `select a.at, a.who, a.what,
            coalesce(d.name, p.name, a.details->>'ref', a.details->>'name') as subject,
            coalesce(u.display_name, u.subject) as person
       from audit a
       left join documents d on a.target = 'document:' || d.id
       left join publications p on a.target = 'publication:' || p.id
       left join decisions dc on a.target = 'decision:' || dc.id
       left join decision_registries dr on dr.id = dc.registry_id
       left join users u on u.id = split_part(a.who, ' ', 1)
      where a.org_id = $1
        and (a.target = $2 or d.workspace_id = $3 or p.workspace_id = $3 or dr.workspace_id = $3)
      order by a.at desc
      limit $4`,
    [ws.org_id, `workspace:${ws.id}`, ws.id, limit],
  );
  return rows.map((r) => ({ at: r.at, who: r.person ?? (r.who.split(' ')[0] || 'Someone'), what: r.what, subject: r.subject }));
}

export interface WorkspaceFolder {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

export async function workspaceFolders(db: Db, ws: AccessibleWorkspace): Promise<WorkspaceFolder[]> {
  const rows = await db.query<{ id: string; name: string; n: string }>('select f.id, f.name, count(d.id)::text as n from folders f left join documents d on d.folder_id = f.id where f.workspace_id = $1 group by f.id order by lower(f.name)', [ws.id]);
  return rows.map((r) => ({ id: r.id, name: r.name, count: Number(r.n) }));
}

export interface PendingInvite {
  readonly id: string;
  readonly email: string;
  readonly role: 'viewer' | 'author';
  readonly at: Date;
}

export async function workspaceInvites(db: Db, ws: AccessibleWorkspace): Promise<PendingInvite[]> {
  const rows = await db.query<{ id: string; email: string; role: PendingInvite['role']; created_at: Date }>('select id, email, role, created_at from invites where workspace_id = $1 and accepted_at is null order by created_at desc', [ws.id]);
  return rows.map((r) => ({ id: r.id, email: r.email, role: r.role, at: r.created_at }));
}

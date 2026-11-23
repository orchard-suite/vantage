/**
 * Authorization: org admin reaches everything; otherwise a workspace role
 * comes from ownership or a grant to the person, one of their teams, or
 * the organization. What a person reaches and what is theirs differ only
 * for admins: their library (sidebar, home, search, lists) holds the
 * workspaces they own or were shared, and the admin console holds the
 * rest. Automation tokens are pinned to one workspace.
 * TEAM_WORKSPACES decides who may make team workspaces. Deleting a
 * diagram takes the author role and the workspace's delete rule.
 */
import type { Db } from './db/db.ts';
import { maybe } from './db/db.ts';
import type { Principal, Role } from './auth/principal.ts';
import type { Config } from './config.ts';
import { forbidden, notFound, unauthorized } from './http.ts';

export interface WorkspaceRow {
  readonly id: string;
  readonly org_id: string;
  readonly kind: 'personal' | 'team';
  readonly name: string;
  readonly slug: string;
  readonly owner_user_id: string | null;
  readonly settings: Record<string, unknown>;
  readonly disabled_at: Date | null;
  readonly purge_after: Date | null;
  readonly created_at: Date;
}

export interface AccessibleWorkspace extends WorkspaceRow {
  readonly role: Role;
}

const RANK: Record<Role, number> = { viewer: 1, author: 2 };

function cap(role: Role, p: Principal): Role | undefined {
  const scope = p.token?.scope;
  if (p.token?.kind === 'automation') {
    if (!scope?.role) return undefined;
    return RANK[scope.role] < RANK[role] ? scope.role : role;
  }
  return role;
}

/**
 * Every workspace the principal may open, with the strongest role it holds there: for an org
 * admin, every workspace in the organization. Use it to decide access, never to fill a list.
 */
export async function accessibleWorkspaces(db: Db, p: Principal, opts: { includeDisabled?: boolean } = {}): Promise<AccessibleWorkspace[]> {
  return listWorkspaces(db, p, { includeDisabled: opts.includeDisabled ?? false, reach: p.admin });
}

/**
 * The principal's own library: the workspaces they own or were shared, by name, team, or the
 * whole organization. The same for an admin as for anyone; the rest is the admin console's.
 */
export async function memberWorkspaces(db: Db, p: Principal): Promise<AccessibleWorkspace[]> {
  return listWorkspaces(db, p, { includeDisabled: false, reach: false });
}

async function listWorkspaces(db: Db, p: Principal, opts: { includeDisabled: boolean; reach: boolean }): Promise<AccessibleWorkspace[]> {
  if (p.connector) return [];
  const disabled = opts.includeDisabled ? '' : 'and w.disabled_at is null';
  const rows = opts.reach
    ? await db.query<WorkspaceRow & { rank: number }>(`select w.*, 2 as rank from workspaces w where w.org_id = $1 ${disabled} order by w.kind desc, w.name`, [p.orgId])
    : await db.query<WorkspaceRow & { rank: number }>(
        `select w.*, max(case when w.owner_user_id = $2 or g.role = 'author' then 2 when g.role = 'viewer' then 1 else 0 end) as rank
           from workspaces w
           left join grants g on g.workspace_id = w.id and (
             (g.subject_kind = 'org' and g.subject_id = w.org_id)
             or (g.subject_kind = 'user' and g.subject_id = $2)
             or (g.subject_kind = 'team' and g.subject_id = any($3::text[]))
           )
          where w.org_id = $1 ${disabled}
          group by w.id
         having max(case when w.owner_user_id = $2 or g.role = 'author' then 2 when g.role = 'viewer' then 1 else 0 end) > 0
          order by w.kind desc, w.name`,
        [p.orgId, p.userId, [...p.teamIds]],
      );
  const out: AccessibleWorkspace[] = [];
  for (const { rank, ...r } of rows) {
    if (p.token?.kind === 'automation' && p.token.scope.workspaceId !== r.id) continue;
    // An admin holds author everywhere, also in a workspace that shares only viewer with them.
    const role = cap(Number(rank) >= 2 || p.admin ? 'author' : 'viewer', p);
    if (role) out.push({ ...r, role });
  }
  return out;
}

export async function workspaceRole(db: Db, p: Principal, workspaceId: string): Promise<Role | undefined> {
  const all = await accessibleWorkspaces(db, p, { includeDisabled: true });
  return all.find((w) => w.id === workspaceId)?.role;
}

export async function workspaceBySlug(db: Db, orgId: string, slug: string): Promise<WorkspaceRow | undefined> {
  return maybe<WorkspaceRow>(db, 'select * from workspaces where org_id = $1 and slug = $2', [orgId, slug]);
}

/** Throws 401 or 403 or 404 unless the principal holds at least `role` on the workspace. */
export async function requireWorkspace(db: Db, p: Principal | undefined, slug: string, role: Role): Promise<AccessibleWorkspace> {
  if (!p) throw unauthorized();
  const ws = await workspaceBySlug(db, p.orgId, slug);
  if (!ws) throw notFound('workspace');
  const held = await workspaceRole(db, p, ws.id);
  if (!held) throw notFound('workspace');
  if (RANK[held] < RANK[role]) throw forbidden(`${role} role required`);
  return { ...ws, role: held };
}

/** Like requireWorkspace, for a workspace the caller reached through a document id. */
export async function requireWorkspaceById(db: Db, p: Principal, workspaceId: string, role: Role): Promise<AccessibleWorkspace> {
  const all = await accessibleWorkspaces(db, p, { includeDisabled: true });
  const ws = all.find((w) => w.id === workspaceId);
  if (!ws) throw notFound('workspace');
  if (RANK[ws.role] < RANK[role]) throw forbidden(`${role} role required`);
  return ws;
}

/**
 * Who may delete a diagram in a workspace, beside org admins and the
 * workspace owner, who always may: every author, the author who made the
 * diagram, or no one else.
 */
export const DELETE_RULES = ['authors', 'makers', 'owner'] as const;
export type DeleteRule = (typeof DELETE_RULES)[number];

export function deleteRule(ws: Pick<WorkspaceRow, 'settings'>): DeleteRule {
  const v = ws.settings['deleteDiagrams'];
  return DELETE_RULES.find((r) => r === v) ?? 'makers';
}

/** The workspace owner or an org admin: the people who set the workspace's rules. */
export function isWorkspaceOwner(p: Pick<Principal, 'userId' | 'admin'>, ws: Pick<WorkspaceRow, 'owner_user_id'>): boolean {
  return p.admin || ws.owner_user_id === p.userId;
}

/** Whether the principal may delete a diagram made by `createdBy` in a workspace it holds `ws.role` in. */
export function mayDeleteDocument(p: Pick<Principal, 'userId' | 'admin'>, ws: Pick<AccessibleWorkspace, 'role' | 'owner_user_id' | 'settings'>, createdBy: string | null): boolean {
  if (ws.role !== 'author') return false;
  if (isWorkspaceOwner(p, ws)) return true;
  const rule = deleteRule(ws);
  return rule === 'authors' || (rule === 'makers' && createdBy === p.userId);
}

/** Throws 403 unless the principal may delete the diagram. */
export function requireDelete(p: Principal, ws: AccessibleWorkspace, createdBy: string | null): void {
  if (mayDeleteDocument(p, ws, createdBy)) return;
  throw forbidden(deleteRule(ws) === 'owner' ? 'only the workspace owner and org admins may delete diagrams here' : 'only the person who made this diagram, the workspace owner, and org admins may delete it');
}

/** Whether the principal may make a team workspace: anyone signed in when TEAM_WORKSPACES is everyone; otherwise admins and the people an admin lets. */
export async function mayCreateTeamWorkspace(db: Db, policy: Config['TEAM_WORKSPACES'], p: Principal): Promise<boolean> {
  if (policy === 'everyone' || p.admin) return true;
  const row = await maybe<{ can_create_workspaces: boolean }>(db, 'select can_create_workspaces from users where id = $1 and disabled_at is null', [p.userId]);
  return row?.can_create_workspaces ?? false;
}

export function requireAdmin(p: Principal | undefined): Principal {
  if (!p) throw unauthorized();
  if (!p.admin) throw forbidden('org admin required');
  return p;
}

export function requireUser(p: Principal | undefined): Principal {
  if (!p) throw unauthorized();
  if (p.connector) throw forbidden('a connector may only read its settings and push');
  return p;
}

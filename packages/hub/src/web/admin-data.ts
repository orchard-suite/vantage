/**
 * What the admin console reads: every workspace with what it holds on disk
 * and who can reach it, every person with what they own and where they are a
 * member, one workspace in full, diagrams found by name, and what revisions
 * spent and may spend.
 *
 * Disk is the bytes the hub keeps for a workspace, by kind: rendered
 * pictures (the artifacts of every version kept), versions (the YAML and its
 * imports and pins), connector data (what its connectors observed), voice
 * walkthroughs, and the workspace's own icons.
 */
import type { Config } from '../config.ts';
import type { Db } from '../db/db.ts';
import type { RevisionsModel } from './admin-revisions.ts';
import { deleteRule, type DeleteRule } from '../authz.ts';
import { orgLimits, personLimits } from '../revise/limits.ts';
import { monthKey, monthlyTotals, monthStart, parseMonth, usageForMonth } from '../revise/usage.ts';

export const DISK_PARTS = ['renders', 'history', 'observed', 'audio', 'icons'] as const;
export type DiskPart = (typeof DISK_PARTS)[number];
export type Disk = Readonly<Record<DiskPart, number>>;

export type Role = 'viewer' | 'author';

export interface AdminWorkspace {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly kind: 'personal' | 'team';
  readonly ownerId: string | null;
  readonly owner: string | null;
  readonly settings: Record<string, unknown>;
  readonly disabledAt: Date | null;
  readonly purgeAfter: Date | null;
  readonly createdAt: Date;
  /** The newest change to any diagram in it. */
  readonly changedAt: Date | null;
  readonly diagrams: number;
  readonly views: number;
  readonly versions: number;
  /** Grants that share it: people, teams, or the whole organization. */
  readonly grants: number;
  /** People who can open it: the owner and everyone a grant reaches, admins aside. */
  readonly reach: number;
  readonly connectors: number;
  readonly publications: number;
  /** Connectors and publications waiting for an admin. */
  readonly waiting: number;
  readonly disk: Disk;
  readonly bytes: number;
}

export interface AdminPerson {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly admin: boolean;
  readonly workspaceCreator: boolean;
  readonly disabled: boolean;
  readonly createdAt: Date;
  /** Workspaces they own. */
  readonly owns: number;
  /** Diagrams in the workspaces they own. */
  readonly diagrams: number;
  /** Diagrams they made, wherever those are now. */
  readonly made: number;
  /** Workspaces they own none of but a grant lets them into. */
  readonly memberOf: number;
  /** What the workspaces they own hold on disk. */
  readonly disk: Disk;
  readonly bytes: number;
}

/** A grant as a person reads it: who it names, the role, and how many people it reaches. */
export interface AdminGrant {
  readonly id: string;
  readonly role: Role;
  readonly kind: 'user' | 'team' | 'org';
  readonly subjectId: string;
  readonly name: string;
  readonly people: number;
}

export interface AdminDiagram {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly maker: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly views: number;
  /** The mean layout score of its views, when it has been drawn. */
  readonly score: number | null;
  readonly versions: number;
  readonly comments: number;
  readonly openComments: number;
  readonly guestLinks: number;
  readonly recordings: number;
  readonly stars: number;
  readonly publications: number;
  readonly disk: Pick<Disk, 'renders' | 'history' | 'audio'>;
  readonly bytes: number;
}

export interface AdminVersion {
  readonly document: string;
  readonly documentSlug: string;
  readonly author: string | null;
  readonly surface: string;
  readonly message: string;
  readonly at: Date;
}

export interface AdminWorkspaceDetail {
  readonly workspace: AdminWorkspace;
  readonly grants: readonly AdminGrant[];
  readonly deleteRule: DeleteRule;
  readonly diagrams: readonly AdminDiagram[];
  readonly recent: readonly AdminVersion[];
}

/** Where a person may go: a workspace and the role a grant gives them there. */
export interface AdminMembership {
  readonly workspace: AdminWorkspace;
  readonly role: Role;
  /** The grant that lets them in: their own name, a team, or the organization. */
  readonly via: string;
}

export interface Footprint {
  readonly workspaces: readonly AdminWorkspace[];
  readonly people: readonly AdminPerson[];
  /** For each person, the workspaces they reach through a grant and do not own. */
  readonly memberships: ReadonlyMap<string, readonly AdminMembership[]>;
  readonly grants: ReadonlyMap<string, readonly AdminGrant[]>;
}

const ZERO: Disk = { renders: 0, history: 0, observed: 0, audio: 0, icons: 0 };
const total = (d: Partial<Disk>): number => DISK_PARTS.reduce((s, k) => s + (d[k] ?? 0), 0);
export const sumDisk = (all: readonly Disk[]): Disk => Object.fromEntries(DISK_PARTS.map((k) => [k, all.reduce((s, d) => s + d[k], 0)])) as Record<DiskPart, number>;
const ROLE_RANK: Record<Role, number> = { viewer: 0, author: 1 };

/** Bytes per workspace for one kind of thing the hub keeps. */
const DISK_SQL: Record<DiskPart, string> = {
  renders: `select x.workspace_id as id, sum(x.bytes)::bigint as bytes from (
              select distinct d.workspace_id, a.id, a.bytes from documents d join versions v on v.document_id = d.id join artifacts a on a.version_hash = v.hash where d.org_id = $1
            ) x group by x.workspace_id`,
  history: `select d.workspace_id as id, sum(octet_length(v.yaml) + octet_length(v.imports::text) + octet_length(v.pins::text))::bigint as bytes
              from versions v join documents d on d.id = v.document_id where d.org_id = $1 group by d.workspace_id`,
  observed: `select s.workspace_id as id, sum(x.bytes)::bigint as bytes from sources s join (
               select source_id, octet_length(data::text) as bytes from observed_entities
               union all select source_id, octet_length(data::text) from observed_relations
               union all select source_id, octet_length(data::text) from observed_items
             ) x on x.source_id = s.id where s.org_id = $1 group by s.workspace_id`,
  audio: `select d.workspace_id as id, sum(r.size_bytes)::bigint as bytes from recordings r join documents d on d.id = r.document_id where d.org_id = $1 group by d.workspace_id`,
  icons: 'select workspace_id as id, sum(size)::bigint as bytes from workspace_icons where org_id = $1 group by workspace_id',
};

async function diskByWorkspace(db: Db, orgId: string): Promise<Map<string, Disk>> {
  const parts = await Promise.all(DISK_PARTS.map(async (k) => [k, await db.query<{ id: string; bytes: string | number }>(DISK_SQL[k], [orgId])] as const));
  const out = new Map<string, Disk>();
  for (const [k, rows] of parts) for (const r of rows) out.set(r.id, { ...(out.get(r.id) ?? ZERO), [k]: Number(r.bytes) });
  return out;
}

/** Every workspace and person in the organization, with what each holds and who reaches what. */
export async function adminFootprint(db: Db, orgId: string): Promise<Footprint> {
  const [users, teams, members, grantRows, wsRows, disk] = await Promise.all([
    db.query<{ id: string; subject: string; email: string | null; display_name: string | null; is_admin: boolean; can_create_workspaces: boolean; disabled_at: Date | null; created_at: Date; made: number }>(
      `select u.id, u.subject, u.email, u.display_name, u.is_admin, u.can_create_workspaces, u.disabled_at, u.created_at,
              (select count(*) from documents d where d.created_by = u.id)::int as made
         from users u where u.org_id = $1 order by u.disabled_at nulls first, coalesce(u.display_name, u.email, u.subject)`,
      [orgId],
    ),
    db.query<{ id: string; name: string }>('select id, name from teams where org_id = $1', [orgId]),
    db.query<{ team_id: string; user_id: string }>('select team_id, user_id from team_members where org_id = $1', [orgId]),
    db.query<{ id: string; workspace_id: string; role: Role; subject_kind: 'user' | 'team' | 'org'; subject_id: string }>('select id, workspace_id, role, subject_kind, subject_id from grants where org_id = $1 order by created_at', [orgId]),
    db.query<{ id: string; slug: string; name: string; kind: 'personal' | 'team'; owner_user_id: string | null; settings: Record<string, unknown>; disabled_at: Date | null; purge_after: Date | null; created_at: Date; changed_at: Date | null; diagrams: number; views: number; versions: number; connectors: number; publications: number; waiting: number }>(
      `select w.id, w.slug, w.name, w.kind, w.owner_user_id, w.settings, w.disabled_at, w.purge_after, w.created_at,
              (select max(d.updated_at) from documents d where d.workspace_id = w.id) as changed_at,
              (select count(*) from documents d where d.workspace_id = w.id)::int as diagrams,
              (select coalesce(sum((select count(*) from jsonb_object_keys(v.scores))), 0) from documents d join versions v on v.id = d.head_version_id where d.workspace_id = w.id)::int as views,
              (select count(*) from versions v join documents d on d.id = v.document_id where d.workspace_id = w.id)::int as versions,
              (select count(*) from sources s where s.workspace_id = w.id)::int as connectors,
              (select count(*) from publications p where p.workspace_id = w.id)::int as publications,
              ((select count(*) from sources s where s.workspace_id = w.id and s.approval = 'pending') + (select count(*) from publications p where p.workspace_id = w.id and p.approval = 'pending'))::int as waiting
         from workspaces w where w.org_id = $1`,
      [orgId],
    ),
    diskByWorkspace(db, orgId),
  ]);
  const active = users.filter((u) => !u.disabled_at);
  const nameOf = new Map(users.map((u) => [u.id, u.display_name ?? u.email ?? u.subject]));
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const teamPeople = new Map<string, string[]>();
  for (const m of members) teamPeople.set(m.team_id, [...(teamPeople.get(m.team_id) ?? []), m.user_id]);
  const reached = (g: (typeof grantRows)[number]): readonly string[] => (g.subject_kind === 'org' ? active.map((u) => u.id) : g.subject_kind === 'team' ? (teamPeople.get(g.subject_id) ?? []) : [g.subject_id]);

  const grants = new Map<string, AdminGrant[]>();
  // For each person, the best role each workspace gives them and the grant it comes from.
  const access = new Map<string, Map<string, { role: Role; via: string }>>();
  for (const g of grantRows) {
    const who = reached(g);
    const name = g.subject_kind === 'org' ? 'Everyone in the organization' : g.subject_kind === 'team' ? (teamName.get(g.subject_id) ?? 'A team no longer here') : (nameOf.get(g.subject_id) ?? 'Someone no longer here');
    grants.set(g.workspace_id, [...(grants.get(g.workspace_id) ?? []), { id: g.id, role: g.role, kind: g.subject_kind, subjectId: g.subject_id, name, people: who.length }]);
    for (const u of who) {
      const mine = access.get(u) ?? new Map<string, { role: Role; via: string }>();
      const had = mine.get(g.workspace_id);
      if (!had || ROLE_RANK[g.role] > ROLE_RANK[had.role]) mine.set(g.workspace_id, { role: g.role, via: name });
      access.set(u, mine);
    }
  }

  const workspaces: AdminWorkspace[] = wsRows.map((w) => {
    const d = disk.get(w.id) ?? ZERO;
    const people = new Set<string>(w.owner_user_id ? [w.owner_user_id] : []);
    for (const g of grantRows) if (g.workspace_id === w.id) for (const u of reached(g)) people.add(u);
    return {
      id: w.id, slug: w.slug, name: w.name, kind: w.kind, ownerId: w.owner_user_id, owner: w.owner_user_id ? (nameOf.get(w.owner_user_id) ?? null) : null, settings: w.settings,
      disabledAt: w.disabled_at, purgeAfter: w.purge_after, createdAt: w.created_at, changedAt: w.changed_at,
      diagrams: Number(w.diagrams), views: Number(w.views), versions: Number(w.versions), grants: (grants.get(w.id) ?? []).length, reach: people.size,
      connectors: Number(w.connectors), publications: Number(w.publications), waiting: Number(w.waiting), disk: d, bytes: total(d),
    };
  }).sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  const byId = new Map(workspaces.map((w) => [w.id, w]));

  const memberships = new Map<string, AdminMembership[]>();
  const people: AdminPerson[] = users.map((u) => {
    const owned = workspaces.filter((w) => w.ownerId === u.id);
    const mine = [...(access.get(u.id) ?? new Map()).entries()]
      .map(([id, a]) => ({ workspace: byId.get(id), ...a }))
      .filter((m): m is AdminMembership => m.workspace !== undefined && m.workspace.ownerId !== u.id)
      .sort((a, b) => b.workspace.bytes - a.workspace.bytes);
    memberships.set(u.id, mine);
    return {
      id: u.id, name: nameOf.get(u.id)!, email: u.email, admin: u.is_admin, workspaceCreator: u.can_create_workspaces, disabled: u.disabled_at !== null, createdAt: u.created_at,
      owns: owned.length, diagrams: owned.reduce((s, w) => s + w.diagrams, 0), made: Number(u.made), memberOf: mine.length, disk: sumDisk(owned.map((w) => w.disk)), bytes: owned.reduce((s, w) => s + w.bytes, 0),
    };
  });
  return { workspaces, people, memberships, grants };
}

/** One workspace in full: its grants, every diagram with its numbers and bytes, and its latest versions. */
export async function adminWorkspaceDetail(db: Db, fp: Footprint, slug: string): Promise<AdminWorkspaceDetail | undefined> {
  const workspace = fp.workspaces.find((w) => w.slug === slug);
  if (!workspace) return undefined;
  const [docs, recent] = await Promise.all([
    db.query<{ id: string; slug: string; name: string; maker: string | null; created_at: Date; updated_at: Date; views: number; score: number | null; versions: number; comments: number; open_comments: number; guest_links: number; recordings: number; stars: number; publications: number; renders: string | number; history: string | number; audio: string | number }>(
      `select d.id, d.slug, d.name, coalesce(u.display_name, u.email, u.subject) as maker, d.created_at, d.updated_at,
              coalesce((select count(*) from jsonb_object_keys(h.scores)), 0)::int as views,
              (select round(avg((s.value)::text::numeric)) from jsonb_each(h.scores) s where jsonb_typeof(s.value) = 'number')::int as score,
              (select count(*) from versions v where v.document_id = d.id)::int as versions,
              (select count(*) from comments c where c.document_id = d.id)::int as comments,
              (select count(*) from comments c where c.document_id = d.id and c.resolved_at is null)::int as open_comments,
              (select count(*) from guest_links g where g.document_id = d.id and g.revoked_at is null and g.expires_at > now())::int as guest_links,
              (select count(*) from recordings r where r.document_id = d.id)::int as recordings,
              (select count(*) from stars s where s.document_id = d.id)::int as stars,
              (select count(*) from publications p where p.document_id = d.id)::int as publications,
              coalesce((select sum(a.bytes) from (select distinct a.id, a.bytes from versions v join artifacts a on a.version_hash = v.hash where v.document_id = d.id) a), 0)::bigint as renders,
              coalesce((select sum(octet_length(v.yaml) + octet_length(v.imports::text) + octet_length(v.pins::text)) from versions v where v.document_id = d.id), 0)::bigint as history,
              coalesce((select sum(r.size_bytes) from recordings r where r.document_id = d.id), 0)::bigint as audio
         from documents d
         left join users u on u.id = d.created_by
         left join versions h on h.id = d.head_version_id
        where d.workspace_id = $1`,
      [workspace.id],
    ),
    db.query<{ document: string; document_slug: string; author: string | null; surface: string; message: string; created_at: Date }>(
      `select d.name as document, d.slug as document_slug, coalesce(u.display_name, u.email, u.subject) as author, v.surface, v.message, v.created_at
         from versions v join documents d on d.id = v.document_id left join users u on u.id = v.author_user_id
        where d.workspace_id = $1 order by v.created_at desc limit 12`,
      [workspace.id],
    ),
  ]);
  const diagrams: AdminDiagram[] = docs.map((d) => {
    const disk = { renders: Number(d.renders), history: Number(d.history), audio: Number(d.audio) };
    return {
      id: d.id, slug: d.slug, name: d.name, maker: d.maker, createdAt: d.created_at, updatedAt: d.updated_at, views: Number(d.views), score: d.score === null ? null : Number(d.score),
      versions: Number(d.versions), comments: Number(d.comments), openComments: Number(d.open_comments), guestLinks: Number(d.guest_links), recordings: Number(d.recordings), stars: Number(d.stars), publications: Number(d.publications),
      disk, bytes: disk.renders + disk.history + disk.audio,
    };
  }).sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  return {
    workspace,
    grants: fp.grants.get(workspace.id) ?? [],
    deleteRule: deleteRule({ settings: workspace.settings }),
    diagrams,
    recent: recent.map((r) => ({ document: r.document, documentSlug: r.document_slug, author: r.author, surface: r.surface, message: r.message, at: r.created_at })),
  };
}

/** The most diagrams a search lists at once. */
export const ADMIN_DIAGRAM_LIMIT = 100;

export interface FoundDiagram {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly workspaceSlug: string;
  readonly workspaceName: string;
  readonly maker: string | null;
  readonly updatedAt: Date;
}

/** Diagrams in the organization whose name or slug holds the words, most recently changed first. */
export async function findDiagrams(db: Db, orgId: string, q: string): Promise<FoundDiagram[]> {
  const rows = await db.query<{ id: string; slug: string; name: string; workspace_slug: string; workspace_name: string; maker: string | null; updated_at: Date }>(
    `select d.id, d.slug, d.name, w.slug as workspace_slug, w.name as workspace_name, coalesce(u.display_name, u.email, u.subject) as maker, d.updated_at
       from documents d join workspaces w on w.id = d.workspace_id left join users u on u.id = d.created_by
      where d.org_id = $1 and (d.name ilike '%' || $2 || '%' or d.slug ilike '%' || $2 || '%')
      order by d.updated_at desc limit $3`,
    [orgId, q.replace(/[\\%_]/g, (m) => `\\${m}`), ADMIN_DIAGRAM_LIMIT + 1],
  );
  return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, workspaceSlug: r.workspace_slug, workspaceName: r.workspace_name, maker: r.maker, updatedAt: r.updated_at }));
}

/** The Revisions page for the month a YYYY-MM names; this month when it names none or one still to come. */
export async function adminRevisions(db: Db, config: Config, orgId: string, asked: string | undefined, people: readonly AdminPerson[]): Promise<RevisionsModel> {
  const now = monthStart(new Date());
  const picked = asked ? parseMonth(asked) : undefined;
  const month = picked && picked <= now ? picked : now;
  const [use, months, limits, own] = await Promise.all([usageForMonth(db, orgId, month), monthlyTotals(db, orgId, month, 12), orgLimits(db, config, orgId), personLimits(db, orgId)]);
  return { month: monthKey(month), people: use, months, limits, own, everyone: people.filter((p) => !p.disabled).map((p) => ({ id: p.id, name: p.name })) };
}

/**
 * People and teams as the hub knows them. A sign-in upserts the user,
 * creates the personal workspace on first contact, and syncs the identity
 * provider groups to teams. The first person in an organization becomes
 * its admin.
 */
import { renameFor } from '../tracking/roster.ts';
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { randomId } from '../crypto.ts';
import type { Logger } from '../log.ts';
import { acceptInvites } from '../library/invites.ts';
import { slug } from '@vantage/model';

export interface UserRow {
  readonly id: string;
  readonly org_id: string;
  readonly subject: string;
  /** The issuer's id for the person; null until a sign-in that carries one. */
  readonly person_id: string | null;
  readonly email: string | null;
  readonly display_name: string | null;
  readonly is_admin: boolean;
  /** The look they picked; null follows their system. */
  readonly theme: 'light' | 'dark' | null;
  readonly disabled_at: Date | null;
}

export interface SignIn {
  readonly subject: string;
  /** The issuer's id for the person, the same in every app's tokens (OIDC_PERSON_CLAIM); a front door's sign-in carries none. */
  readonly person?: string | undefined;
  readonly email?: string | undefined;
  readonly name?: string | undefined;
  readonly groups?: readonly string[] | undefined;
  /** The OAuth client the person signed in through, when a token names one; recorded on what they change through it. */
  readonly client?: string | undefined;
}

export interface Identity {
  readonly user: UserRow;
  readonly teamIds: readonly string[];
}

export async function ensureUser(db: Db, log: Logger, orgId: string, signIn: SignIn): Promise<Identity> {
  log.debug('identity.start', { subject: signIn.subject, groups: signIn.groups?.length ?? 0 });
  const identity = await db.transaction(async (tx) => {
    let user = await samePerson(tx, log, orgId, signIn);
    const fresh = !user || Boolean(signIn.email && signIn.email !== user.email);
    if (!user) {
      const count = await tx.query<{ n: string }>('select count(*)::text as n from users where org_id = $1', [orgId]);
      const first = Number(count[0]?.n ?? '0') === 0;
      const id = randomId();
      await tx.query('insert into users (id, org_id, subject, person_id, email, display_name, is_admin) values ($1, $2, $3, $4, $5, $6, $7)', [id, orgId, signIn.subject, signIn.person ?? null, signIn.email ?? null, signIn.name ?? null, first]);
      user = (await maybe<UserRow>(tx, 'select * from users where id = $1', [id]))!;
      log.info('identity.user.created', { userId: id, admin: first, reason: first ? 'first user in org' : 'regular' });
      await createPersonalWorkspace(tx, orgId, user, log);
    } else if ((signIn.email && signIn.email !== user.email) || (signIn.name && signIn.name !== user.display_name)) {
      await tx.query('update users set email = coalesce($2, email), display_name = coalesce($3, display_name) where id = $1', [user.id, signIn.email ?? null, signIn.name ?? null]);
      log.debug('identity.user.updated', { userId: user.id });
    }
    // Waiting invites match by address, which only appears or changes here; an existing user is granted when invited.
    if (fresh) await acceptInvites(tx, log, orgId, { id: user.id, email: signIn.email ?? user.email, subject: user.subject });
    // A kind's roster names people by address, so a new address may be named on items already open.
    const address = signIn.email ?? user.email;
    if (fresh && address) await renameFor(tx, orgId, { email: address });
    const teamIds = signIn.groups ? await syncTeams(tx, orgId, user.id, signIn.groups, log) : await memberTeams(tx, user.id);
    return { user, teamIds };
  });
  log.debug('identity.end', { userId: identity.user.id, teams: identity.teamIds.length });
  return identity;
}

/**
 * The user a sign-in is, whichever way they came: by the issuer's id for
 * the person, then by the subject this way of signing in gives. A person
 * the hub knows only from a sign-in that carried no id (a front door, or
 * one before OIDC_PERSON_CLAIM) is found once by their one address, and
 * keeps the id from then on, so a module's token never makes a second user.
 */
async function samePerson(tx: Db, log: Logger, orgId: string, signIn: SignIn): Promise<UserRow | undefined> {
  if (signIn.person) {
    const known = await maybe<UserRow>(tx, 'select * from users where org_id = $1 and person_id = $2', [orgId, signIn.person]);
    if (known) return known;
  }
  const user = await maybe<UserRow>(tx, 'select * from users where org_id = $1 and subject = $2', [orgId, signIn.subject]);
  if (!signIn.person || (user && user.person_id)) return user;
  const found = user ?? (await byAddress(tx, orgId, signIn.email));
  if (!found) return undefined;
  await tx.query('update users set person_id = $2 where id = $1', [found.id, signIn.person]);
  log.info('identity.user.linked', { userId: found.id, by: user ? 'subject' : 'address' });
  return { ...found, person_id: signIn.person };
}

/** The one user with this address and no person id yet; none when nobody or several have it. */
async function byAddress(tx: Db, orgId: string, email: string | undefined): Promise<UserRow | undefined> {
  if (!email) return undefined;
  const rows = await tx.query<UserRow>('select * from users where org_id = $1 and person_id is null and lower(email) = lower($2) limit 2', [orgId, email]);
  return rows.length === 1 ? rows[0] : undefined;
}

async function createPersonalWorkspace(tx: Db, orgId: string, user: UserRow, log: Logger): Promise<void> {
  const base = slug(user.email?.split('@')[0] ?? user.display_name ?? user.subject) || 'me';
  let s = base;
  for (let i = 2; await maybe(tx, 'select 1 as x from workspaces where org_id = $1 and slug = $2', [orgId, s]); i++) s = `${base}-${i}`;
  const id = randomId();
  await tx.query("insert into workspaces (id, org_id, kind, name, slug, owner_user_id) values ($1, $2, 'personal', $3, $4, $5)", [id, orgId, user.display_name ?? user.email ?? user.subject, s, user.id]);
  log.info('identity.workspace.personal.created', { userId: user.id, workspaceId: id, slug: s });
}

export async function memberTeams(db: Db, userId: string): Promise<string[]> {
  return (await db.query<{ team_id: string }>('select team_id from team_members where user_id = $1', [userId])).map((r) => r.team_id);
}

/** Groups from the identity provider become teams keyed by external_group; membership mirrors the claim. */
export async function syncTeams(tx: Db, orgId: string, userId: string, groups: readonly string[], log: Logger): Promise<string[]> {
  const ids: string[] = [];
  for (const group of groups) {
    let team = await maybe<{ id: string }>(tx, 'select id from teams where org_id = $1 and external_group = $2', [orgId, group]);
    if (!team) {
      const id = randomId();
      let s = slug(group) || id;
      for (let i = 2; await maybe(tx, 'select 1 as x from teams where org_id = $1 and slug = $2', [orgId, s]); i++) s = `${slug(group)}-${i}`;
      await tx.query('insert into teams (id, org_id, name, slug, external_group) values ($1, $2, $3, $4, $5)', [id, orgId, group, s, group]);
      team = { id };
      log.info('identity.team.created', { teamId: id, group });
      await renameFor(tx, orgId, { team: s });
    }
    ids.push(team.id);
  }
  const before = await memberTeams(tx, userId);
  const external = new Set((await tx.query<{ id: string }>('select id from teams where org_id = $1 and external_group is not null', [orgId])).map((r) => r.id));
  const removed = before.filter((t) => external.has(t) && !ids.includes(t));
  for (const t of removed) await tx.query('delete from team_members where team_id = $1 and user_id = $2', [t, userId]);
  for (const t of ids) await tx.query('insert into team_members (org_id, team_id, user_id) values ($1, $2, $3) on conflict do nothing', [orgId, t, userId]);
  const after = await memberTeams(tx, userId);
  log.debug('identity.teams.synced', { userId, before: before.length, after: after.length, removed: removed.length });
  return after;
}

export async function userById(db: Db, id: string): Promise<UserRow | undefined> {
  return maybe<UserRow>(db, 'select * from users where id = $1', [id]);
}

/**
 * Invites: access promised to an email address. When someone with that
 * address is already on the hub the invite is a grant at once; otherwise it
 * waits, and their first sign-in with the address turns it into one.
 * Nothing is mailed: the inviter sends the link themselves.
 */
import type { Db } from '../db/db.ts';
import type { Logger } from '../log.ts';
import { randomId } from '../crypto.ts';

export interface InviteRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly email: string;
  readonly role: 'viewer' | 'author';
  readonly invited_by: string | null;
  readonly created_at: Date;
  readonly accepted_at: Date | null;
}

export const normalEmail = (email: string): string => email.trim().toLowerCase();

/** A user in the org whose email (or sign-in subject) is this address. */
export async function userByEmail(db: Db, orgId: string, email: string): Promise<{ id: string } | undefined> {
  const rows = await db.query<{ id: string }>('select id from users where org_id = $1 and (lower(email) = $2 or lower(subject) = $2) order by created_at limit 1', [orgId, normalEmail(email)]);
  return rows[0];
}

export async function grantUser(db: Db, orgId: string, workspaceId: string, userId: string, role: 'viewer' | 'author'): Promise<void> {
  // An invite never lowers a role someone already holds.
  await db.query(
    `insert into grants (id, org_id, workspace_id, role, subject_kind, subject_id) values ($1, $2, $3, $4, 'user', $5)
     on conflict (workspace_id, subject_kind, subject_id) do update set role = case when grants.role = 'author' then 'author' else excluded.role end`,
    [randomId(), orgId, workspaceId, role, userId],
  );
}

/** Turns this user's waiting invites into grants; returns how many. Called inside the sign-in transaction. */
export async function acceptInvites(db: Db, log: Logger, orgId: string, user: { id: string; email: string | null; subject: string }): Promise<number> {
  const addresses = [...new Set([user.email, user.subject].filter((x): x is string => Boolean(x && x.includes('@'))).map(normalEmail))];
  if (!addresses.length) return 0;
  const waiting = await db.query<InviteRow>('select * from invites where org_id = $1 and accepted_at is null and email = any($2::text[])', [orgId, addresses]);
  for (const inv of waiting) {
    await grantUser(db, orgId, inv.workspace_id, user.id, inv.role);
    await db.query('update invites set accepted_at = now() where id = $1', [inv.id]);
  }
  if (waiting.length) log.info('invites.accepted', { userId: user.id, count: waiting.length });
  return waiting.length;
}

/** Who may act for a scope: its steward, as the tree names them (an email, or person:<email>), or an admin. */
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import type { Principal } from '../auth/principal.ts';

export async function actsFor(db: Db, p: Principal, steward: string | undefined): Promise<boolean> {
  if (p.admin) return true;
  if (!steward) return false;
  const email = (await maybe<{ email: string | null }>(db, 'select email from users where id = $1', [p.userId]))?.email?.toLowerCase();
  if (!email) return false;
  const s = steward.toLowerCase();
  return s === email || s.endsWith(`:${email}`);
}

/** A person as a steward's record names them: their email, as the tree names stewards, or their id when they have none. */
export async function personOf(db: Db, p: Principal): Promise<string> {
  return (await maybe<{ email: string | null }>(db, 'select email from users where id = $1', [p.userId]))?.email?.toLowerCase() ?? p.userId;
}

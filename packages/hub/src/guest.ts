/**
 * Guest links: a signed id in the URL, an expiry, an optional passcode,
 * revocation, and an audit line for every open. The signature is checked
 * before the database is asked, so unknown ids cost nothing. GUEST_LINKS
 * false turns them off across the hub: none are made and none open.
 */
import type { Db } from './db/db.ts';
import { maybe } from './db/db.ts';
import { hmac, hmacVerify, randomId, sha256 } from './crypto.ts';
import { audit, type Surface } from './audit.ts';
import type { Logger } from './log.ts';
import { HttpError } from './http.ts';
import type { Config } from './config.ts';

export interface GuestLinkRow {
  readonly id: string;
  readonly org_id: string;
  readonly document_id: string;
  readonly view_id: string | null;
  readonly created_by: string | null;
  readonly expires_at: Date;
  readonly passcode_hash: string | null;
  readonly revoked_at: Date | null;
  readonly opens: number;
  readonly created_at: Date;
}

export interface NewGuestLink {
  readonly orgId: string;
  readonly documentId: string;
  readonly viewId?: string | undefined;
  readonly createdBy: string;
  readonly expiresAt: Date;
  readonly passcode?: string | undefined;
}

export async function createGuestLink(db: Db, log: Logger, secret: string, input: NewGuestLink, surface: Surface): Promise<{ row: GuestLinkRow; token: string }> {
  const id = randomId(12);
  await db.query('insert into guest_links (id, org_id, document_id, view_id, created_by, expires_at, passcode_hash) values ($1, $2, $3, $4, $5, $6, $7)', [
    id,
    input.orgId,
    input.documentId,
    input.viewId ?? null,
    input.createdBy,
    input.expiresAt,
    input.passcode ? await sha256(`${id}:${input.passcode}`) : null,
  ]);
  await audit(db, log, { orgId: input.orgId, who: input.createdBy, what: 'guest_link.create', surface, target: `document:${input.documentId}`, details: { guestLinkId: id, viewId: input.viewId ?? null, expiresAt: input.expiresAt.toISOString(), passcode: Boolean(input.passcode) } });
  const row = (await maybe<GuestLinkRow>(db, 'select * from guest_links where id = $1', [id]))!;
  return { row, token: `${id}.${await hmac(secret, id)}` };
}

/** Whether guest links may be made in a workspace: the hub allows them (GUEST_LINKS) and the workspace has not turned them off. */
export function guestLinksAllowed(config: Pick<Config, 'GUEST_LINKS'>, workspace: { readonly settings: Record<string, unknown> }): boolean {
  return config.GUEST_LINKS && workspace.settings['guestLinks'] !== false;
}

/** Parses and verifies a signed token; returns the row when it is live and the hub allows guest links. */
export async function resolveGuestLink(db: Db, config: Pick<Config, 'GUEST_LINKS' | 'SESSION_SECRET'>, token: string): Promise<GuestLinkRow | undefined> {
  if (!config.GUEST_LINKS) return undefined;
  const [id, sig, extra] = token.split('.');
  if (!id || !sig || extra !== undefined) return undefined;
  if (!(await hmacVerify(config.SESSION_SECRET, id, sig))) return undefined;
  const row = await maybe<GuestLinkRow>(db, 'select * from guest_links where id = $1', [id]);
  if (!row || row.revoked_at || row.expires_at.getTime() < Date.now()) return undefined;
  return row;
}

export async function checkPasscode(row: GuestLinkRow, passcode: string | undefined): Promise<boolean> {
  if (!row.passcode_hash) return true;
  if (!passcode) return false;
  return (await sha256(`${row.id}:${passcode}`)) === row.passcode_hash;
}

/** Records one open: the counter and the audit line. */
export async function recordOpen(db: Db, log: Logger, row: GuestLinkRow, address: string): Promise<void> {
  await db.query('update guest_links set opens = opens + 1 where id = $1', [row.id]);
  await audit(db, log, { orgId: row.org_id, who: `guest:${address}`, what: 'guest_link.open', surface: 'guest', target: `document:${row.document_id}`, details: { guestLinkId: row.id, viewId: row.view_id } });
}

export async function listGuestLinks(db: Db, documentId: string): Promise<GuestLinkRow[]> {
  return db.query<GuestLinkRow>('select * from guest_links where document_id = $1 order by created_at desc', [documentId]);
}

export async function revokeGuestLink(db: Db, log: Logger, orgId: string, documentId: string, id: string, who: string, surface: Surface): Promise<void> {
  const rows = await db.query('update guest_links set revoked_at = now() where org_id = $1 and document_id = $2 and id = $3 and revoked_at is null returning id', [orgId, documentId, id]);
  if (!rows.length) throw new HttpError(404, 'guest link not found');
  await audit(db, log, { orgId, who, what: 'guest_link.revoke', surface, target: `document:${documentId}`, details: { guestLinkId: id } });
}

export function publicGuestLink(row: GuestLinkRow): Record<string, unknown> {
  return { id: row.id, documentId: row.document_id, viewId: row.view_id, expiresAt: row.expires_at, passcode: Boolean(row.passcode_hash), revokedAt: row.revoked_at, opens: row.opens, createdAt: row.created_at };
}

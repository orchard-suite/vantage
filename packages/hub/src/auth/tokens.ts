/**
 * Personal and automation tokens: hashed at rest, named, listed,
 * revocable. The plaintext is returned once, at creation.
 */
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { newToken, randomId, sha256 } from '../crypto.ts';
import type { TokenKind, TokenScope } from './principal.ts';

export interface TokenRow {
  readonly id: string;
  readonly org_id: string;
  readonly user_id: string | null;
  readonly kind: TokenKind;
  readonly scope: TokenScope;
  readonly name: string;
  readonly expires_at: Date | null;
  readonly revoked_at: Date | null;
  readonly last_used_at: Date | null;
  readonly created_at: Date;
  /** The connected app's grant that issued it (auth/oauth.ts); null for a token a person made. */
  readonly grant_id: string | null;
  /** The agent it signs in (auth/agents.ts); null for a token a person made for themselves or a script. */
  readonly agent_id: string | null;
}

export interface NewToken {
  readonly orgId: string;
  readonly userId: string | null;
  readonly kind: TokenKind;
  readonly scope?: TokenScope;
  readonly name: string;
  readonly expiresAt?: Date | null;
  readonly grantId?: string;
  readonly agentId?: string | null;
}

const PREFIX: Record<TokenKind, string> = { personal: 'vpt', automation: 'vat' };

export async function createToken(db: Db, t: NewToken): Promise<{ row: TokenRow; plaintext: string }> {
  const plaintext = newToken(PREFIX[t.kind]);
  const id = randomId();
  await db.query('insert into tokens (id, org_id, user_id, hash, kind, scope, name, expires_at, grant_id, agent_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [
    id,
    t.orgId,
    t.userId,
    await sha256(plaintext),
    t.kind,
    JSON.stringify(t.scope ?? {}),
    t.name,
    t.expiresAt ?? null,
    t.grantId ?? null,
    t.agentId ?? null,
  ]);
  const row = (await maybe<TokenRow>(db, SELECT + ' where id = $1', [id]))!;
  return { row, plaintext };
}

const SELECT = 'select id, org_id, user_id, kind, scope, name, expires_at, revoked_at, last_used_at, created_at, grant_id, agent_id from tokens';

/** The live token for a bearer value, or undefined when unknown, revoked, or expired. */
export async function resolveToken(db: Db, plaintext: string): Promise<TokenRow | undefined> {
  const row = await maybe<TokenRow>(db, SELECT + ' where hash = $1', [await sha256(plaintext)]);
  if (!row || row.revoked_at) return undefined;
  if (row.expires_at && row.expires_at.getTime() < Date.now()) return undefined;
  await noteUse(db, row);
  return row;
}

/**
 * Last use is kept to the minute: an agent or an automation sends one token
 * on many requests at once, and a write per request would queue every one
 * of them behind the same row lock and a disk sync. Each process writes a
 * token's time at most once a minute, and only when the stored time is
 * older, so most requests write nothing.
 */
const USE_EVERY_MS = 60_000;
const lastNoted = new Map<string, number>();

async function noteUse(db: Db, row: TokenRow): Promise<void> {
  const now = Date.now();
  if (now - (lastNoted.get(row.id) ?? 0) < USE_EVERY_MS) return;
  if (row.last_used_at && now - row.last_used_at.getTime() < USE_EVERY_MS) return void lastNoted.set(row.id, row.last_used_at.getTime());
  lastNoted.set(row.id, now);
  if (lastNoted.size > 50_000) lastNoted.clear();
  await db.query("update tokens set last_used_at = now() where id = $1 and (last_used_at is null or last_used_at < now() - interval '1 minute')", [row.id]);
}

export async function listTokens(db: Db, orgId: string, userId: string | null): Promise<TokenRow[]> {
  if (userId === null) return db.query<TokenRow>(SELECT + ' where org_id = $1 order by created_at desc', [orgId]);
  return db.query<TokenRow>(SELECT + ' where org_id = $1 and user_id = $2 order by created_at desc', [orgId, userId]);
}

export async function revokeToken(db: Db, orgId: string, id: string, userId: string | null): Promise<boolean> {
  const rows = userId === null
    ? await db.query('update tokens set revoked_at = now() where org_id = $1 and id = $2 and revoked_at is null returning id', [orgId, id])
    : await db.query('update tokens set revoked_at = now() where org_id = $1 and id = $2 and user_id = $3 and revoked_at is null returning id', [orgId, id, userId]);
  return rows.length > 0;
}

/** What a token row looks like on the API: never the hash. */
export function publicToken(t: TokenRow): Record<string, unknown> {
  return { id: t.id, kind: t.kind, name: t.name, scope: t.scope, expiresAt: t.expires_at, revokedAt: t.revoked_at, lastUsedAt: t.last_used_at, createdAt: t.created_at, connection: t.grant_id, agent: t.agent_id };
}

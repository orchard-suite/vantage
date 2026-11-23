/**
 * The hub as the authorization server for its own /mcp, so an agent that
 * signs people in with OAuth (Claude's custom connectors, any MCP client)
 * needs no registration at an identity provider. A client registers itself
 * (RFC 7591) as a public client; the person approves it once on the hub,
 * behind the hub's own sign-in; the client trades the code and its PKCE
 * verifier for an access token that lasts an hour and a refresh token that
 * rotates on every use and lapses after REFRESH_DAYS unused. The access
 * token is an ordinary personal token tied to the grant, so /mcp checks it
 * like any other, and revoking the grant ends both. VAN-2001 records why.
 */
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { base64url, newToken, randomId, sha256 } from '../crypto.ts';
import { createToken } from './tokens.ts';

export const ACCESS_SECONDS = 3600;
export const REFRESH_DAYS = 30;
const CODE_SECONDS = 600;

export interface OAuthClient {
  readonly id: string;
  readonly name: string;
  readonly redirectUris: readonly string[];
}

/** A redirect a client may register: https anywhere, or http to this machine (desktop apps listen on a loopback port). */
export function allowedRedirect(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]');
}

export async function registerClient(db: Db, orgId: string, name: string, redirectUris: readonly string[]): Promise<OAuthClient> {
  const id = `vac_${randomId(16)}`;
  await db.query('insert into oauth_clients (id, org_id, name, redirect_uris) values ($1, $2, $3, $4)', [id, orgId, name, JSON.stringify(redirectUris)]);
  return { id, name, redirectUris };
}

export async function findClient(db: Db, id: string): Promise<OAuthClient | undefined> {
  const row = await maybe<{ id: string; name: string; redirect_uris: string[] }>(db, 'select id, name, redirect_uris from oauth_clients where id = $1', [id]);
  return row ? { id: row.id, name: row.name, redirectUris: row.redirect_uris } : undefined;
}

/** A one-time code for an approved request, kept only as its hash. */
export async function issueCode(db: Db, a: { clientId: string; userId: string; redirectUri: string; codeChallenge: string }): Promise<string> {
  const code = randomId(32);
  await db.query("insert into oauth_codes (hash, client_id, user_id, redirect_uri, code_challenge, expires_at) values ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval)", [await sha256(code), a.clientId, a.userId, a.redirectUri, a.codeChallenge, String(CODE_SECONDS)]);
  return code;
}

export interface Issued {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly grantId: string;
}

export type TokenResult = { readonly ok: true; readonly issued: Issued } | { readonly ok: false; readonly error: 'invalid_grant' | 'invalid_client'; readonly why: string };

async function s256(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** Mints the grant's access token, replacing the one it issued before. */
async function mintAccess(db: Db, orgId: string, userId: string, grantId: string, clientName: string): Promise<string> {
  await db.query('delete from tokens where grant_id = $1', [grantId]);
  const { plaintext } = await createToken(db, { orgId, userId, kind: 'personal', name: clientName, expiresAt: new Date(Date.now() + ACCESS_SECONDS * 1000), grantId });
  return plaintext;
}

/** The code grant: the code is used once, by the client it was issued to, at the same redirect, with the verifier that matches its challenge. */
export async function exchangeCode(db: Db, a: { code: string; clientId: string; redirectUri: string; codeVerifier: string }): Promise<TokenResult> {
  const rows = await db.query<{ client_id: string; user_id: string; redirect_uri: string; code_challenge: string; expires_at: Date }>('delete from oauth_codes where hash = $1 returning client_id, user_id, redirect_uri, code_challenge, expires_at', [await sha256(a.code)]);
  const row = rows[0];
  if (!row || row.expires_at.getTime() < Date.now()) return { ok: false, error: 'invalid_grant', why: 'code unknown, used, or expired' };
  if (row.client_id !== a.clientId) return { ok: false, error: 'invalid_grant', why: 'code issued to another client' };
  if (row.redirect_uri !== a.redirectUri) return { ok: false, error: 'invalid_grant', why: 'redirect_uri differs from the authorization request' };
  if ((await s256(a.codeVerifier)) !== row.code_challenge) return { ok: false, error: 'invalid_grant', why: 'code_verifier does not match the challenge' };
  const client = await maybe<{ org_id: string; name: string }>(db, 'select org_id, name from oauth_clients where id = $1', [a.clientId]);
  if (!client) return { ok: false, error: 'invalid_client', why: 'client unknown' };
  const grantId = randomId(16);
  const refreshToken = newToken('vrt');
  await db.query("insert into oauth_grants (id, org_id, user_id, client_id, refresh_hash, refresh_expires_at, last_used_at) values ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval, now())", [grantId, client.org_id, row.user_id, a.clientId, await sha256(refreshToken), String(REFRESH_DAYS)]);
  return { ok: true, issued: { accessToken: await mintAccess(db, client.org_id, row.user_id, grantId, client.name), refreshToken, grantId } };
}

/** The refresh grant: the refresh token is spent and a new one takes its place, so a stolen one works once at most. */
export async function refresh(db: Db, a: { refreshToken: string; clientId: string }): Promise<TokenResult> {
  const next = newToken('vrt');
  const rows = await db.query<{ id: string; org_id: string; user_id: string; client_id: string }>(
    `update oauth_grants set refresh_hash = $2, refresh_expires_at = now() + ($3 || ' days')::interval, last_used_at = now()
      where refresh_hash = $1 and revoked_at is null and refresh_expires_at > now() returning id, org_id, user_id, client_id`,
    [await sha256(a.refreshToken), await sha256(next), String(REFRESH_DAYS)],
  );
  const grant = rows[0];
  if (!grant) return { ok: false, error: 'invalid_grant', why: 'refresh token unknown, spent, revoked, or expired' };
  if (grant.client_id !== a.clientId) {
    await revokeGrant(db, grant.org_id, grant.id, null);
    return { ok: false, error: 'invalid_grant', why: 'refresh token presented by another client; the grant is revoked' };
  }
  const user = await maybe<{ disabled_at: Date | null }>(db, 'select disabled_at from users where id = $1', [grant.user_id]);
  if (!user || user.disabled_at) return { ok: false, error: 'invalid_grant', why: 'the person is disabled' };
  const client = (await findClient(db, grant.client_id))!;
  return { ok: true, issued: { accessToken: await mintAccess(db, grant.org_id, grant.user_id, grant.id, client.name), refreshToken: next, grantId: grant.id } };
}

export interface GrantRow {
  readonly id: string;
  readonly client_name: string;
  readonly created_at: Date;
  readonly last_used_at: Date | null;
}

/** The apps a person connected and has not disconnected. */
export async function listGrants(db: Db, userId: string): Promise<GrantRow[]> {
  return db.query<GrantRow>('select g.id, c.name as client_name, g.created_at, g.last_used_at from oauth_grants g join oauth_clients c on c.id = g.client_id where g.user_id = $1 and g.revoked_at is null and g.refresh_expires_at > now() order by g.created_at desc', [userId]);
}

/** Ends a grant and its access token. `userId` null is an admin or the hub itself. */
export async function revokeGrant(db: Db, orgId: string, id: string, userId: string | null): Promise<boolean> {
  const rows = userId === null
    ? await db.query('update oauth_grants set revoked_at = now() where org_id = $1 and id = $2 and revoked_at is null returning id', [orgId, id])
    : await db.query('update oauth_grants set revoked_at = now() where org_id = $1 and id = $2 and user_id = $3 and revoked_at is null returning id', [orgId, id, userId]);
  if (rows.length) await db.query('delete from tokens where grant_id = $1', [id]);
  return rows.length > 0;
}

/** Codes past their time, grants long dead, and clients that registered and were never approved within a day. */
export async function pruneOAuth(db: Db, orgId: string): Promise<number> {
  const codes = await db.query<{ hash: string }>('delete from oauth_codes where expires_at < now() returning hash', []);
  const grants = await db.query<{ id: string }>("delete from oauth_grants where org_id = $1 and (revoked_at < now() - interval '1 day' or refresh_expires_at < now()) returning id", [orgId]);
  const clients = await db.query<{ id: string }>("delete from oauth_clients c where org_id = $1 and created_at < now() - interval '1 day' and not exists (select 1 from oauth_grants g where g.client_id = c.id) returning id", [orgId]);
  return codes.length + grants.length + clients.length;
}

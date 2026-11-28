/**
 * Resolves the principal for a request. Order: bearer token (a Vantage
 * token, or an access token the OIDC issuer signed for this hub), session
 * cookie, trusted proxy headers (proxy mode), the local developer (none
 * mode). Every branch logs the decision at debug level. SIGN_IN_GROUPS is
 * checked where a person signs in: here for the front door, at the OIDC
 * callback for an issuer.
 */
import type { Db } from '../db/db.ts';
import type { Config } from '../config.ts';
import type { Logger } from '../log.ts';
import type { Surface } from '../audit.ts';
import { ensureUser, memberTeams, userById, type Identity, type SignIn, type UserRow } from './identity.ts';
import { openSession, readCookie, SESSION_COOKIE } from './session.ts';
import { resolveToken } from './tokens.ts';
import { decodeJwt } from 'jose';
import { isJwt, type IssuerTokens } from './issuer-token.ts';
import type { ConnectorTokens } from './connector-token.ts';
import type { Principal } from './principal.ts';
import { RUN_HEADER } from '@vantage/mcp';
import { agentById, agentLabel } from './agents.ts';

export const DEFAULT_ORG = 'default';

/** Whether SIGN_IN_GROUPS keeps this person out: it names groups and the sign-in carries none of them. */
export function refusedSignIn(config: Pick<Config, 'SIGN_IN_GROUPS'>, groups: readonly string[] | undefined): boolean {
  if (!config.SIGN_IN_GROUPS.length) return false;
  return !(groups ?? []).some((g) => config.SIGN_IN_GROUPS.includes(g));
}
export const LOCAL_SUBJECT = 'local-developer';

export interface Authenticated {
  readonly principal?: Principal;
  /** The session's CSRF token, when the principal came from a cookie. */
  readonly csrf?: string;
}

export async function authenticate(db: Db, config: Config, log: Logger, req: Request, surface: Surface, issuer?: IssuerTokens, connectors?: ConnectorTokens): Promise<Authenticated> {
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const bearer = auth.slice(7).trim();
    if (isJwt(bearer)) {
      if (connectors && appToken(bearer)) return connectorBearer(log, connectors, bearer);
      if (issuer) return issuerBearer(db, config, log, issuer, bearer, surface);
      log.debug('auth.bearer.rejected', { reason: 'a JWT, and no issuer is configured for it' });
      return {};
    }
    const token = await resolveToken(db, bearer);
    if (!token) {
      log.debug('auth.bearer.rejected', { reason: 'unknown, revoked, or expired' });
      return {};
    }
    const user = token.user_id ? await userById(db, token.user_id) : undefined;
    if (!user || user.disabled_at) {
      log.debug('auth.bearer.rejected', { reason: 'user missing or disabled', tokenId: token.id });
      return {};
    }
    const agent = token.agent_id ? await agentById(db, token.agent_id) : undefined;
    if (agent?.revoked_at) {
      log.debug('auth.bearer.rejected', { reason: 'agent disconnected', tokenId: token.id, agentId: agent.id });
      return {};
    }
    const run = runHeader(req);
    log.debug('auth.bearer', { tokenId: token.id, kind: token.kind, agentId: agent?.id ?? null });
    return {
      principal: {
        userId: user.id,
        orgId: token.org_id,
        subject: user.subject,
        admin: token.kind === 'personal' && user.is_admin,
        teamIds: await memberTeams(db, user.id),
        surface: surface === 'browser' ? 'api' : surface,
        via: 'token',
        token: { id: token.id, kind: token.kind, scope: token.scope },
        ...(agent ? { agent: { id: agent.id, label: agentLabel(agent) } } : {}),
        ...(run ? { run } : {}),
        ...pick(user),
      },
    };
  }

  const session = await openSession(config.SESSION_SECRET, readCookie(req.headers.get('cookie') ?? undefined, SESSION_COOKIE));
  if (session) {
    const user = await userById(db, session.userId);
    if (!user || user.disabled_at) {
      log.debug('auth.session.rejected', { reason: 'user missing or disabled' });
      return {};
    }
    log.debug('auth.session', { userId: user.id });
    return { csrf: session.csrf, principal: { userId: user.id, orgId: user.org_id, subject: user.subject, admin: user.is_admin, teamIds: await memberTeams(db, user.id), surface: 'browser', via: 'session', ...pick(user) } };
  }

  if (config.AUTH_MODE === 'proxy') {
    const subject = req.headers.get('x-forwarded-user');
    if (!subject) {
      log.debug('auth.proxy.missing', { header: 'x-forwarded-user' });
      return {};
    }
    const groups = (req.headers.get('x-forwarded-groups') ?? '').split(',').map((g) => g.trim()).filter(Boolean);
    if (refusedSignIn(config, groups)) {
      log.warn('auth.proxy.refused', { reason: 'not in SIGN_IN_GROUPS', groups: groups.length });
      return {};
    }
    const email = req.headers.get('x-forwarded-email') ?? (subject.includes('@') ? subject : undefined);
    const { user, teamIds } = await knownUser(db, log, DEFAULT_ORG, { subject, email: email ?? undefined, groups });
    if (user.disabled_at) return {};
    log.debug('auth.proxy', { userId: user.id, groups: groups.length });
    return { principal: { userId: user.id, orgId: user.org_id, subject, admin: user.is_admin, teamIds, surface: 'browser', via: 'proxy', ...pick(user) } };
  }

  if (config.AUTH_MODE === 'none') {
    const { user, teamIds } = await knownUser(db, log, DEFAULT_ORG, { subject: LOCAL_SUBJECT, name: 'Local developer' });
    log.debug('auth.none', { userId: user.id });
    return { principal: { userId: user.id, orgId: user.org_id, subject: LOCAL_SUBJECT, admin: true, teamIds, surface: 'browser', via: 'none', ...pick(user) } };
  }

  log.debug('auth.anonymous', { mode: config.AUTH_MODE });
  return {};
}

/** Whether a JWT is an app's own token (no delegated scope), which only a connector presents. Routing only; the verifier checks the signature. */
function appToken(bearer: string): boolean {
  try {
    const claims = decodeJwt(bearer);
    return claims['scp'] === undefined && (claims['idtyp'] === undefined || claims['idtyp'] === 'app');
  } catch {
    return false;
  }
}

/** A connector's OAuth client, signed in by the issuer with its own credentials. It is no person and holds no workspace role. */
async function connectorBearer(log: Logger, connectors: ConnectorTokens, bearer: string): Promise<Authenticated> {
  const verified = await connectors.verify(bearer);
  if ('refused' in verified) {
    log.info('auth.connector_token.refused', { reason: verified.refused });
    return {};
  }
  log.debug('auth.connector_token', { clientId: verified.clientId, pool: verified.pool });
  if (verified.module && !verified.pool) {
    const id = `module-client:${verified.clientId}`;
    return { principal: { userId: id, orgId: DEFAULT_ORG, subject: id, admin: false, teamIds: [], surface: 'api', via: 'connector', module: { clientId: verified.clientId } } };
  }
  const id = `${verified.pool ? 'connector-pool' : 'connector-client'}:${verified.clientId}`;
  return { principal: { userId: id, orgId: DEFAULT_ORG, subject: id, admin: false, teamIds: [], surface: 'api', via: 'connector', connector: { clientId: verified.clientId, ...(verified.pool ? { pool: true as const } : {}) } } };
}

/** A person signed in by the issuer itself, through an agent: the same user a browser sign-in makes, under the same SIGN_IN_GROUPS rule. */
async function issuerBearer(db: Db, config: Config, log: Logger, issuer: IssuerTokens, bearer: string, surface: Surface): Promise<Authenticated> {
  const verified = await issuer.verify(bearer);
  if ('refused' in verified) {
    log.info('auth.issuer_token.refused', { reason: verified.refused });
    return {};
  }
  if (refusedSignIn(config, verified.signIn.groups)) {
    log.warn('auth.issuer_token.refused', { reason: 'not in SIGN_IN_GROUPS', groups: verified.signIn.groups?.length ?? 0 });
    return {};
  }
  const { user, teamIds } = await knownUser(db, log, DEFAULT_ORG, verified.signIn);
  if (user.disabled_at) {
    log.info('auth.issuer_token.refused', { reason: 'user disabled', userId: user.id });
    return {};
  }
  log.debug('auth.issuer_token', { userId: user.id });
  return { principal: { userId: user.id, orgId: user.org_id, subject: user.subject, admin: user.is_admin, teamIds, surface: surface === 'browser' ? 'api' : surface, via: 'issuer', ...(verified.signIn.client ? { client: verified.signIn.client } : {}), ...pick(user) } };
}

/**
 * The person a front door names, from memory when the same sign-in (subject,
 * email, name, groups) was seen in the last IDENTITY_TTL_MS: every request
 * carries the headers, and making sure of the user and its teams is a
 * transaction of several queries on the primary. A change an admin makes
 * (disabling, making admin) reaches a cached sign-in within the TTL.
 */
const IDENTITY_TTL_MS = 30_000;
const identities = new WeakMap<Db, Map<string, { at: number; identity: Identity }>>();

async function knownUser(db: Db, log: Logger, orgId: string, signIn: SignIn): Promise<Identity> {
  let cache = identities.get(db);
  if (!cache) identities.set(db, (cache = new Map()));
  const key = JSON.stringify([orgId, signIn.subject, signIn.person ?? null, signIn.email ?? null, signIn.name ?? null, signIn.groups ?? null]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < IDENTITY_TTL_MS) return hit.identity;
  const identity = await ensureUser(db, log, orgId, signIn);
  if (cache.size > 10_000) cache.clear();
  cache.set(key, { at: Date.now(), identity });
  return identity;
}

/** The run a bearer names: a short id of letters, digits, and dashes, or none. */
function runHeader(req: Request): string | undefined {
  const raw = req.headers.get(RUN_HEADER)?.trim();
  return raw && /^[\w.:-]{1,100}$/.test(raw) ? raw : undefined;
}

/** The person's look, when they picked one. */
function pick(user: UserRow): { theme?: 'light' | 'dark' } {
  return user.theme ? { theme: user.theme } : {};
}

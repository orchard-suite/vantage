/**
 * Access tokens a connector's own OAuth client gets from the issuer with the
 * client credentials grant, accepted as bearers on the connector API. The
 * hub stores no credential for a connector: the issuer vouches for the
 * client, and the hub matches its client id to the connectors registered
 * with it. The token must be signed by the issuer's keys, name the issuer,
 * name this hub as its audience, carry the connector app role, and be an
 * app's token, not a person's (Entra: idtyp app, or no scp). The pool role
 * marks the shared runner pool's own app instead: it leases runs and acts
 * as no connector.
 */
import { createRemoteJWKSet, customFetch, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { Config } from '../config.ts';
import type { Logger } from '../log.ts';

export interface ConnectorTokens {
  /** The audience and role a client asks for, for the runner and the docs. */
  readonly audience: string;
  readonly role: string;
  readonly poolRole: string;
  /** The OAuth client a token stands for and whether it is the pool, or why it was refused. */
  verify(token: string): Promise<{ clientId: string; pool: boolean; module: boolean } | { refused: string }>;
}

export interface ConnectorTokenOptions {
  readonly issuer: string;
  readonly audiences: readonly string[];
  readonly role: string;
  readonly poolRole: string;
  /** The role a module's app carries; absent, no module signs in. */
  readonly moduleRole?: string;
  readonly keys: JWTVerifyGetKey;
}

export function connectorTokensFrom(opts: ConnectorTokenOptions, log: Logger): ConnectorTokens {
  return {
    audience: opts.audiences.find((a) => a.includes('://')) ?? opts.audiences[0]!,
    role: opts.role,
    poolRole: opts.poolRole,
    async verify(token) {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, opts.keys, { issuer: opts.issuer, audience: [...opts.audiences], clockTolerance: 60 }));
      } catch (err) {
        const reason = err instanceof errors.JOSEError ? err.code : 'unverifiable';
        log.debug('auth.connector_token.rejected', { reason });
        return { refused: reason };
      }
      if (payload['scp'] !== undefined || (payload['idtyp'] !== undefined && payload['idtyp'] !== 'app')) return { refused: 'not an app token' };
      const roles = Array.isArray(payload['roles']) ? payload['roles'].filter((r): r is string => typeof r === 'string') : [];
      const pool = roles.includes(opts.poolRole);
      const module = opts.moduleRole !== undefined && roles.includes(opts.moduleRole);
      if (!pool && !module && !roles.includes(opts.role)) return { refused: 'connector role missing' };
      const clientId = [payload['azp'], payload['appid'], payload['client_id']].find((v): v is string => typeof v === 'string' && v.length > 0);
      if (!clientId) return { refused: 'client id missing' };
      return { clientId, pool, module };
    },
  };
}

/** The issuer a connector signs in with: CONNECTOR_ISSUER, else OIDC_ISSUER. Undefined when neither is set. */
export function connectorIssuer(config: Pick<Config, 'CONNECTOR_ISSUER' | 'OIDC_ISSUER'>): string | undefined {
  return (config.CONNECTOR_ISSUER ?? config.OIDC_ISSUER)?.replace(/\/$/, '');
}

/** The audiences a connector's token may name: CONNECTOR_AUDIENCE, else the hub's API audience and client id. */
export function connectorAudiences(config: Pick<Config, 'CONNECTOR_AUDIENCE' | 'OIDC_API_AUDIENCE' | 'OIDC_CLIENT_ID'>): string[] {
  if (config.CONNECTOR_AUDIENCE) return [config.CONNECTOR_AUDIENCE];
  const out: string[] = [];
  if (config.OIDC_API_AUDIENCE) out.push(config.OIDC_API_AUDIENCE);
  if (config.OIDC_CLIENT_ID) out.push(`api://${config.OIDC_CLIENT_ID}`, config.OIDC_CLIENT_ID);
  return out;
}

/**
 * Connector tokens for a hub with an issuer and an audience; undefined otherwise. The keys come
 * from the issuer's discovery document, fetched when first needed and cached by jose.
 */
export async function createConnectorTokens(config: Config, log: Logger, fetchImpl: typeof fetch = fetch): Promise<ConnectorTokens | undefined> {
  const issuer = connectorIssuer(config);
  const audiences = connectorAudiences(config);
  if (!issuer || !audiences.length) {
    log.info('auth.connector_tokens.off', { reason: issuer ? 'no audience: set CONNECTOR_AUDIENCE or OIDC_CLIENT_ID' : 'no issuer: set CONNECTOR_ISSUER or OIDC_ISSUER' });
    return undefined;
  }
  const discovery = (await (await fetchImpl(`${issuer}/.well-known/openid-configuration`)).json()) as { issuer?: string; jwks_uri?: string };
  if (!discovery.jwks_uri || !discovery.issuer) throw new Error(`issuer ${issuer} published no jwks_uri`);
  const keys = createRemoteJWKSet(new URL(discovery.jwks_uri), { [customFetch]: fetchImpl });
  log.info('auth.connector_tokens.ready', { issuer: discovery.issuer, audiences, role: config.CONNECTOR_ROLE, poolRole: config.CONNECTOR_POOL_ROLE });
  return connectorTokensFrom({ issuer: discovery.issuer, audiences, role: config.CONNECTOR_ROLE, poolRole: config.CONNECTOR_POOL_ROLE, moduleRole: config.MODULE_ROLE, keys }, log);
}

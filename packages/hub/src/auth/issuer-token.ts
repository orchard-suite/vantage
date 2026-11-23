/**
 * Access tokens the OIDC issuer signs for this hub, accepted as bearers on
 * every bearer route, so an agent platform that signs a person in with the
 * issuer itself (Microsoft Copilot Studio), or a module acting for the
 * person who used it (docs/decisions/2005), needs no Vantage token. The
 * token must be signed by the issuer's keys, name the issuer, name this hub
 * as its audience, and carry the scope the hub exposes. The person is named
 * by OIDC_PERSON_CLAIM, the id the issuer gives them in every app's tokens,
 * so each client's token reaches the same user (docs/decisions/2006).
 */
import { createRemoteJWKSet, customFetch, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { Config } from '../config.ts';
import type { Logger } from '../log.ts';
import type { SignIn } from './identity.ts';

export interface IssuerTokens {
  /** The sign-in a token stands for, or why it was refused. */
  verify(token: string): Promise<{ signIn: SignIn } | { refused: string }>;
}

export interface IssuerTokenOptions {
  readonly issuer: string;
  /** The hub's audience: the client id and its application URI, either of which the issuer may put in aud. */
  readonly audiences: readonly string[];
  /** The scope name the token's scp must carry (Entra) or its scope (generic issuers). */
  readonly scopeName: string;
  readonly groupsClaim: string;
  /** The claim that names the person the same in every app's tokens ("oid" on Entra). */
  readonly personClaim: string;
  readonly keys: JWTVerifyGetKey;
}

/** Whether a bearer value looks like a JWT rather than a Vantage token (vpt_, vat_, vst_). */
export function isJwt(value: string): boolean {
  return value.split('.').length === 3 && value.startsWith('ey');
}

export function issuerTokensFrom(opts: IssuerTokenOptions, log: Logger): IssuerTokens {
  return {
    async verify(token) {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, opts.keys, { issuer: opts.issuer, audience: [...opts.audiences], clockTolerance: 60 }));
      } catch (err) {
        const reason = err instanceof errors.JOSEError ? err.code : 'unverifiable';
        log.debug('auth.issuer_token.rejected', { reason });
        return { refused: reason };
      }
      const granted = String(payload['scp'] ?? payload['scope'] ?? '').split(' ');
      if (!granted.includes(opts.scopeName)) return { refused: 'scope missing' };
      const text = (k: string): string | undefined => (typeof payload[k] === 'string' && payload[k] ? (payload[k] as string) : undefined);
      const person = text(opts.personClaim);
      if (!person) return { refused: `${opts.personClaim} missing` };
      const groups = payload[opts.groupsClaim];
      return {
        signIn: {
          subject: person,
          person,
          email: text('email') ?? text('preferred_username') ?? text('upn'),
          name: text('name'),
          groups: Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : undefined,
          client: text('azp') ?? text('appid') ?? text('client_id'),
        },
      };
    },
  };
}

/**
 * Issuer tokens for a hub whose OIDC_API_SCOPE and OIDC_ISSUER are set, under oidc or proxy sign-in; undefined otherwise. The keys come
 * from the issuer's discovery document and are fetched when first needed and cached by jose, so a
 * hub whose issuer is briefly unreachable still starts.
 */
export async function createIssuerTokens(config: Config, log: Logger, fetchImpl: typeof fetch = fetch): Promise<IssuerTokens | undefined> {
  if (config.AUTH_MODE === 'none' || !config.OIDC_API_SCOPE || !config.OIDC_ISSUER) return undefined;
  const issuer = config.OIDC_ISSUER.replace(/\/$/, '');
  const discovery = (await (await fetchImpl(`${issuer}/.well-known/openid-configuration`)).json()) as { issuer?: string; jwks_uri?: string };
  if (!discovery.jwks_uri || !discovery.issuer) throw new Error(`issuer ${issuer} published no jwks_uri`);
  const keys = createRemoteJWKSet(new URL(discovery.jwks_uri), { [customFetch]: fetchImpl });
  const id = config.OIDC_CLIENT_ID;
  const audiences = [id, config.OIDC_API_AUDIENCE ?? (id ? `api://${id}` : undefined)].filter((a): a is string => Boolean(a));
  log.info('auth.issuer_tokens.ready', { issuer: discovery.issuer, audiences, scope: config.OIDC_API_SCOPE, personClaim: config.OIDC_PERSON_CLAIM });
  return issuerTokensFrom({ issuer: discovery.issuer, audiences, scopeName: config.OIDC_API_SCOPE, groupsClaim: config.OIDC_GROUPS_CLAIM, personClaim: config.OIDC_PERSON_CLAIM, keys }, log);
}

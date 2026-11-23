/**
 * OIDC authorization code with PKCE through openid-client, the client
 * signing in with a secret or a token file. The flow state
 * (verifier, state, return path) travels in a short-lived sealed cookie,
 * so no server-side state is needed.
 */
import { readFileSync } from 'node:fs';
import * as oidc from 'openid-client';
import { open, seal } from '../crypto.ts';
import type { Config } from '../config.ts';
import type { Logger } from '../log.ts';
import type { SignIn } from './identity.ts';

export interface OidcProvider {
  /** Builds the redirect to the issuer and the sealed flow cookie that must travel with it. */
  begin(returnTo: string): Promise<{ url: string; flowCookie: string }>;
  /**
   * Completes the flow from the callback's query and the flow cookie; returns the sign-in facts. The
   * callback address is the redirect URI built from PUBLIC_URL, never the address the request arrived
   * on: behind a proxy that ends TLS the hub sees http, and the issuer refuses a redirect URI that
   * differs from the one the sign-in began with.
   */
  complete(callbackQuery: string, flowCookie: string | undefined): Promise<{ signIn: SignIn; returnTo: string }>;
}

interface Flow {
  readonly verifier: string;
  readonly state: string;
  readonly returnTo: string;
  readonly exp: number;
}

export async function createOidcProvider(config: Config, log: Logger): Promise<OidcProvider> {
  const issuer = new URL(config.OIDC_ISSUER!);
  log.info('oidc.discovery.start', { issuer: issuer.href });
  const assertion = config.OIDC_CLIENT_ASSERTION_FILE;
  const client = assertion ? await oidc.discovery(issuer, config.OIDC_CLIENT_ID!, undefined, assertionAuth(assertion)) : await oidc.discovery(issuer, config.OIDC_CLIENT_ID!, config.OIDC_CLIENT_SECRET!);
  const redirectUri = `${config.PUBLIC_URL}/auth/callback`;
  log.info('oidc.discovery.end', { issuer: issuer.href, redirectUri, groupsClaim: config.OIDC_GROUPS_CLAIM, clientAuth: assertion ? 'assertion' : 'secret' });
  return oidcProviderFrom(client, config, log, redirectUri);
}

export function oidcProviderFrom(client: oidc.Configuration, config: Config, log: Logger, redirectUri: string): OidcProvider {
  return {
    async begin(returnTo) {
      const verifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      const url = oidc.buildAuthorizationUrl(client, {
        redirect_uri: redirectUri,
        scope: 'openid profile email',
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state,
      });
      const flow: Flow = { verifier, state, returnTo: safeReturn(returnTo), exp: Date.now() + 10 * 60_000 };
      log.debug('oidc.begin', { returnTo: flow.returnTo });
      return { url: url.href, flowCookie: await seal(config.SESSION_SECRET, JSON.stringify(flow)) };
    },
    async complete(callbackQuery, flowCookie) {
      const callbackUrl = new URL(redirectUri);
      callbackUrl.search = callbackQuery;
      const plain = flowCookie ? await open(config.SESSION_SECRET, flowCookie) : undefined;
      if (!plain) throw new Error('sign-in flow cookie missing or invalid');
      const flow = JSON.parse(plain) as Flow;
      if (flow.exp < Date.now()) throw new Error('sign-in flow expired');
      const tokens = await oidc.authorizationCodeGrant(client, callbackUrl, { pkceCodeVerifier: flow.verifier, expectedState: flow.state });
      const claims = tokens.claims();
      if (!claims) throw new Error('issuer returned no id token');
      const groups = claims[config.OIDC_GROUPS_CLAIM];
      const person = claims[config.OIDC_PERSON_CLAIM];
      const signIn: SignIn = {
        subject: claims.sub,
        ...(typeof person === 'string' && person ? { person } : {}),
        email: typeof claims['email'] === 'string' ? claims['email'] : typeof claims['preferred_username'] === 'string' ? claims['preferred_username'] : undefined,
        name: typeof claims['name'] === 'string' ? claims['name'] : undefined,
        groups: Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : undefined,
      };
      log.info('oidc.complete', { subject: signIn.subject, person: signIn.person !== undefined, groups: signIn.groups?.length ?? 0, hasEmail: signIn.email !== undefined });
      return { signIn, returnTo: flow.returnTo };
    },
  };
}

/**
 * Client authentication with a signed token from a file instead of a secret
 * (RFC 7523): a Kubernetes workload identity token that Entra trusts through
 * a federated credential. The file is read on every token request, because
 * the kubelet replaces it before it expires.
 */
export function assertionAuth(path: string): oidc.ClientAuth {
  return (_as, client, body) => {
    body.set('client_id', client.client_id);
    body.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    body.set('client_assertion', readFileSync(path, 'utf8').trim());
  };
}

/** Only same-origin paths are honoured as a return target. */
export function safeReturn(path: string | undefined): string {
  return path && path.startsWith('/') && !path.startsWith('//') ? path : '/';
}

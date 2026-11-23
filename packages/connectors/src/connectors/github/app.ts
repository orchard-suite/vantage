/**
 * How a GitHub connector signs in: with a stored token, as a GitHub App, or
 * not at all. As an app, each run signs a short JWT with the app's private
 * key, finds the installation on each repository's owner (or takes the one
 * it was given), and trades the JWT for an installation token that reaches
 * that one repository with only the permissions the kind reads with. The
 * token lasts an hour and is never stored, so nothing is rotated by hand.
 */
import { createPrivateKey, sign } from 'node:crypto';
import { z } from 'zod';
import { fetchJson, type ConnectorContext } from '../../connector.ts';

export const GithubAppSchema = z
  .object({
    id: z.string().min(1).describe('The GitHub App id, or its client id'),
    privateKey: z.string().min(1).describe("Secret reference for the app's private key (PEM)"),
    installation: z.number().int().positive().optional().describe("The installation id; without it, each repository's owner's installation is looked up every run"),
  })
  .strict();

export type GithubApp = z.output<typeof GithubAppSchema>;

/** The sign-in settings a GitHub connector kind shares. */
export const githubSignIn = {
  token: z.string().min(1).optional().describe('Secret reference for a token that may read the repositories; without it and without app, only public ones, at a low rate'),
  app: GithubAppSchema.optional().describe('Read as a GitHub App instead of a token: a fresh installation token per repository every run, scoped to what the kind reads'),
};

export const ONE_SIGN_IN = { message: 'give token or app, not both' } as const;

export const oneSignIn = (c: { token?: string | undefined; app?: GithubApp | undefined }): boolean => !(c.token !== undefined && c.app !== undefined);

/** Repository permissions an installation token may ask for; a kind asks only for what it reads. */
export type GithubPermissions = Readonly<Partial<Record<'contents' | 'metadata' | 'issues' | 'pull_requests', 'read'>>>;

const API_HEADERS = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } as const;

const b64url = (s: string | Buffer): string => Buffer.from(s).toString('base64url');

/** A JWT the app signs for itself, valid ten minutes; GitHub allows a minute of clock skew each way. */
export function appJwt(id: string, pem: string, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000) - 60;
  const data = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iat, exp: iat + 600, iss: id }))}`;
  return `${data}.${b64url(sign('RSA-SHA256', Buffer.from(data), createPrivateKey(pem)))}`;
}

/** The request headers for one repository; the signer reads its secrets once per run. */
export type RepositorySigner = (repo: string) => Promise<Record<string, string>>;

/**
 * A signer for one run. A token signs every repository the same; an app
 * mints a token per repository; with neither, requests go unsigned.
 */
export async function githubSigner(
  ctx: ConnectorContext<{ token?: string | undefined; app?: GithubApp | undefined }>,
  base: string,
  permissions: GithubPermissions,
): Promise<RepositorySigner> {
  const { config, log } = ctx;
  if (config.token !== undefined) {
    const headers = { ...API_HEADERS, authorization: `Bearer ${await ctx.secrets(config.token)}` };
    log.debug('github sign-in', { as: 'token' });
    return async () => headers;
  }
  const app = config.app;
  if (app === undefined) {
    log.debug('github sign-in', { as: 'none' });
    return async () => ({ ...API_HEADERS });
  }
  const jwt = { ...API_HEADERS, authorization: `Bearer ${appJwt(app.id, await ctx.secrets(app.privateKey), ctx.now())}` };
  const installations = new Map<string, Promise<number>>();
  const installationOf = (repo: string): Promise<number> => {
    if (app.installation !== undefined) return Promise.resolve(app.installation);
    const owner = repo.split('/')[0]!;
    let found = installations.get(owner);
    if (found === undefined) {
      found = fetchJson<{ id: number }>(ctx, `${base}/repos/${repo}/installation`, { headers: jwt }).then((r) => {
        log.info('github app installation found', { app: app.id, owner, installation: r.id });
        return r.id;
      });
      installations.set(owner, found);
    }
    return found;
  };
  log.debug('github sign-in', { as: 'app', app: app.id, installation: app.installation ?? 'per owner' });
  return async (repo) => {
    const installation = await installationOf(repo);
    const minted = await fetchJson<{ token: string; expires_at?: string; permissions?: Record<string, string> }>(ctx, `${base}/app/installations/${installation}/access_tokens`, {
      method: 'POST',
      headers: { ...jwt, 'content-type': 'application/json' },
      body: JSON.stringify({ repositories: [repo.split('/')[1]!], permissions }),
    });
    log.info('github app token minted', { app: app.id, installation, repository: repo, expires: minted.expires_at, permissions: minted.permissions ?? permissions });
    return { ...API_HEADERS, authorization: `Bearer ${minted.token}` };
  };
}

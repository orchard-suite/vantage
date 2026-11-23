import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, verify } from 'node:crypto';
import { runConnector } from '../../run.ts';
import { drain, fixtureFetch, testContext } from '../../testing.ts';
import { appJwt, githubConnector, GithubConfigSchema, nextLink } from './github.ts';

const dir = `${import.meta.dir}/fixtures`;

function api() {
  return fixtureFetch(dir, [
    { match: 'repos/acme/shop/issues?state=open&per_page=100&page=2', file: 'shop-2.json' },
    { match: 'repos/acme/shop/issues', file: 'shop-1.json', headers: { link: '<https://api.github.com/repos/acme/shop/issues?state=open&per_page=100&page=2>; rel="next", <https://api.github.com/repos/acme/shop/issues?state=open&per_page=100&page=2>; rel="last"' } },
    { match: 'repos/acme/relay/issues', file: 'relay.json' },
  ]);
}

const config = GithubConfigSchema.parse({ token: 'GITHUB_TOKEN', repositories: ['acme/shop', 'acme/relay'], severities: { P0: 'critical' } });

describe('github connector', () => {
  test('reads the open issues list per repository, follows the Link header, and sends the token', async () => {
    const f = api();
    const batches = await drain(githubConnector.discover(testContext(config, f.fetch, { GITHUB_TOKEN: 'ghs' })));
    expect(f.calls.map((c) => c.url.replace('https://api.github.com/', ''))).toEqual([
      'repos/acme/shop/issues?state=open&per_page=100',
      'repos/acme/shop/issues?state=open&per_page=100&page=2',
      'repos/acme/relay/issues?state=open&per_page=100',
    ]);
    expect(f.calls.every((c) => c.headers.authorization === 'Bearer ghs')).toBe(true);
    expect(batches.map((b) => b.items?.length)).toEqual([3, 1]);
    expect(batches.every((b) => b.partial && b.entities.length === 0)).toBe(true);
  });

  test('tells pull requests from issues, drafts from open, and points every item at the repository fact', async () => {
    const [shop, relay] = await drain(githubConnector.discover(testContext(config, api().fetch, { GITHUB_TOKEN: 'ghs' })));
    expect(shop!.items).toEqual([
      { id: 'acme/shop#42', kind: 'pr', title: '#42 Retry payment webhooks', url: 'https://github.com/acme/shop/pull/42', status: 'open', updated: '2026-10-28T07:00:00.000Z', target: { fact: 'repository', value: 'acme/shop' } },
      { id: 'acme/shop#41', kind: 'pr', title: '#41 Spike: new cart layout', url: 'https://github.com/acme/shop/pull/41', status: 'draft', updated: '2026-10-26T12:00:00.000Z', target: { fact: 'repository', value: 'acme/shop' } },
      { id: 'acme/shop#39', kind: 'issue', title: '#39 Checkout fails for saved cards', url: 'https://github.com/acme/shop/issues/39', severity: 'critical', status: 'open', updated: '2026-10-28T09:10:00.000Z', target: { fact: 'repository', value: 'acme/shop' } },
    ]);
    expect(relay!.items?.[0]?.severity).toBe('low');
  });

  test('leaves out pull requests or issues when the config says so, and reads without a token', async () => {
    const f = api();
    const { token: _t, ...rest } = config;
    const batches = await drain(githubConnector.discover(testContext({ ...rest, pulls: false }, f.fetch)));
    expect(batches.flatMap((b) => b.items ?? []).map((i) => i.kind)).toEqual(['issue', 'issue']);
    expect(f.calls[0]!.headers.authorization).toBeUndefined();
  });

  test('runConnector folds the repositories into one full batch', async () => {
    const run = await runConnector(githubConnector, testContext<unknown>(config, api().fetch, { GITHUB_TOKEN: 'ghs' }), 'gh');
    expect(run.batch.items).toHaveLength(4);
    expect(run.batch.partial).toBeUndefined();
  });

  test('a failing repository stops the run with the status', async () => {
    const f = fixtureFetch(dir, [{ match: 'issues', json: { message: 'Not Found' }, status: 404 }]);
    await expect(drain(githubConnector.discover(testContext(config, f.fetch, { GITHUB_TOKEN: 'ghs' })))).rejects.toThrow('404');
  });

  test('as a GitHub App, it signs a JWT, trades it for an installation token, and reads with that', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    const f = fixtureFetch(dir, [{ match: 'app/installations/77/access_tokens', json: { token: 'ghs_app' } }, ...[
      { match: 'repos/acme/shop/issues', file: 'shop-2.json' },
      { match: 'repos/acme/relay/issues', file: 'relay.json' },
    ]]);
    const appConfig = GithubConfigSchema.parse({ app: { id: '123', installation: 77, privateKey: 'GITHUB_APP_KEY' }, repositories: ['acme/shop', 'acme/relay'] });
    await drain(githubConnector.discover(testContext(appConfig, f.fetch, { GITHUB_APP_KEY: pem })));
    const [mint, ...reads] = f.calls;
    expect(mint!.method).toBe('POST');
    const jwt = mint!.headers.authorization!.replace('Bearer ', '');
    const [h, p, s] = jwt.split('.');
    expect(verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s!, 'base64url'))).toBe(true);
    const claims = JSON.parse(Buffer.from(p!, 'base64url').toString()) as { iss: string; iat: number; exp: number };
    expect(claims.iss).toBe('123');
    expect(claims.exp - claims.iat).toBe(600);
    expect(reads.map((c) => c.headers.authorization)).toEqual(['Bearer ghs_app', 'Bearer ghs_app']);
    expect(appJwt('1', pem, new Date(0)).split('.')).toHaveLength(3);
  });

  test('a token and an app together are refused', () => {
    expect(GithubConfigSchema.safeParse({ token: 'T', app: { id: '1', installation: 1, privateKey: 'K' }, repositories: ['a/b'] }).success).toBe(false);
  });

  test('nextLink finds the next page only', () => {
    expect(nextLink('<https://x/a?page=3>; rel="next", <https://x/a?page=9>; rel="last"')).toBe('https://x/a?page=3');
    expect(nextLink('<https://x/a?page=1>; rel="prev"')).toBeUndefined();
    expect(nextLink(null)).toBeUndefined();
  });
});

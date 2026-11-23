import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, verify } from 'node:crypto';
import { fixtureFetch, testContext } from '../../testing.ts';
import { appJwt, githubSigner, type GithubApp } from './app.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const BASE = 'https://api.github.com';

function appContext(app: GithubApp, routes: Parameters<typeof fixtureFetch>[1]) {
  const f = fixtureFetch('', routes);
  return { f, ctx: testContext<{ app: GithubApp }>({ app }, f.fetch, { KEY: pem }) };
}

describe('github sign-in', () => {
  test('an app signs a ten-minute JWT with its key, issued by its id', () => {
    const jwt = appJwt('123', pem, new Date('2026-10-28T10:00:00Z'));
    const [h, p, s] = jwt.split('.');
    expect(verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s!, 'base64url'))).toBe(true);
    const claims = JSON.parse(Buffer.from(p!, 'base64url').toString()) as { iss: string; iat: number; exp: number };
    expect([claims.iss, claims.exp - claims.iat]).toEqual(['123', 600]);
  });

  test('an app looks up each owner once, and mints a token per repository scoped to it and the permissions asked', async () => {
    const { f, ctx } = appContext({ id: '123', privateKey: 'KEY' }, [
      { match: 'repos/acme/shop/installation', json: { id: 41 } },
      { match: 'repos/umbrella/lab/installation', json: { id: 52 } },
      { match: 'app/installations/41/access_tokens', json: { token: 'ghs_acme' } },
      { match: 'app/installations/52/access_tokens', json: { token: 'ghs_umbrella' } },
    ]);
    const sign = await githubSigner(ctx, BASE, { contents: 'read', metadata: 'read' });
    const auth: (string | undefined)[] = [];
    for (const repo of ['acme/shop', 'acme/relay', 'umbrella/lab']) auth.push((await sign(repo)).authorization);
    expect(auth).toEqual(['Bearer ghs_acme', 'Bearer ghs_acme', 'Bearer ghs_umbrella']);
    expect(f.calls.map((c) => `${c.method} ${c.url.replace(BASE, '')}`)).toEqual([
      'GET /repos/acme/shop/installation',
      'POST /app/installations/41/access_tokens',
      'POST /app/installations/41/access_tokens',
      'GET /repos/umbrella/lab/installation',
      'POST /app/installations/52/access_tokens',
    ]);
    const mints = f.calls.filter((c) => c.method === 'POST').map((c) => JSON.parse(c.body!) as { repositories: string[] });
    expect(mints.map((m) => m.repositories)).toEqual([['shop'], ['relay'], ['lab']]);
    expect(JSON.parse(f.calls[1]!.body!)).toEqual({ repositories: ['shop'], permissions: { contents: 'read', metadata: 'read' } });
    expect(f.calls.every((c) => c.headers.authorization!.split('.').length === 3)).toBe(true);
    expect(ctx.log.records.filter((r) => r.message === 'github app token minted').map((r) => r.fields.repository)).toEqual(['acme/shop', 'acme/relay', 'umbrella/lab']);
  });

  test('an app given its installation skips the lookup', async () => {
    const { f, ctx } = appContext({ id: '123', privateKey: 'KEY', installation: 77 }, [{ match: 'app/installations/77/access_tokens', json: { token: 'ghs_app' } }]);
    expect((await (await githubSigner(ctx, BASE, { metadata: 'read' }))('acme/shop')).authorization).toBe('Bearer ghs_app');
    expect(f.calls.map((c) => c.url)).toEqual([`${BASE}/app/installations/77/access_tokens`]);
  });

  test('an app not installed on the owner stops the run with the status', async () => {
    const { ctx } = appContext({ id: '123', privateKey: 'KEY' }, [{ match: 'installation', json: { message: 'Not Found' }, status: 404 }]);
    await expect((await githubSigner(ctx, BASE, { metadata: 'read' }))('acme/shop')).rejects.toThrow('404');
  });

  test('a token signs every repository alike, and no sign-in sends none', async () => {
    const f = fixtureFetch('', []);
    const byToken = await githubSigner(testContext({ token: 'T' }, f.fetch, { T: 'ghp' }), BASE, { metadata: 'read' });
    expect((await byToken('a/b')).authorization).toBe('Bearer ghp');
    expect((await (await githubSigner(testContext({}, f.fetch), BASE, { metadata: 'read' }))('a/b')).authorization).toBeUndefined();
    expect(f.calls).toHaveLength(0);
  });
});

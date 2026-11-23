import { describe, expect, test } from 'bun:test';
import type { AppIdentity, FetchLike } from './connector.ts';
import { isKeyVaultRef, secretResolver } from './secrets.ts';

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

describe('secret references', () => {
  test('reads a Key Vault secret as the connector app, with a token for the vault', async () => {
    const scopes: string[] = [];
    const identity: AppIdentity = { token: async (scope) => (scopes.push(scope), 'vault-token') };
    const asked: { url: string; auth: string | null }[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      asked.push({ url: String(input), auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify({ value: 's3cret' }), { headers: { 'content-type': 'application/json' } });
    };
    const resolve = secretResolver({ identity, fetch: fetchImpl, log: quiet });
    expect(await resolve('https://kv-example.vault.azure.net/secrets/orrery-token')).toBe('s3cret');
    expect(scopes).toEqual(['https://vault.azure.net/.default']);
    expect(asked).toEqual([{ url: 'https://kv-example.vault.azure.net/secrets/orrery-token?api-version=7.4', auth: 'Bearer vault-token' }]);
  });

  test('says when the vault refuses the app', async () => {
    const identity: AppIdentity = { token: async () => 't' };
    const fetchImpl: FetchLike = async () => new Response(JSON.stringify({ error: { code: 'Forbidden' } }), { status: 403 });
    await expect(secretResolver({ identity, fetch: fetchImpl, log: quiet })('https://kv-example.vault.azure.net/secrets/x')).rejects.toThrow('403 Forbidden');
  });

  test('reads an environment name only where the runner has an environment of its own to give', async () => {
    const identity: AppIdentity = { token: async () => 't' };
    const fetchImpl: FetchLike = async () => new Response('', { status: 599 });
    expect(await secretResolver({ identity, fetch: fetchImpl, log: quiet, env: { ORRERY_TOKEN: 'v' } })('ORRERY_TOKEN')).toBe('v');
    await expect(secretResolver({ identity, fetch: fetchImpl, log: quiet })('ORRERY_TOKEN')).rejects.toThrow('reads its secrets from Key Vault as its own app');
  });

  test('knows a Key Vault secret URL from anything else', () => {
    expect(isKeyVaultRef('https://kv-example.vault.azure.net/secrets/a-b/0123abcd')).toBe(true);
    expect(isKeyVaultRef('https://evil.example/secrets/a')).toBe(false);
    expect(isKeyVaultRef('ORRERY_TOKEN')).toBe(false);
  });
});

import { describe, expect, test } from 'bun:test';
import { AZURE_POSTGRES_SCOPE, databasePassword } from './auth.ts';

describe('database sign-in', () => {
  test('password mode leaves the URL to carry the password', async () => {
    expect(await databasePassword({ DATABASE_AUTH: 'password' })).toBeUndefined();
  });

  test('azure mode asks the credential for a Postgres token on every call', async () => {
    const scopes: string[] = [];
    let n = 0;
    const password = await databasePassword({ DATABASE_AUTH: 'azure' }, {
      getToken: async (scope) => {
        scopes.push(scope);
        return { token: `token-${++n}` };
      },
    });
    expect(await password!()).toBe('token-1');
    expect(await password!()).toBe('token-2');
    expect(scopes).toEqual([AZURE_POSTGRES_SCOPE, AZURE_POSTGRES_SCOPE]);
  });

  test('azure mode fails loudly when the credential gives no token', async () => {
    const password = await databasePassword({ DATABASE_AUTH: 'azure' }, { getToken: async () => null });
    expect(password!()).rejects.toThrow(/no token for Postgres/);
  });
});

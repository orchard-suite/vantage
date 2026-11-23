/** How the hub proves itself to Postgres when the password is not in the URL. */
import type { Config } from '../config.ts';
import type { PasswordSource } from './postgres.ts';

/** The scope Azure Database for PostgreSQL takes Entra tokens for. */
export const AZURE_POSTGRES_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';

/** The one call the hub makes on a credential; `@azure/identity` credentials answer it and renew the token they keep. */
export interface TokenCredential {
  getToken(scope: string): Promise<{ token: string } | null>;
}

/**
 * The password source `DATABASE_AUTH` asks for: none when the URL carries the
 * password, else an Entra token for the pod's workload identity. The driver
 * asks again for every connection it opens, so a connection opened after a
 * token expired signs in with a new one.
 */
export async function databasePassword(config: Pick<Config, 'DATABASE_AUTH'>, credential?: TokenCredential): Promise<PasswordSource | undefined> {
  if (config.DATABASE_AUTH === 'password') return undefined;
  const cred = credential ?? (await defaultCredential());
  return async () => {
    const got = await cred.getToken(AZURE_POSTGRES_SCOPE);
    if (!got?.token) throw new Error('DATABASE_AUTH=azure: the workload identity gave no token for Postgres');
    return got.token;
  };
}

async function defaultCredential(): Promise<TokenCredential> {
  const { DefaultAzureCredential } = await import('@azure/identity');
  return new DefaultAzureCredential();
}

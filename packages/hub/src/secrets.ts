/**
 * The sealed secret store: named values per organization, encrypted with
 * SECRETS_KEY at rest. Connector and target configs name a secret; the
 * resolver hands the plaintext to the connector or target and nowhere
 * else. No API returns a value, and no log line carries one.
 */
import type { Db } from './db/db.ts';
import { maybe } from './db/db.ts';
import { open, randomId, seal } from './crypto.ts';
import type { Logger } from './log.ts';

export interface SecretRow {
  readonly id: string;
  readonly name: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export const SECRET_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,199}$/;

export async function putSecret(db: Db, key: string, orgId: string, name: string, value: string): Promise<SecretRow> {
  const sealed = await seal(key, value);
  await db.query(
    `insert into secrets (id, org_id, name, sealed) values ($1, $2, $3, $4)
       on conflict (org_id, name) do update set sealed = excluded.sealed, updated_at = now()`,
    [randomId(), orgId, name, sealed],
  );
  return (await maybe<SecretRow>(db, 'select id, name, created_at, updated_at from secrets where org_id = $1 and name = $2', [orgId, name]))!;
}

export async function listSecrets(db: Db, orgId: string): Promise<SecretRow[]> {
  return db.query<SecretRow>('select id, name, created_at, updated_at from secrets where org_id = $1 order by name', [orgId]);
}

export async function deleteSecret(db: Db, orgId: string, name: string): Promise<boolean> {
  const rows = await db.query('delete from secrets where org_id = $1 and name = $2 returning id', [orgId, name]);
  return rows.length > 0;
}

export type SecretResolver = (ref: string) => Promise<string>;

/**
 * A resolver for one organization. A reference is the secret name; an
 * `env:NAME` reference reads the worker's environment instead, for
 * credentials that arrive through workload identity or an external
 * secret mount. The resolver logs the reference and the outcome, never
 * the value.
 */
export function secretResolver(db: Db, key: string, orgId: string, log: Logger, env: Record<string, string | undefined> = process.env): SecretResolver {
  return async (ref) => {
    if (ref.startsWith('env:')) {
      const name = ref.slice(4);
      const value = env[name];
      log.debug('secret.resolve', { ref, kind: 'env', found: value !== undefined });
      if (value === undefined) throw new Error(`secret ${ref}: environment variable ${name} is not set`);
      return value;
    }
    const row = await maybe<{ sealed: string }>(db, 'select sealed from secrets where org_id = $1 and name = $2', [orgId, ref]);
    if (!row) {
      log.warn('secret.resolve', { ref, kind: 'store', found: false });
      throw new Error(`secret ${ref} is not in the store; add it with PUT /api/v1/secrets/${ref}`);
    }
    const value = await open(key, row.sealed);
    if (value === undefined) {
      log.error('secret.resolve', { ref, kind: 'store', found: true, opened: false });
      throw new Error(`secret ${ref} could not be opened; was SECRETS_KEY rotated?`);
    }
    log.debug('secret.resolve', { ref, kind: 'store', found: true, opened: true });
    return value;
  };
}

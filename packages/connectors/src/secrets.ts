/**
 * How a runner turns a secret reference a connector names into its value.
 * A Key Vault secret URL is read as the connector's own app, so a connector
 * reads only the secrets its app was granted, wherever it runs. An
 * environment variable name reads the runner's own environment, which only
 * a runner of the connector's own may do: in the shared pool every
 * connector would see every other one's variables.
 */
import type { AppIdentity, FetchLike, Logger } from './connector.ts';

/** https://<vault>.vault.azure.net/secrets/<name>, with an optional version; the sovereign clouds' vault hosts too. */
const KEY_VAULT = /^https:\/\/[a-z0-9-]+\.(vault\.azure\.net|vault\.azure\.cn|vault\.usgovcloudapi\.net)\/secrets\/[A-Za-z0-9-]+(\/[A-Za-z0-9]+)?\/?$/;

export function isKeyVaultRef(ref: string): boolean {
  return KEY_VAULT.test(ref);
}

export interface SecretResolverOptions {
  readonly identity: AppIdentity;
  readonly fetch: FetchLike;
  readonly log: Logger;
  /** The runner's environment, which a reference that is no Key Vault URL reads; absent, such a reference is refused. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export function secretResolver(o: SecretResolverOptions): (ref: string) => Promise<string> {
  return async (ref) => {
    const vault = KEY_VAULT.exec(ref);
    if (vault) {
      const token = await o.identity.token(`https://${vault[1]}/.default`);
      const res = await o.fetch(`${ref.replace(/\/$/, '')}?api-version=7.4`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
      const body = (await res.json().catch(() => ({}))) as { value?: string; error?: { code?: string; message?: string } };
      if (!res.ok || typeof body.value !== 'string') {
        o.log.warn('secret unreadable', { vault: new URL(ref).host, status: res.status, code: body.error?.code });
        throw new Error(`Key Vault refused ${ref} to the connector's app: ${res.status} ${body.error?.code ?? ''}`.trim());
      }
      o.log.debug('secret read', { vault: new URL(ref).host });
      return body.value;
    }
    if (!o.env) throw new Error(`secret ${ref} is not a Key Vault secret URL; in the shared pool a connector reads its secrets from Key Vault as its own app`);
    const v = o.env[ref];
    if (v === undefined) throw new Error(`secret ${ref} is not in the runner's environment`);
    return v;
  };
}

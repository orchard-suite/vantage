/**
 * Immutable artifact storage behind one interface. Keys are content
 * addressed (version hash plus artifact name), so a write never changes
 * an existing object and a read can carry long cache headers.
 */
export interface BlobStore {
  readonly driver: 'fs' | 'azure' | 'memory';
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
  /** Keys under a prefix, for garbage collection. */
  list(prefix: string): Promise<string[]>;
  /** Reachability probe for /readyz. */
  ping(): Promise<void>;
}

/** Keys are hash-shaped path segments only; anything else is a bug upstream. */
export function assertKey(key: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9._-]+)*$/.test(key) || key.includes('..')) throw new Error(`invalid blob key: ${key}`);
}

/** In-memory store for tests. */
export function memoryBlobStore(): BlobStore {
  const map = new Map<string, Uint8Array>();
  return {
    driver: 'memory',
    put: async (key, data) => {
      assertKey(key);
      map.set(key, data);
    },
    get: async (key) => map.get(key),
    delete: async (key) => {
      map.delete(key);
    },
    list: async (prefix) => [...map.keys()].filter((k) => k.startsWith(prefix)),
    ping: async () => undefined,
  };
}

/** Blob store on a local directory; the home deployment and development. */
import { mkdir, readFile, readdir, rename, rm, writeFile, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { assertKey, type BlobStore } from './blob.ts';
import type { Logger } from '../log.ts';

export function fsBlobStore(root: string, log: Logger): BlobStore {
  const pathOf = (key: string): string => {
    assertKey(key);
    return join(root, key);
  };
  log.info('blob.fs', { root });
  return {
    driver: 'fs',
    // Written beside the target and renamed over it: a reader sees the old
    // file or the new one, never a half-written one.
    put: async (key, data) => {
      const p = pathOf(key);
      await mkdir(dirname(p), { recursive: true });
      const tmp = `${p}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, data);
        await rename(tmp, p);
      } catch (err) {
        await rm(tmp, { force: true });
        throw err;
      }
    },
    get: async (key) => {
      try {
        return new Uint8Array(await readFile(pathOf(key)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw err;
      }
    },
    delete: async (key) => {
      await rm(pathOf(key), { force: true });
    },
    list: async (prefix) => {
      const out: string[] = [];
      const walk = async (dir: string): Promise<void> => {
        let entries: import('node:fs').Dirent[];
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const full = join(dir, e.name);
          if (e.isDirectory()) await walk(full);
          else if (!e.name.endsWith('.tmp')) out.push(relative(root, full).split('\\').join('/'));
        }
      };
      await walk(root);
      return out.filter((k) => k.startsWith(prefix));
    },
    ping: async () => {
      await mkdir(root, { recursive: true });
      await access(root);
    },
  };
}

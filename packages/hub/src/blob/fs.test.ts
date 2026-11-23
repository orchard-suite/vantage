import { describe, expect, test } from 'bun:test';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fsBlobStore } from './fs.ts';
import { silentLogger } from '../log.ts';

describe('fs blob store', () => {
  test('a reader during a rewrite sees the old file or the new one, never part of one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vantage-blob-'));
    const store = fsBlobStore(root, silentLogger);
    const size = 4_000_000;
    const fill = (c: number): Uint8Array => new Uint8Array(size).fill(c);
    await store.put('doc/bundle.json', fill(65), 'application/json');
    let torn = 0;
    let reads = 0;
    let writing = true;
    const writer = (async () => {
      for (let i = 0; i < 20; i++) await store.put('doc/bundle.json', fill(i % 2 ? 65 : 66), 'application/json');
      writing = false;
    })();
    const reader = (async () => {
      while (writing) {
        const got = await store.get('doc/bundle.json');
        reads++;
        if (!got || got.byteLength !== size || got[size - 1] !== got[0]) torn++;
      }
    })();
    await Promise.all([writer, reader]);
    expect(reads).toBeGreaterThan(0);
    expect(torn).toBe(0);
    expect((await readdir(join(root, 'doc'))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(await store.list('doc/')).toEqual(['doc/bundle.json']);
  });
});

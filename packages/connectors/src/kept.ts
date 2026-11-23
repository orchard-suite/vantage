/**
 * What a connector keeps from one run to the next, by key: a source's tag
 * and the answer it named, say, so the next run can ask "has this moved?"
 * and reuse the answer when it has not. A runner is often a fresh process
 * each time, so it loads the kept entries before a run and stores them
 * after; only what the run read or wrote is stored, so an entry nobody
 * asks for again is let go.
 */
import { gunzipSync, gzipSync } from 'node:zlib';

export interface Kept {
  /** The value kept under `key`, or undefined; a connector checks its shape before it trusts it. */
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface KeptStore extends Kept {
  /** The entries this run read or wrote: what the next run starts from. */
  entries(): Record<string, unknown>;
  /** Whether the entries differ from what the run started with: one was written, or one was let go. */
  changed(): boolean;
}

export function keptStore(from: Record<string, unknown> = {}): KeptStore {
  const values = new Map(Object.entries(from));
  const touched = new Set<string>();
  let wrote = false;
  return {
    get(key) {
      if (values.has(key)) touched.add(key);
      return values.get(key);
    },
    set(key, value) {
      values.set(key, value);
      touched.add(key);
      wrote = true;
    },
    entries: () => Object.fromEntries([...touched].map((k) => [k, values.get(k)])),
    changed: () => wrote || Object.keys(from).some((k) => !touched.has(k)),
  };
}

/** The kept entries as the bytes a runner stores: gzipped JSON. */
export function encodeKept(entries: Record<string, unknown>): Uint8Array<ArrayBuffer> {
  return new Uint8Array(gzipSync(JSON.stringify(entries)));
}

/** The kept entries back from their stored bytes; anything unreadable is nothing kept. */
export function decodeKept(bytes: Uint8Array): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(gunzipSync(bytes).toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

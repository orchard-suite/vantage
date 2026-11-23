import { describe, expect, test } from 'bun:test';
import { decodeKept, encodeKept, keptStore } from './kept.ts';

describe('kept', () => {
  test('keeps only what a run read or wrote, and says it changed when an entry is let go', () => {
    const kept = keptStore({ a: 1, b: 2 });
    expect(kept.get('a')).toBe(1);
    expect(kept.get('missing')).toBeUndefined();
    expect(kept.entries()).toEqual({ a: 1 });
    expect(kept.changed()).toBe(true);
    const same = keptStore({ a: 1 });
    same.get('a');
    expect(same.changed()).toBe(false);
    same.set('c', { etag: '"t"' });
    expect(same.changed()).toBe(true);
    expect(same.entries()).toEqual({ a: 1, c: { etag: '"t"' } });
  });

  test('round-trips through its stored bytes, and reads unreadable bytes as nothing kept', () => {
    expect(decodeKept(encodeKept({ a: { b: [1, 'x'] } }))).toEqual({ a: { b: [1, 'x'] } });
    expect(decodeKept(new TextEncoder().encode('not gzip'))).toEqual({});
  });
});

import { describe, expect, test } from 'bun:test';
import { BeatSchema, forReader, nameCache, stamp } from './presence.ts';
import type { Db } from './db/db.ts';

const member = { userId: 'u1', name: 'Ana', named: true, guest: false };

describe('presence beats', () => {
  test('a beat defaults to a plain beat and refuses a session id that is not one', () => {
    expect(BeatSchema.parse({ session: 'abcdefgh' }).event).toBe('beat');
    expect(BeatSchema.safeParse({ session: 'a b' }).success).toBe(false);
    expect(BeatSchema.safeParse({ session: 'abcdefgh', cam: { x: 0, y: 0, w: 0, h: 1 } }).success).toBe(false);
  });

  test('a reader never sees the user id; their own other tab is marked mine', () => {
    const wire = JSON.stringify(stamp(BeatSchema.parse({ session: 'abcdefgh', view: 'v1' }), member));
    expect(JSON.parse(forReader(wire, { userId: 'u2', guest: false })!)).toEqual({ session: 'abcdefgh', event: 'beat', view: 'v1', name: 'Ana', guest: false });
    expect(JSON.parse(forReader(wire, { userId: 'u1', guest: false })!)).toMatchObject({ mine: true });
    expect(forReader('not json', { userId: null, guest: true })).toBeUndefined();
  });

  test('a guest sees a member without a display name as Member', () => {
    const wire = JSON.stringify(stamp(BeatSchema.parse({ session: 'abcdefgh' }), { ...member, name: 'ana', named: false }));
    expect(JSON.parse(forReader(wire, { userId: null, guest: true })!).name).toBe('Member');
    expect(JSON.parse(forReader(wire, { userId: 'u3', guest: false })!).name).toBe('ana');
  });

  test('names are read once per few minutes, with the subject before any @ when no display name is set', async () => {
    let reads = 0;
    let t = 0;
    const db = { query: async () => (reads++, [{ display_name: reads > 1 ? 'Ana' : null }]) } as unknown as Db;
    const names = nameCache(db, () => t);
    expect(await names('u1', 'ana@example.com')).toMatchObject({ name: 'ana', named: false });
    expect(await names('u1', 'ana@example.com')).toMatchObject({ name: 'ana' });
    t = 10 * 60_000;
    expect(await names('u1', 'ana@example.com')).toMatchObject({ name: 'Ana', named: true });
    expect(reads).toBe(2);
  });
});

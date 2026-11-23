import { describe, expect, test } from 'bun:test';
import { testContext } from '../testing.ts';
import type { Db } from '../db/db.ts';
import { authenticate } from './authenticate.ts';
import { createToken, resolveToken } from './tokens.ts';

describe('front door sign-in', () => {
  test('the same sign-in within the cache window makes sure of the user once, and a new group is seen at once', async () => {
    const ctx = await testContext({ env: { AUTH_MODE: 'proxy' } });
    let transactions = 0;
    const counted: Db = { ...ctx.db, transaction: (fn) => (transactions++, ctx.db.transaction(fn)) };
    const req = (groups: string) => new Request('http://hub.test/', { headers: { 'x-forwarded-user': 'pat@example.com', 'x-forwarded-groups': groups } });
    const first = await authenticate(counted, ctx.config, ctx.log, req('Readers'), 'browser');
    const again = await authenticate(counted, ctx.config, ctx.log, req('Readers'), 'browser');
    expect(again.principal?.userId).toBe(first.principal!.userId);
    expect(transactions).toBe(1);
    const moved = await authenticate(counted, ctx.config, ctx.log, req('Readers,Authors'), 'browser');
    expect(transactions).toBe(2);
    expect(moved.principal?.teamIds.length).toBe(2);
  });
});

describe('token use', () => {
  test('many requests on one token write its last use once, not once each', async () => {
    const ctx = await testContext();
    const { plaintext } = await createToken(ctx.db, { orgId: 'default', userId: null, kind: 'personal', name: 'agent' });
    let writes = 0;
    const counted: Db = { ...ctx.db, query: (text, params) => (text.startsWith('update tokens set last_used_at') && writes++, ctx.db.query(text, params)) };
    const resolved = await Promise.all(Array.from({ length: 20 }, () => resolveToken(counted, plaintext)));
    expect(resolved.every((r) => r !== undefined)).toBe(true);
    expect(writes).toBe(1);
    const row = await ctx.db.query<{ last_used_at: Date | null }>('select last_used_at from tokens');
    expect(row[0]!.last_used_at).not.toBeNull();
  });
});

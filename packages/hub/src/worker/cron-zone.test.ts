import { afterEach, describe, expect, test } from 'bun:test';
import { clockOf, setTimeZone } from '../day.ts';
import { cronMatches, nextFire } from './cron.ts';
import { scheduleDue } from './schedule.ts';
import { testContext } from '../testing.ts';
import { DEFAULT_ORG } from '../auth/authenticate.ts';

afterEach(() => setTimeZone('UTC'));

describe('schedules read the estate wall clock', () => {
  test('three at night is three in the estate zone, not three in UTC', () => {
    setTimeZone('America/Chicago');
    // 9 PM on November 27 in Chicago is 03:00 on November 28 in UTC.
    expect(cronMatches('0 3 * * *', new Date('2026-11-28T03:00:00Z'))).toBe(false);
    expect(cronMatches('0 3 * * *', new Date('2026-11-28T09:00:00Z'))).toBe(true);
    // 7 PM on the 27th in Chicago is past midnight UTC: the day of month and the weekday are still Friday the 27th.
    expect(cronMatches('0 19 27 * 5', new Date('2026-11-28T01:00:00Z'))).toBe(true);
    expect(cronMatches('0 1 28 * 6', new Date('2026-11-28T01:00:00Z'))).toBe(false);
  });

  test('the next run is found in the zone and shown in it', () => {
    setTimeZone('America/Chicago');
    const next = nextFire('0 3 * * *', new Date('2026-11-28T01:00:00Z'))!;
    expect(next.toISOString()).toBe('2026-11-28T09:00:00.000Z');
    expect(clockOf(next)).toBe('2026-11-28 03:00 CST');
    expect(nextFire('0 3 * * *', next)!.toISOString()).toBe('2026-11-29T09:00:00.000Z');
    expect(nextFire('0 0 31 2 *', new Date('2026-11-28T01:00:00Z'))).toBeUndefined();
  });

  test('a minute the clock skips in spring fires once after the skip, and one it repeats in autumn fires once', () => {
    setTimeZone('America/Chicago');
    // 2027-03-14: 01:59 CST is followed by 03:00 CDT, at 08:00 UTC.
    expect(cronMatches('30 2 * * *', new Date('2027-03-14T08:00:00Z'))).toBe(true);
    expect(cronMatches('30 2 * * *', new Date('2027-03-14T08:30:00Z'))).toBe(false);
    expect(nextFire('30 2 * * *', new Date('2027-03-14T06:00:00Z'))!.toISOString()).toBe('2027-03-14T08:00:00.000Z');
    // 2026-11-01: 01:30 comes at 06:30 UTC in CDT, then again at 07:30 UTC in CST.
    expect(cronMatches('30 1 * * *', new Date('2026-11-01T06:30:00Z'))).toBe(true);
    expect(cronMatches('30 1 * * *', new Date('2026-11-01T07:30:00Z'))).toBe(false);
    expect(cronMatches('0 2 * * *', new Date('2026-11-01T08:00:00Z'))).toBe(true);
    expect(nextFire('30 1 * * *', new Date('2026-11-01T06:31:00Z'))!.toISOString()).toBe('2026-11-02T07:30:00.000Z');
  });

  test('the scheduler enqueues the nightly review at three in the estate zone', async () => {
    const ctx = await testContext({ env: { REVIEW_CRON: '0 3 * * *', TIME_ZONE: 'America/Chicago' } });
    setTimeZone(ctx.config.TIME_ZONE);
    await ctx.db.query("insert into workspaces (id, org_id, kind, name, slug) values ('w1', $1, 'team', 'W', 'w')", [DEFAULT_ORG]);
    expect(await scheduleDue(ctx, new Date('2026-11-28T03:00:00Z'))).toMatchObject({ reviews: 0 });
    expect(await scheduleDue(ctx, new Date('2026-11-28T09:00:00Z'))).toMatchObject({ reviews: 1 });
    await ctx.db.close();
  });
});

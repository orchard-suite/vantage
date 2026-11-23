import { describe, expect, test } from 'bun:test';
import { cronMatches, cronProblem, minuteKey, parseCron } from './cron.ts';
import { createScheduler, scheduleDue } from './schedule.ts';
import { testContext } from '../testing.ts';
import { DEFAULT_ORG } from '../auth/authenticate.ts';

describe('cron', () => {
  test('parses fields, steps, ranges, lists, and names problems', () => {
    const every5 = parseCron('*/5 * * * *');
    expect([...every5.minute]).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    const nightly = parseCron('0 3 * * 1-5');
    expect([...nightly.dayOfWeek]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseCron('0 0 1,15 * 7').dayOfWeek]).toEqual([0]);
    expect(cronProblem('* * * *')).toContain('five fields');
    expect(cronProblem('60 * * * *')).toContain('outside');
    expect(cronProblem('*/0 * * * *')).toContain('step');
    expect(cronProblem('a * * * *')).toContain('not a number');
    expect(cronProblem('0 3 * * *')).toBeUndefined();
  });

  test('matches the minute in UTC', () => {
    const at = new Date('2026-10-28T03:00:30Z');
    expect(cronMatches('0 3 * * *', at)).toBe(true);
    expect(cronMatches('0 4 * * *', at)).toBe(false);
    expect(cronMatches('*/15 * * * 3', at)).toBe(true);
    expect(cronMatches('* * 28 10 *', at)).toBe(true);
    expect(cronMatches('* * 29 * *', at)).toBe(false);
    expect(minuteKey(at)).toBe('2026-10-28T03:00');
  });

  test('the scheduler enqueues due publications and reviews once per minute across workers, and never a connector without an interval', async () => {
    const ctx = await testContext({ env: { REVIEW_CRON: '0 3 * * *' } });
    await ctx.db.query("insert into workspaces (id, org_id, kind, name, slug) values ('w1', $1, 'team', 'W', 'w')", [DEFAULT_ORG]);
    await ctx.db.query("insert into documents (id, org_id, workspace_id, name, slug) values ('d1', $1, 'w1', 'D', 'd')", [DEFAULT_ORG]);
    await ctx.db.query(`insert into publications (id, org_id, workspace_id, document_id, name, formats, target, config, trigger) values ('p1', $1, 'w1', 'd1', 'P', '["png"]', 'fs', '{"path":"/tmp/x"}', '{"kind":"schedule","cron":"30 3 * * *"}'), ('p2', $1, 'w1', 'd1', 'Q', '["png"]', 'fs', '{"path":"/tmp/x"}', '{"kind":"manual"}'), ('p3', $1, 'w1', 'd1', 'R', '["png"]', 'fs', '{"path":"/tmp/x"}', '{"kind":"schedule","cron":"nope"}')`, [DEFAULT_ORG]);
    await ctx.db.query("insert into sources (id, org_id, workspace_id, name, slug, connector, client_id) values ('s1', $1, 'w1', 'Azure', 'azure', 'azure-resource-graph', 'client-1')", [DEFAULT_ORG]);

    const at = new Date('2026-10-28T03:30:10Z');
    const first = await scheduleDue(ctx, at);
    expect(first).toMatchObject({ minute: '2026-10-28T03:30', publications: 1, reviews: 0, duplicates: 0, invalid: 1 });
    const second = await scheduleDue(ctx, new Date('2026-10-28T03:30:40Z'));
    expect(second).toMatchObject({ publications: 0, duplicates: 1 });
    const jobs = await ctx.db.query<{ kind: string; schedule_key: string; payload: Record<string, unknown> }>('select kind, schedule_key, payload from jobs order by kind');
    expect(jobs.map((j) => j.kind)).toEqual(['publication-run']);

    const review = await scheduleDue(ctx, new Date('2026-10-28T03:00:00Z'));
    expect(review).toMatchObject({ publications: 0, reviews: 1 });

    const scheduler = createScheduler(ctx, 3);
    expect((await scheduler.tick(new Date('2026-10-28T05:00:05Z'))).length).toBe(1);
    expect((await scheduler.tick(new Date('2026-10-28T05:00:50Z'))).length).toBe(0);
    const caught = await scheduler.tick(new Date('2026-10-28T05:03:10Z'));
    expect(caught.map((o) => o.minute)).toEqual(['2026-10-28T05:01', '2026-10-28T05:02', '2026-10-28T05:03']);
    const capped = await scheduler.tick(new Date('2026-10-28T05:20:00Z'));
    expect(capped.length).toBe(4);
    expect(capped[capped.length - 1]!.minute).toBe('2026-10-28T05:20');
    await ctx.db.close();
  });
});

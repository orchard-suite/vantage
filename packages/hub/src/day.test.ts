import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { addMonths, clockOf, dayOf, dayStart, monthKey, monthStart, parseMonth, setTimeZone, zoneProblem } from './day.ts';

afterEach(() => {
  setSystemTime();
  setTimeZone('UTC');
});

describe('the hub day', () => {
  test('an evening west of UTC is still that day in the estate zone', () => {
    setSystemTime(new Date('2026-11-28T01:00:00Z'));
    expect(dayOf()).toBe('2026-11-28');
    setTimeZone('America/Chicago');
    expect(dayOf()).toBe('2026-11-27');
    expect(dayOf('2026-11-28T06:00:00Z')).toBe('2026-11-28');
    expect(dayOf(new Date('2026-07-04T04:30:00Z'))).toBe('2026-07-03');
  });

  test('a zone east of UTC moves to the next day first', () => {
    setTimeZone('Asia/Tokyo');
    expect(dayOf(Date.parse('2026-11-27T16:00:00Z'))).toBe('2026-11-28');
  });

  test('a name that is not a zone is refused', () => {
    expect(zoneProblem('America/Chicago')).toBeUndefined();
    expect(zoneProblem('Central')).toContain('not an IANA time zone');
    expect(() => setTimeZone('Mars/Olympus')).toThrow(/IANA/);
  });
});

describe('the hub clock and calendar', () => {
  test('an instant reads as the minute in the estate zone, with its short name', () => {
    setTimeZone('America/Chicago');
    expect(clockOf('2026-11-28T01:05:00Z')).toBe('2026-11-27 19:05 CST');
    expect(clockOf(new Date('2026-07-04T04:30:00Z'))).toBe('2026-07-03 23:30 CDT');
    setTimeZone('UTC');
    expect(clockOf('2026-11-28T01:05:00Z')).toBe('2026-11-28 01:05 UTC');
  });

  test('a day and a month start at midnight in the estate zone', () => {
    setTimeZone('America/Chicago');
    const evening = new Date('2026-11-28T01:00:00Z');
    expect(dayStart(evening).toISOString()).toBe('2026-11-27T06:00:00.000Z');
    expect(monthStart(new Date('2026-12-01T03:00:00Z')).toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(monthKey(new Date('2026-12-01T03:00:00Z'))).toBe('2026-11');
    expect(parseMonth('2026-12')!.toISOString()).toBe('2026-12-01T06:00:00.000Z');
    expect(addMonths(parseMonth('2026-11')!, 1).toISOString()).toBe('2026-12-01T06:00:00.000Z');
    expect(addMonths(parseMonth('2026-11')!, -8).toISOString()).toBe('2026-03-01T06:00:00.000Z');
    // The day the clocks go back is 25 hours long.
    expect(dayStart(new Date('2026-11-02T05:59:00Z')).toISOString()).toBe('2026-11-01T05:00:00.000Z');
  });

  test('a zone whose day starts at one, because midnight is skipped, starts the day at its first instant', () => {
    setTimeZone('America/Santiago');
    // Santiago springs from 00:00 to 01:00 on 2026-09-06.
    const start = dayStart(new Date('2026-09-06T12:00:00Z'));
    expect(start.toISOString()).toBe('2026-09-06T04:00:00.000Z');
    expect(clockOf(start)).toBe('2026-09-06 01:00 GMT-3');
  });
});

import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { dayOf, setTimeZone, zoneProblem } from './day.ts';

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

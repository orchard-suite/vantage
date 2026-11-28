import { describe, expect, test } from 'bun:test';
import { allowanceNote, spend } from './allowance.ts';
import type { Allowance } from './hub.ts';

const A: Allowance = { blocked: false, today: 1000, daily: 10_000, month: 5000, monthly: null, orgMonth: 20_000, orgMonthly: 1_000_000, timeZone: 'UTC' };

describe('allowanceNote', () => {
  test('says what was used, with the limits that apply', () => {
    expect(allowanceNote(A)).toEqual({ line: '1k of 10k tokens used today, 5k this month.' });
  });

  test('warns at 80% of the limit nearest its end', () => {
    expect(allowanceNote({ ...A, today: 8100 }).warn).toBe("You have used 81% of today's tokens.");
    expect(allowanceNote({ ...A, today: 8100, orgMonth: 950_000 }).warn).toBe("The organization has used 95% of this month's model tokens.");
  });

  test('a spent limit or a block stops it, the organization first', () => {
    expect(allowanceNote({ ...A, today: 10_000, timeZone: 'America/Chicago' }).stop).toBe("You have used today's tokens. The limit resets at midnight (America/Chicago).");
    expect(allowanceNote({ ...A, today: 10_000, orgMonth: 1_000_000 }).stop).toContain('The organization has used');
    expect(allowanceNote({ ...A, blocked: true }).stop).toBe('An admin turned the model off for you.');
  });

  test('spending adds to the day, the month, and the organization', () => {
    expect(spend(A, 500)).toMatchObject({ today: 1500, month: 5500, orgMonth: 20_500 });
  });
});

import { describe, expect, test } from 'bun:test';
import { nextNumber, numberProblem } from './numbering.ts';
import { DEFAULT_CATEGORIES } from './types.ts';
import { ulid } from './ulid.ts';
import { isUlid } from '@vantage/model';

const cats = DEFAULT_CATEGORIES;

describe('numbering', () => {
  test('the first record in a category is its 001', () => {
    expect(nextNumber(cats, 2, [])).toBe(2001);
    expect(nextNumber(cats, 0, [2001])).toBe(1);
  });

  test('the next number follows the highest ever taken, so a gap is never filled', () => {
    expect(nextNumber(cats, 2, [2001, 2003, 1004])).toBe(2004);
  });

  test('a category outside the scheme, or a full one, is refused', () => {
    expect(() => nextNumber(cats, 8, [])).toThrow(/not in this registry's scheme/);
    expect(() => nextNumber(cats, 1, [1999])).toThrow(/full/);
  });

  test('a number brought in keeps its place unless it is taken, a zero, or outside the scheme', () => {
    expect(numberProblem(cats, 2002, [2001])).toBeUndefined();
    expect(numberProblem(cats, 2001, [2001])).toMatch(/taken/);
    expect(numberProblem(cats, 2000, [])).toMatch(/zero/);
    expect(numberProblem(cats, 9001, [])).toMatch(/not a category/);
  });

  test('ids are ULIDs that sort by time', () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_001);
    expect(isUlid(a)).toBe(true);
    expect(a < b).toBe(true);
  });
});

/** A test's databases close when it ends, so a run never holds enough of them to fail the next one's start. */
import { describe, expect, test } from 'bun:test';
import { testContext } from '../testing.ts';
import type { AppContext } from '../context.ts';

let opened: AppContext | undefined;

describe('the test scope', () => {
  test('a test opens a database', async () => {
    opened = await testContext();
    expect(await opened.db.query<{ x: number }>('select 1 as x')).toEqual([{ x: 1 }]);
  });

  test('the next test finds it closed', async () => {
    expect(opened).toBeDefined();
    await expect(opened!.db.query('select 1 as x')).rejects.toThrow();
  });
});

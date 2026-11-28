import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { testApp } from '../testing.ts';
import { setTimeZone } from '../day.ts';
import { RECORD } from './test-kit.ts';
import type { Decision } from './types.ts';

afterEach(() => {
  setSystemTime();
  setTimeZone('UTC');
});

const dec = (body: Record<string, unknown>): Decision => body['decision'] as Decision;

describe('the day a record is stamped with', () => {
  test('a write that leaves out Last updated gets today in the estate zone, not UTC', async () => {
    const t = await testApp();
    const me = await t.bearer('author');
    const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
    expect((await t.json(`/api/v1/workspaces/${ws.slug}/registries`, { method: 'POST', headers: me.headers, body: JSON.stringify({ prefix: 'SHOP', name: 'Shop decisions' }) })).status).toBe(201);
    setTimeZone('America/Chicago');
    // 7 PM on November 27 in Chicago is already November 28 in UTC.
    setSystemTime(new Date('2026-11-28T01:00:00Z'));
    const { updatedOn: _, ...undated } = RECORD;
    const made = dec((await t.json('/api/v1/registries/SHOP/decisions', { method: 'POST', headers: me.headers, body: JSON.stringify({ ...undated, decidedOn: '2026-11-20' }) })).body);
    expect(made.updatedOn).toBe('2026-11-27');
    const patch = (body: Record<string, unknown>) => t.json(`/api/v1/decisions/${made.ref}`, { method: 'PATCH', headers: me.headers, body: JSON.stringify(body) });
    setSystemTime(new Date('2026-11-29T02:30:00Z'));
    expect(dec((await patch({ decision: 'Only the Shop API writes orders, and it owns the schema.' })).body).updatedOn).toBe('2026-11-28');
  });
});

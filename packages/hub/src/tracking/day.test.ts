import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { testApp } from '../testing.ts';
import { setTimeZone } from '../day.ts';
import { eventLine, get, history, notes } from './read.ts';
import { note, put } from './write.ts';
import { claim } from './work.ts';
import { findItem } from './access.ts';

const KIND = `title: Requests
kind:
  prefix: REQ
  name: Requests
  lifecycle: flow
views:
  - id: flow
    kind: lifecycle
    title: How a request moves
    states:
      - { id: asked, text: Asked, class: not-started }
      - { id: done, text: Done, class: done }
    moves:
      - { from: asked, to: done, label: finish, who: [holder] }
`;

afterEach(() => {
  setSystemTime();
  setTimeZone('UTC');
});

describe('the days an item shows', () => {
  test('the day an item reached its state is the day in the estate zone', async () => {
    const t = await testApp();
    const me = await t.bearer('author');
    const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
    expect((await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: KIND }) })).status).toBe(201);
    await put(t.ctx, me.principal, { kind: 'REQ', title: 'A new api key' }, 'k1');
    // 7 PM on November 27 in Chicago is already November 28 in UTC.
    await t.ctx.db.query("update items set state_since = '2026-11-28T01:00:00Z' where key = 'REQ-1'");
    const since = async (): Promise<string | undefined> => {
      const [x] = await get(t.ctx, me.principal, ['REQ-1']);
      return x && 'card' in x ? x.card.since : undefined;
    };
    expect(await since()).toBe('2026-11-28');
    setTimeZone('America/Chicago');
    expect(await since()).toBe('2026-11-27');
  });

  test('a claim and the history show their times in the estate zone, labeled with its short name', async () => {
    const t = await testApp();
    const me = await t.bearer('author');
    const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!;
    expect((await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: KIND }) })).status).toBe(201);
    await put(t.ctx, me.principal, { kind: 'REQ', title: 'A new api key' }, 'k1');
    // 7 PM on November 27 in Chicago; the claim runs to 7:20 PM, both already November 28 in UTC.
    setSystemTime(new Date('2026-11-28T01:00:00Z'));
    setTimeZone('America/Chicago');
    await claim(t.ctx, me.principal, 'REQ-1', undefined, 'k2');
    await note(t.ctx, me.principal, 'REQ-1', 'Started on the key.', 'k3');
    await t.ctx.db.query("update item_events set at = '2026-11-28T01:00:00Z'");
    const [x] = await get(t.ctx, me.principal, ['REQ-1']);
    expect(x && 'card' in x ? x.card.claim : undefined).toMatch(/^author@example.com until 2026-11-27 19:20 CST, run /);
    const f = await findItem(t.ctx, me.principal, 'REQ-1');
    expect((await history(t.ctx, f)).lines).toContain('2026-11-27 19:00 CST author@example.com: claimed until 2026-11-27 19:20 CST');
    expect((await notes(t.ctx, f)).lines[0]).toBe('### 2026-11-27 19:00 CST author@example.com\n\nStarted on the key.');
    expect(eventLine({ type: 'renewed', data: { type: 'renewed', until: '2026-07-04T04:30:00.000Z' }, actor: null, at: '2026-07-04T04:10:00.000Z' })).toBe('2026-07-03 23:10 CDT the hub: renewed the claim until 2026-07-03 23:30 CDT');
  });
});

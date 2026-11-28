import { afterEach, describe, expect, test } from 'bun:test';
import { testApp } from '../testing.ts';
import { setTimeZone } from '../day.ts';
import { get } from './read.ts';
import { put } from './write.ts';

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

afterEach(() => setTimeZone('UTC'));

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
});

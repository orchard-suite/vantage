import { afterEach, describe, expect, test } from 'bun:test';
import { testApp, type TestApp } from '../testing.ts';
import { dayOf } from '../day.ts';
import { kindOutline, itemOutline } from '../text/items.ts';
import { addDays, dueOf, newlyDue, readsDue } from './due.ts';
import { find, get } from './read.ts';
import { move, put } from './write.ts';

describe('which kinds read a due date', () => {
  test('a kind whose chain ends at the shipped work item reads due; a module label of the same name stays unread', () => {
    expect(readsDue({ base: 'work-item' })).toBe(true);
    expect(readsDue({ base: 'SW', root: 'work-item' })).toBe(true);
    expect(readsDue({ base: 'roadmap-item' })).toBe(false);
    expect(readsDue({})).toBe(false);
  });

  test('overdue is before today, due soon is today through the window, and done or parked is neither', () => {
    const today = '2026-12-30';
    expect(addDays(today, 3)).toBe('2027-01-02');
    expect(dueOf('work-item', { due: '2026-12-29' }, 'in-progress', today, 3)).toEqual({ date: '2026-12-29', overdue: true, soon: false });
    expect(dueOf('work-item', { due: today }, 'not-started', today, 3)).toEqual({ date: today, overdue: false, soon: true });
    expect(dueOf('work-item', { due: '2027-01-02' }, 'not-started', today, 3)?.soon).toBe(true);
    expect(dueOf('work-item', { due: '2027-01-03' }, 'not-started', today, 3)).toEqual({ date: '2027-01-03', overdue: false, soon: false });
    expect(dueOf('work-item', { due: '2026-12-29' }, 'done', today, 3)).toEqual({ date: '2026-12-29', overdue: false, soon: false });
    expect(dueOf(undefined, { due: '2026-12-29' }, 'in-progress', today, 3)).toBeUndefined();
  });
});

const WORK = `title: Shop work
kind: { prefix: SW, name: Shop work, base: work-item }
views: []
`;

const opened: TestApp[] = [];
afterEach(async () => {
  for (const t of opened.splice(0)) await t.ctx.db.close();
});

async function seeded() {
  const t = await testApp();
  opened.push(t);
  const me = await t.bearer('author');
  const p = me.principal;
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!.slug;
  expect((await t.json(`/api/v1/workspaces/${ws}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: WORK }) })).status).toBe(201);
  const today = dayOf();
  // SW-1 just became overdue, SW-2 has been for days, SW-3 and SW-5 are due soon, SW-4 just came into the window, SW-6 is later, and SW-7 is dropped.
  for (const [i, days] of [-1, -5, 0, 3, 1, 4, -1].entries()) await put(t.ctx, p, { kind: 'SW', title: `Task ${i + 1}`, labels: { due: addDays(today, days) } }, `p${i}`);
  await move(t.ctx, p, 'SW-7', { to: 'dropped', note: 'Not needed.' }, 'm1');
  return { t, me, p, ws, today };
}

describe('due soon and overdue in the hub', () => {
  test('a list answers due=overdue and due=soon, and each row and card carries its due date', async () => {
    const { t, me, p, today } = await seeded();
    expect((await find(t.ctx, p, { kinds: ['SW'], due: 'overdue' })).rows.map((r) => r.key).sort()).toEqual(['SW-1', 'SW-2']);
    expect((await find(t.ctx, p, { kinds: ['SW'], due: 'soon' })).rows.map((r) => r.key).sort()).toEqual(['SW-3', 'SW-4', 'SW-5']);
    const over = await t.json('/api/v1/items?kind=SW&due=overdue&fields=due', { headers: me.headers });
    expect(over.body['total']).toBe(2);
    expect((over.body['rows'] as { due: { overdue: boolean } }[]).every((r) => r.due.overdue)).toBe(true);
    expect((await t.json('/api/v1/items?due=late', { headers: me.headers })).status).toBe(400);
    const [c] = await get(t.ctx, p, ['SW-1']);
    expect(c && 'card' in c ? c.card.due : undefined).toEqual({ date: addDays(today, -1), overdue: true, soon: false });
    expect(await itemOutline(t.ctx, p, 'SW-1')).toContain(`due: ${addDays(today, -1)}, overdue`);
  });

  test("the kind's outline counts its overdue items and lists them as a part", async () => {
    const { t, p } = await seeded();
    const outline = await kindOutline(t.ctx, p, 'SW', undefined);
    expect(outline).toContain('due: 2 overdue (SW#overdue), 3 due within 3 days (SW#due-soon)');
    const part = await kindOutline(t.ctx, p, 'SW', 'overdue');
    expect(part).toContain('SW-1');
    expect(part).toContain('OVERDUE');
    expect(part).not.toContain('SW-3');
  });

  test('the Work tab marks overdue items and filters by them', async () => {
    const { t, me, ws } = await seeded();
    const all = await (await t.app.request(`/w/${ws}?tab=work&kind=SW`, { headers: me.headers })).text();
    expect(all).toContain('aria-label="Filter by due date"');
    expect(all).toMatch(/Overdue<span class="n">2<\/span>/);
    expect(all).toContain('class="dec-row overdue"');
    const over = await (await t.app.request(`/w/${ws}?tab=work&kind=SW&due=overdue`, { headers: me.headers })).text();
    expect(over).toContain('SW-2');
    expect(over).not.toContain('SW-3');
    expect(over).toContain('<span class="pill bad"');
    const page = await (await t.app.request(`/w/${ws}/work/SW-1`, { headers: me.headers })).text();
    expect(page).toMatch(/<span class="caps">Due<\/span><b>\d{4}-\d{2}-\d{2}, overdue <span class="pill bad">Overdue<\/span><\/b>/);
  });

  test('newlyDue names the items that became overdue or due soon since a day, once', async () => {
    const { t, p, today } = await seeded();
    const notices = await newlyDue(t.ctx.db, p.orgId, addDays(today, -1), { today, soonDays: 3 });
    expect(notices.map((n) => [n.key, n.status])).toEqual([['SW-1', 'overdue'], ['SW-4', 'soon']]);
    expect(notices[0]!.workspaceId).toBeTruthy();
    expect(await newlyDue(t.ctx.db, p.orgId, today, { today, soonDays: 3 })).toEqual([]);
    // A week away, everything still open has become overdue or come into the window since then.
    expect((await newlyDue(t.ctx.db, p.orgId, addDays(today, -7), { today, soonDays: 3 })).map((n) => n.key)).toEqual(['SW-2', 'SW-1', 'SW-3', 'SW-5', 'SW-4']);
  });
});

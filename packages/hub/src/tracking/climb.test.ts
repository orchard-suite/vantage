/** The queue's read-first climbs (VAN-3026): the roadmap above an item, the decisions on that chain, and the standard that binds it. */
import { describe, expect, test } from 'bun:test';
import { seeded as withRegistry } from '../decisions/test-kit.ts';
import { DEFAULT_ORG } from '../auth/authenticate.ts';
import { EMPTY_BODY } from '../standards/model.ts';
import { writeEdition } from '../standards/repo.ts';
import { CLIMB_MAX, RECORDS_MAX } from './climb.ts';
import { queue } from './queue.ts';
import { link, put } from './write.ts';

const WORK = `title: Shop work
kind: { prefix: SW, name: Shop work, base: work-item }
views: []
`;
const PLAN = `title: Platform roadmap
kind: { prefix: PLAN, name: Platform roadmap, base: roadmap-item, parts: [SW, PLAN] }
views: []
`;

async function seeded() {
  const s = await withRegistry();
  for (const yaml of [WORK, PLAN]) expect((await s.t.json(`/api/v1/workspaces/${s.ws.slug}/documents`, { method: 'POST', headers: s.me.headers, body: JSON.stringify({ yaml }) })).status).toBe(201);
  const p = s.me.principal;
  const record = async (title: string): Promise<string> => (await s.create({ title })).ref;
  // A chain of roadmap items, each under the one before it, and a work item under the last.
  const plans = async (n: number): Promise<void> => {
    for (let i = 1; i <= n; i++) await put(s.t.ctx, p, { kind: 'PLAN', title: `Outcome ${i}`, ...(i > 1 ? { parent: `PLAN-${i - 1}` } : {}) }, `plan${i}`);
    await put(s.t.ctx, p, { kind: 'SW', title: 'Cache the prices', parent: `PLAN-${n}`, owner: 'me', delegate: true }, 'w1');
  };
  const read = async (): Promise<readonly string[]> => (await queue(s.t.ctx, p)).cards.find((c) => c.key === 'SW-1')!.read;
  return { ...s, p, record, plans, read };
}

describe('the read-first climbs', () => {
  test('past the card it names the parent, each roadmap item above, every decision the chain links, and the standard, each with its size', async () => {
    const s = await seeded();
    const { t, p } = s;
    await put(t.ctx, p, { kind: 'PLAN', title: 'The shop answers fast', body: 'y'.repeat(40) }, 'top');
    await put(t.ctx, p, { kind: 'PLAN', title: 'Prices answer from a cache', body: 'z'.repeat(25), parent: 'PLAN-1' }, 'mid');
    await put(t.ctx, p, { kind: 'SW', title: 'Cache the prices', parent: 'PLAN-2', owner: 'me', delegate: true }, 'w1');
    const own = await s.record('Prices are cached for a minute');
    const above = await s.record('Reads never wait on the price service');
    await link(t.ctx, p, 'SW-1', { rel: 'decision', target: own }, 'l1');
    await link(t.ctx, p, 'PLAN-1', { rel: 'decision', target: above }, 'l2');
    await link(t.ctx, p, 'PLAN-2', { rel: 'decision', target: above }, 'l3');
    const read = (await queue(t.ctx, p)).cards.find((c) => c.key === 'SW-1')!.read;
    expect(read.slice(0, 3)).toEqual(['SW-1 (its card and body)', 'PLAN-2 (its parent, body 25 bytes)', 'PLAN-1 (above PLAN-2, body 40 bytes)']);
    expect(read[3]).toMatch(new RegExp(`^${own} \\(decision, \\d+ bytes\\)$`));
    // A record two rungs link is named once, by the nearer.
    expect(read[4]).toMatch(new RegExp(`^${above} \\(decision linked by PLAN-2, \\d+ bytes\\)$`));
    // With no standard in the organization, no standard line.
    expect(read).toHaveLength(5);

    await writeEdition(t.ctx.db, DEFAULT_ORG, { scope: '', version: 1, state: 'published', hash: `sha256:${'0'.repeat(64)}`, body: EMPTY_BODY, manifest: { scope: 'estate', name: 'The whole estate', kind: 'estate', builds_on: [] }, changes: [], problems: [], by: 'a user' });
    const withStandard = (await queue(t.ctx, p)).cards.find((c) => c.key === 'SW-1')!.read;
    expect(withStandard.at(-1)).toMatch(/^standard\/estate@1 \(the standard for its scope, \d+ bytes\)$/);
    await t.ctx.db.close();
  });

  test('the chain and the records are capped, and each capped list names the read that goes on', async () => {
    const s = await seeded();
    const { t, p } = s;
    const n = CLIMB_MAX + 2;
    await s.plans(n);
    for (let i = 0; i < RECORDS_MAX + 2; i++) await link(t.ctx, p, 'SW-1', { rel: 'decision', target: await s.record(`Record ${i}`) }, `r${i}`);
    const read = await s.read();
    const above = read.filter((l) => /^PLAN-\d+ \(/.test(l));
    expect(above).toHaveLength(CLIMB_MAX);
    expect(above.at(-1)).toMatch(new RegExp(`^PLAN-${n - CLIMB_MAX + 1} `));
    expect(read).toContain(`more above PLAN-${n - CLIMB_MAX + 1}: vantage_read PLAN-${n - CLIMB_MAX}, whose card names its parent`);
    expect(read.filter((l) => l.includes('(decision'))).toHaveLength(RECORDS_MAX);
    expect(read).toContain('2 more decisions: vantage_read SW-1#links');
    await t.ctx.db.close();
  });
});

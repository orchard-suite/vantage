/** Every answer has a size limit, and a list names the call that reads on (VAN-0002). */
import { describe, expect, test } from 'bun:test';
import { BUDGET } from '@vantage/mcp';
import { SAMPLE_YAML, testApp } from '../testing.ts';
import { agent } from './testing.ts';
import { put, hold } from '../tracking/write.ts';

async function seeded() {
  const t = await testApp();
  const me = await t.bearer('author');
  const a = await agent(t, me.headers);
  const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!.slug;
  return { t, me, a, ws };
}

describe('answers with a size limit', () => {
  test('comments answer a page and name the call that reads the next', async () => {
    const { a, ws } = await seeded();
    await a.call('vantage_write', { writes: [{ address: `${ws}/sample`, text: SAMPLE_YAML }] });
    for (let i = 1; i <= BUDGET.listRows + 5; i++) await a.call('vantage_comment', { workspace: ws, document: 'sample', text: `note ${i}` });
    const first = await a.call('vantage_comments', { workspace: ws, document: 'sample' });
    expect(first.match(/^\S+ {2}open/gm)?.length).toBe(BUDGET.listRows);
    expect(first).toContain(`5 more comments. more: vantage_comments {"workspace":"${ws}","document":"sample","from":${BUDGET.listRows}}`);
    const next = await a.call('vantage_comments', { workspace: ws, document: 'sample', from: BUDGET.listRows });
    expect(next.match(/^\S+ {2}open/gm)?.length).toBe(5);
    expect(next).toContain(`note ${BUDGET.listRows + 5}`);
  });

  test('find with count answers the things with the most matches, never more than a page of them', async () => {
    const { a, ws } = await seeded();
    const writes = Array.from({ length: BUDGET.listRows + 4 }, (_, i) => ({ address: `${ws}/doc-${i}`, text: SAMPLE_YAML.replace('title: Sample', `title: Sample ${i}`) }));
    await a.call('vantage_write', { writes });
    const counted = await a.call('vantage_find', { query: 'orders', in: ws, count: true });
    expect(counted.split('\n').filter((l) => /^\S+\/doc-\d+: \d+$/.test(l)).length).toBe(BUDGET.listRows);
    expect(counted).toContain('4 more things left out');
  });

  test('an answer past the limit stops at a line at the door and says how to ask for less', async () => {
    const { a, ws } = await seeded();
    await a.call('vantage_write', { writes: [{ address: `${ws}/big`, text: SAMPLE_YAML }] });
    const nodes = Array.from({ length: 900 }, (_, i) => `  - name: Service number ${i} with a long name\n    type: api\n    description: ${'x'.repeat(40)}`).join('\n');
    await a.call('vantage_write', { writes: [{ address: `${ws}/big`, text: SAMPLE_YAML.replace('nodes:\n', `nodes:\n${nodes}\n`) }] });
    const diff = await a.call('vantage_diff', { workspace: ws, document: 'big' });
    expect(diff.length).toBeLessThanOrEqual(BUDGET.answerChars + 300);
    expect(diff).toMatch(/--- stopped at the size limit of 32000 characters, \d+ lines left out\. more: call vantage_diff again for less/);
  });

  test('a count by holder answers a page of groups and counts the rest as one', async () => {
    const { t, me, ws } = await seeded();
    expect((await t.json(`/api/v1/workspaces/${ws}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: 'title: Work\nkind: { prefix: SW, name: Shop work, base: work-item }\nviews: []\n' }) })).status).toBe(201);
    for (let i = 0; i < 102; i++) {
      await t.bearer(`holder-${i}`);
      await put(t.ctx, me.principal, { kind: 'SW', title: `Item ${i}` }, `p${i}`);
      await hold(t.ctx, me.principal, `SW-${i + 1}`, `holder-${i}@example.com`, `h${i}`);
    }
    const r = await t.json('/api/v1/items?count=holder', { headers: me.headers });
    expect(Object.keys(r.body['counts'] as object).length).toBe(100);
    expect(r.body['others']).toBe(2);
  }, 60_000);
});

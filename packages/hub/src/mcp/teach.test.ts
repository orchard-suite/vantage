/** Every refusal the five verbs answer names a guide topic the guide has (VAN-5004). */
import { describe, expect, test } from 'bun:test';
import { guideTopics } from '@vantage/mcp';
import { SAMPLE_YAML, testApp } from '../testing.ts';
import { agent } from './testing.ts';

describe('a refusal teaches', () => {
  test('outline, find, read, patch, and write each name the topic of the rule a refusal broke', async () => {
    const t = await testApp();
    const me = await t.bearer('author');
    const a = await agent(t, me.headers);
    const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string }[])[0]!.slug;
    await a.call('vantage_write', { writes: [{ address: `${ws}/sample`, text: SAMPLE_YAML }] });
    await a.call('vantage_write', { writes: [{ address: '~/work', text: 'title: Work\nkind: { prefix: SW, name: Shop work, base: work-item }\nviews: []\n' }] });
    await a.call('vantage_write', { writes: [{ address: 'SW', text: '---\ntitle: Cache the prices\n---\n\nBody.\n' }] });
    const refusals = [
      await a.attempt('vantage_outline', { address: `${ws}/nowhere` }),
      await a.attempt('vantage_find', { query: '(', regex: true, in: `${ws}/sample` }),
      await a.attempt('vantage_read', { addresses: [`${ws}/sample#views.nowhere`] }),
      await a.attempt('vantage_patch', { edits: [{ address: `${ws}/sample`, old: 'not in the yaml', new: 'x' }] }),
      await a.attempt('vantage_patch', { edits: [{ address: 'SW-1', old: 'state: open (Open', new: 'state: done (Open' }] }),
      await a.attempt('vantage_write', { writes: [{ address: 'NOPE-0001', text: 'not a record' }] }),
    ];
    const topics = new Set(guideTopics());
    for (const r of refusals) {
      expect(r.isError).toBe(true);
      const named = [...r.text.matchAll(/guide#([a-z0-9-]+)/g)].map((m) => m[1]!);
      expect(named.length, r.text).toBeGreaterThan(0);
      for (const topic of named) expect(topics.has(topic), `${topic} in ${r.text}`).toBe(true);
    }
    expect(refusals[4]!.text).toContain('guide#working-with-items');
  });
});

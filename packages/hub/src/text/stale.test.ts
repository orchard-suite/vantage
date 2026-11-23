import { describe, expect, test } from 'bun:test';
import { testApp, SAMPLE_YAML } from '../testing.ts';
import { agent } from '../mcp/testing.ts';
import { createWorker } from '../worker/loop.ts';

const YAML = `${SAMPLE_YAML}  - id: guide
    kind: doc
    title: Guide
    file: pages/guide.md
docs: { kind: system, repository: github.com/acme/shop, audience: engineers on call }
evidence:
  - { to: shop-api, files: [src/api/], commit: aaa1111 }
  - { to: guide#buy, files: [src/checkout.ts], commit: aaa1111 }
  - { to: orders-db, files: [db/], commit: bbb2222 }
`;
const PAGE = '## Buy {#buy}\n\nThe [[shop-api]] takes the order.\n';
const changes = {
  repository: 'github.com/acme/shop',
  branch: 'main',
  head: 'ccc3333',
  commits: [
    { sha: 'aaa1111', title: 'start', files: [{ path: 'src/api/index.ts' }] },
    { sha: 'bbb2222', title: 'schema', files: [{ path: 'db/schema.sql' }] },
    { sha: 'ccc3333', at: '2026-11-21T10:00:00Z', title: 'fix(api): retry the charge', files: [{ path: 'src/api/charge.ts', patch: '@@ -1 +1 @@\n-once\n+retry' }, { path: 'README.md' }] },
  ],
};

describe('what may be stale in a document', () => {
  test('a git batch keeps the history, and the document reads exactly which ties a later commit touched, with the diff', async () => {
    const t = await testApp();
    const me = await t.bearer('author', { admin: true });
    const a = await agent(t, me.headers);
    const saved = await a.call('vantage_write', { writes: [{ address: '~/shop', text: YAML }, { address: '~/shop/pages/guide.md', text: PAGE }] });
    const ws = /saved (\S+)\/shop version/.exec(saved)![1]!;
    expect(await a.call('vantage_read', { addresses: [`${ws}/shop/stale`] })).toContain('The hub has no history for github.com/acme/shop');

    const created = await t.json(`/api/v1/workspaces/${ws}/connectors`, { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'Shop code', slug: 'shop-code', connector: 'push', clientId: 'c-git' }) });
    const pushed = await t.json(`/api/v1/connector/${created.body['id'] as string}/batches`, { method: 'POST', headers: await t.connector('c-git'), body: JSON.stringify({ partial: true, entities: [], changes: [changes] }) });
    expect(pushed.status).toBe(202);
    await createWorker(t.ctx).drain();

    expect(await a.call('vantage_outline', { address: `${ws}/shop` })).toContain(`docs: system; github.com/acme/shop; for engineers on call; 3 evidence ties, 1 may be stale: vantage_read ${ws}/shop/stale`);
    const stale = await a.call('vantage_read', { addresses: [`${ws}/shop/stale`] });
    expect(stale).toContain('1 of 3 ties may be stale');
    expect(stale).toContain('## shop-api');
    expect(stale).toContain('ccc3333 2026-11-21 fix(api): retry the charge: src/api/charge.ts');
    expect(stale).toContain('+retry');
    expect(stale).not.toContain('README.md');
    expect(stale).toContain('path: evidence.0.commit, value: ccc3333');

    await a.call('vantage_patch', { edits: [{ address: `${ws}/shop`, op: 'set', path: 'evidence.0.commit', value: 'ccc3333' }] });
    expect(await a.call('vantage_read', { addresses: [`${ws}/shop/stale`] })).toContain('0 of 3 ties may be stale');
    await t.ctx.db.close();
  });
});

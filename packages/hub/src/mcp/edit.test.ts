import { describe, expect, test } from 'bun:test';
import { TOOL_DOOR } from '@vantage/mcp';
import { testApp, SAMPLE_YAML } from '../testing.ts';
import { agent } from './testing.ts';

describe('changes by path', () => {
  test('a patch sets, adds, and removes by path over mcp, and the api edits the same way', async () => {
    const t = await testApp();
    const me = await t.bearer('agent');
    const a = await agent(t, me.headers);
    const slug = /saved (\S+)\/sample version/.exec(await a.call('vantage_write', { writes: [{ address: '~/sample', text: SAMPLE_YAML }] }))![1]!;
    const doc = `${slug}/sample`;
    const history = async (): Promise<string[]> => (await a.call(TOOL_DOOR, { tool: 'vantage_history', arguments: { address: doc } })).split('\n');

    const edited = await a.call('vantage_patch', {
      message: 'add a cache',
      edits: [
        { address: doc, op: 'set', path: 'nodes.shop-api.subtitle', value: 'bun service' },
        { address: doc, op: 'add', path: 'nodes', value: { name: 'Cache', type: 'cache' } },
        { address: doc, op: 'add', path: 'relations', value: { from: 'shop-api', to: 'cache', label: 'reads', tags: ['context'] } },
      ],
    });
    expect(edited).toContain(`http://hub.test/w/${slug}/sample`);
    const after = await a.call('vantage_read', { addresses: [doc] });
    expect(after).toContain('subtitle: bun service');
    expect(after).toContain('  - name: Cache\n    type: cache\n');
    expect(after).toContain('relations:\n  - { from: shoppers, to: shop-api, label: buys, tags: [context] }\n  - { from: shop-api, to: orders-db, label: writes, tags: [context] }\n  - {from: shop-api, to: cache, label: reads, tags: [context]}\nviews:');
    expect(await history()).toHaveLength(2);
    expect((await history())[0]).toContain('add a cache');

    // One edit that fails leaves the document as it was: the edit before it is not saved either.
    const failed = await a.attempt('vantage_patch', { edits: [{ address: doc, op: 'set', path: 'title', value: 'Lost' }, { address: doc, op: 'remove', path: 'views.nope' }] });
    expect(failed.isError).toBe(true);
    expect(failed.text).toContain('edit 2');
    expect(failed.text).toContain('views has no item nope');
    expect(await history()).toHaveLength(2);
    expect(await a.call('vantage_read', { addresses: [`${doc}#L1`] })).toContain('title: Sample');

    const api = await t.json(`/api/v1/workspaces/${slug}/documents/sample/edits`, { method: 'POST', headers: me.headers, body: JSON.stringify({ operations: [{ op: 'remove', path: 'nodes.cache' }, { op: 'remove', path: 'relations.2' }] }) });
    expect(api.status).toBe(200);
    expect(api.body['status']).toBe('saved');
    expect((api.body['version'] as { message: string }).message).toBe('edit: remove nodes.cache; remove relations.2');
    const bad = await t.json(`/api/v1/workspaces/${slug}/documents/sample/edits`, { method: 'POST', headers: me.headers, body: JSON.stringify({ operations: [{ op: 'remove', path: 'nodes.cache' }] }) });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('operation 0');
    await t.ctx.db.close();
  });
});

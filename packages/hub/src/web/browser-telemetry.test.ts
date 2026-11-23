import { describe, expect, test } from 'bun:test';
import { fakeFetch, testApp } from '../testing.ts';
import { MAX_BATCH_BYTES, ownBatch, WEB_APP_NAME } from './browser-telemetry.ts';

describe('browser telemetry', () => {
  test('a batch becomes the hub web client, with the signed-in user and never a claimed one', () => {
    const own = ownBatch(JSON.stringify({ meta: { app: { name: 'evil', version: '1' }, user: { email: 'claimed@example.com' } }, events: [] }), 'u1');
    expect(own?.meta).toEqual({ app: { name: WEB_APP_NAME, version: '1' }, user: { id: 'u1' } });
    expect(ownBatch(JSON.stringify({ meta: { user: { id: 'x' } } }), undefined)?.meta).toEqual({ app: { name: WEB_APP_NAME } });
    expect(ownBatch('[]', 'u1')).toBeNull();
    expect(ownBatch('not json', 'u1')).toBeNull();
  });

  test('the relay hands a batch to the collector with the key, and drops it without one', async () => {
    const collector = fakeFetch([{ match: 'faro.test', status: 200, json: {} }]);
    const relayed = await testApp({ env: { FARO_URL: 'http://faro.test/collect', FARO_API_KEY: 'k' }, fetch: collector.fetch });
    const res = await relayed.app.request('/api/telemetry', { method: 'POST', body: JSON.stringify({ meta: {}, events: [] }) });
    expect(res.status).toBe(202);
    expect(collector.calls).toHaveLength(1);
    expect(JSON.parse(collector.calls[0]!.body!).meta.app.name).toBe(WEB_APP_NAME);
    await relayed.ctx.db.close();

    const dropped = await testApp();
    expect((await dropped.app.request('/api/telemetry', { method: 'POST', body: '{}' })).status).toBe(202);
    expect((await dropped.app.request('/api/telemetry', { method: 'POST', body: '[]' })).status).toBe(400);
    expect((await dropped.app.request('/api/telemetry', { method: 'POST', body: 'x'.repeat(MAX_BATCH_BYTES + 1) })).status).toBe(413);
    await dropped.ctx.db.close();
  });
});

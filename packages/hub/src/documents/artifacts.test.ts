import { describe, expect, test } from 'bun:test';
import { testApp, SAMPLE_YAML } from '../testing.ts';
import { agent } from '../mcp/testing.ts';

const SPEC = '# Specification\n\n## Orders {#orders}\n\nEvery order has a number.\n';
const TIES = JSON.stringify({ 'shop-api': ['SPEC-12', 'SPEC-13'] });
const YAML = `${SAMPLE_YAML}artifacts:\n  - { file: artifacts/SPEC.md, title: Specification, about: The analyzer writes it }\n  - { file: artifacts/ties.json, title: Box ties }\n`;

describe('artifacts: files a document keeps and never draws', () => {
  test('a save keeps them, a reader reads one back from the head, and a page address reads a Markdown one', async () => {
    const t = await testApp();
    const me = await t.bearer('author', { admin: true });
    const a = await agent(t, me.headers);
    const saved = await a.call('vantage_write', {
      writes: [{ address: '~/shop', text: YAML }, { address: '~/shop/artifacts/SPEC.md', text: SPEC }],
      assets: { 'artifacts/ties.json': Buffer.from(TIES).toString('base64') },
    });
    expect(saved).toContain('saved ');
    const ws = /saved (\S+)\/shop version/.exec(saved)![1]!;
    const res = await t.app.request(`/api/v1/text/file?address=${ws}/shop/artifacts/ties.json`, { headers: me.headers });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.text()).toBe(TIES);
    expect(await a.call('vantage_read', { addresses: [`${ws}/shop/artifacts/SPEC.md#orders`] })).toContain('Every order has a number.');
    await t.ctx.db.close();
  });

  test('an artifact the document lists and does not carry refuses the save, and so does one outside artifacts/', async () => {
    const t = await testApp();
    const me = await t.bearer('author', { admin: true });
    const a = await agent(t, me.headers);
    const missing = (await a.attempt('vantage_write', { writes: [{ address: '~/shop', text: `${SAMPLE_YAML}artifacts:\n  - { file: artifacts/SPEC.md }\n` }] })).text;
    expect(missing).toContain('artifact-missing');
    const outside = (await a.attempt('vantage_write', { writes: [{ address: '~/shop', text: `${SAMPLE_YAML}artifacts:\n  - { file: SPEC.json }\n` }] })).text;
    expect(outside).toContain('artifact-path');
    await t.ctx.db.close();
  });
});

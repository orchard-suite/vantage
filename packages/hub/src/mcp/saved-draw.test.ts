import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOL_DOOR } from '@vantage/mcp';
import { testApp, SAMPLE_YAML } from '../testing.ts';
import { agent, laptop } from './testing.ts';

/** A saved document draws by its address in every format, theme, and title block a file does (VAN-5002, VAN-5003). */
describe('a saved document drawn by its address', () => {
  test('on the laptop, render and export write every format to a path, with themes and the title block', async () => {
    const t = await testApp();
    const me = await t.bearer('agent');
    const { call } = await laptop(t, { url: 'http://hub.test', token: me.token });
    const saved = await call('vantage_write', { writes: [{ address: '~/sample', text: SAMPLE_YAML }] });
    const doc = `${/saved (\S+)\/sample version/.exec(saved)![1]!}/sample`;
    const dir = mkdtempSync(join(tmpdir(), 'vantage-draw-'));
    const at = (name: string): Buffer => readFileSync(join(dir, name));

    for (const [format, magic] of [['pdf', '%PDF'], ['vsdx', 'PK'], ['drawio', '<mxfile']] as const) {
      expect(await call('vantage_render', { address: doc, format, out: join(dir, `one.${format}`) })).toContain('wrote');
      expect(at(`one.${format}`).subarray(0, 600).toString('latin1')).toContain(magic);
      expect(await call('vantage_export', { address: doc, format, out: join(dir, `all.${format}`) })).toContain('wrote');
      expect(at(`all.${format}`).subarray(0, 600).toString('latin1')).toContain(magic);
    }
    expect(await call('vantage_export', { address: doc, format: 'html', out: join(dir, 'all.html') })).toContain('wrote');
    expect(at('all.html').toString()).toContain('<html');

    const svg = async (args: Record<string, unknown>, name: string): Promise<string> => {
      await call('vantage_render', { address: doc, format: 'svg', out: join(dir, name), ...args });
      return at(name).toString();
    };
    const light = await svg({ theme: 'light' }, 'light.svg');
    expect(await svg({ theme: 'print' }, 'print.svg')).not.toBe(light);
    expect(await svg({ theme: 'colorblind' }, 'colorblind.svg')).not.toBe(light);
    expect(await svg({ titleBlock: { title: 'Quarterly Shop Review' } }, 'block.svg')).toContain('Quarterly Shop Review');
    await t.ctx.db.close();
  });

  test('on the hub, with no disk, a render and an export answer the file', async () => {
    const t = await testApp();
    const me = await t.bearer('agent');
    const a = await agent(t, me.headers);
    const saved = await a.call('vantage_write', { writes: [{ address: '~/sample', text: SAMPLE_YAML }] });
    const doc = `${/saved (\S+)\/sample version/.exec(saved)![1]!}/sample`;
    const blob = async (name: string, args: Record<string, unknown>): Promise<string> => {
      const r = await a.client.callTool({ name: TOOL_DOOR, arguments: { tool: name, arguments: args } });
      expect(r.isError).not.toBe(true);
      const res = (r.content as { type: string; resource?: { blob?: string } }[]).find((c) => c.type === 'resource');
      return Buffer.from(res!.resource!.blob!, 'base64').subarray(0, 4).toString();
    };
    expect(await blob('vantage_export', { address: doc, format: 'pdf' })).toBe('%PDF');
    const r = await a.client.callTool({ name: 'vantage_render', arguments: { address: doc, format: 'pdf', theme: 'print' } });
    const res = (r.content as { type: string; resource?: { blob?: string } }[]).find((c) => c.type === 'resource');
    expect(Buffer.from(res!.resource!.blob!, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    await t.ctx.db.close();
  });
});

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOL_DOOR } from '@vantage/mcp';
import { testApp, SAMPLE_YAML } from '../testing.ts';
import { laptop } from './testing.ts';

const SVG_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#123456"/></svg>';

/** A picture never passes through the model on its way to the hub (VAN-5003). */
describe('a workspace icon on the laptop', () => {
  test('is put by its path, and the bridge sends the bytes', async () => {
    const t = await testApp();
    const me = await t.bearer('agent');
    const { call, calls } = await laptop(t, { url: 'http://hub.test', token: me.token });
    const saved = await call('vantage_write', { writes: [{ address: '~/sample', text: SAMPLE_YAML }] });
    const ws = /saved (\S+)\/sample version/.exec(saved)![1]!;
    const dir = mkdtempSync(join(tmpdir(), 'vantage-icon-'));
    writeFileSync(join(dir, 'logo.svg'), SVG_ICON.repeat(20));
    const put = await call(TOOL_DOOR, { tool: 'vantage_workspace_icons', arguments: { workspace: ws, action: 'put', id: 'acme/logo', file: join(dir, 'logo.svg') } });
    expect(put).toContain('stored acme/logo');
    expect(calls.at(-1)!.charsIn).toBeLessThan(300);
    expect(await call(TOOL_DOOR, { tool: 'vantage_workspace_icons', arguments: { workspace: ws, action: 'list' } })).toContain(`acme/logo (image/svg+xml, ${SVG_ICON.length * 20} bytes)`);
    await t.ctx.db.close();
  });
});

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CORE, LAPTOP_CORE, TOOL_DOOR } from '@vantage/mcp';
import { testApp, SAMPLE_YAML } from '../testing.ts';
import { laptop } from './testing.ts';

const WITH_PAGE = `${SAMPLE_YAML}  - id: guide
    kind: doc
    title: Guide
    file: pages/guide.md
    beside: context
`;
const GUIDE = '# Guide\n\n## Orders\n\nThe [[shop-api]] takes orders.\n\n## Refunds\n\nNot yet.\n';

const agentThroughBridge = laptop;

const text = (r: Record<string, unknown>): string => (r['content'] as { text?: string }[]).map((c) => c.text ?? '').join('\n');

describe('the laptop bridge', () => {
  test('lists the core, the working copy, and the door, and sends the instructions the hub would', async () => {
    const t = await testApp();
    const me = await t.bearer('agent');
    const { client, call } = await agentThroughBridge(t, { url: 'http://hub.test', token: me.token });
    const tools = (await client.listTools()).tools;
    expect(tools.map((x) => x.name)).toEqual([...CORE, ...LAPTOP_CORE, TOOL_DOOR]);
    // The laptop's own tools keep their paths: a file to draw, a file to write from.
    expect(Object.keys(tools.find((x) => x.name === 'vantage_render')!.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(['file', 'address', 'out']));
    expect(JSON.stringify(tools.find((x) => x.name === 'vantage_write')!.inputSchema)).toContain('"file"');
    expect(client.getInstructions()).toContain('vantage_checkout');
    expect(await call(TOOL_DOOR, {})).toContain('vantage_export');
    expect(await call('vantage_validate', { text: SAMPLE_YAML })).toContain('ok');
    await t.ctx.db.close();
  });

  test('a file is written, checked out, edited on disk, and synced without its text passing through a tool call', async () => {
    const t = await testApp();
    const me = await t.bearer('agent');
    const { call, calls } = await agentThroughBridge(t, { url: 'http://hub.test', token: me.token });
    const dir = mkdtempSync(join(tmpdir(), 'vantage-wc-'));
    writeFileSync(join(dir, 'in.yaml'), WITH_PAGE);
    writeFileSync(join(dir, 'in.md'), GUIDE);
    const saved = await call('vantage_write', { writes: [{ address: '~/sample', file: join(dir, 'in.yaml') }, { address: '~/sample/pages/guide.md', file: join(dir, 'in.md') }] });
    const ws = /saved (\S+)\/sample version/.exec(saved)![1]!;
    // The model sent two paths; the bridge sent the bytes.
    expect(calls.at(-1)!.charsIn).toBeLessThan(400);

    const wc = join(dir, 'wc');
    const out = await call('vantage_checkout', { address: `${ws}/sample`, dir: wc });
    expect(out).toContain('2 files');
    const yamlPath = join(wc, ws, 'sample', 'sample.vantage.yaml');
    const pagePath = join(wc, ws, 'sample', 'pages', 'guide.md');
    expect(readFileSync(yamlPath, 'utf8')).toBe(WITH_PAGE);
    expect(readFileSync(pagePath, 'utf8')).toBe(GUIDE);
    // The files draw where they lie.
    expect(await call('vantage_validate', { file: yamlPath })).toContain('ok');
    // A saved document draws by its address, and its picture goes to a file, not into the conversation.
    const drawn = await call('vantage_render', { address: `${ws}/sample`, view: 'context', out: join(dir, 'context.png') });
    expect(drawn).toMatch(/view context: \d+x\d+, score/);
    expect(drawn).toContain(`wrote ${join(dir, 'context.png')}`);
    expect(readFileSync(join(dir, 'context.png')).subarray(1, 4).toString()).toBe('PNG');

    writeFileSync(pagePath, GUIDE.replace('Not yet.', 'Within a day.'));
    writeFileSync(yamlPath, WITH_PAGE.replace('node service', 'bun service'));
    const synced = await call('vantage_sync', { dir: wc, message: 'two lines' });
    expect(synced).toMatch(new RegExp(`saved ${ws}/sample version`));
    expect(calls.at(-1)!.charsIn).toBeLessThan(300);
    expect(await call('vantage_read', { addresses: [`${ws}/sample#nodes.shop-api`, `${ws}/sample/pages/guide.md#refunds`] })).toContain('Within a day.');
    expect(await call(TOOL_DOOR, { tool: 'vantage_history', arguments: { address: `${ws}/sample` } }).then((h) => h.split('\n').length)).toBe(2);
    expect(await call('vantage_sync', { dir: wc })).toContain('nothing here changed');

    // The hub changes one line and the laptop another line of the same page: both land.
    await call('vantage_patch', { edits: [{ address: `${ws}/sample/pages/guide.md`, old: 'takes orders.', new: 'takes orders and returns.' }] });
    writeFileSync(pagePath, readFileSync(pagePath, 'utf8').replace('Within a day.', 'Within an hour.'));
    expect(await call('vantage_sync', { dir: wc })).toContain('merged');
    expect(readFileSync(pagePath, 'utf8')).toBe(GUIDE.replace('takes orders.', 'takes orders and returns.').replace('Not yet.', 'Within an hour.'));

    // Both change the same line: the file gets both sides, nothing is saved, and the fixed file lands.
    await call('vantage_patch', { edits: [{ address: `${ws}/sample/pages/guide.md`, old: 'Within an hour.', new: 'Within a week.' }] });
    writeFileSync(pagePath, readFileSync(pagePath, 'utf8').replace('Within an hour.', 'Within a minute.'));
    const conflict = await call('vantage_sync', { dir: wc });
    expect(conflict).toContain('conflict in page pages/guide.md');
    const marked = readFileSync(pagePath, 'utf8');
    expect(marked).toContain('<<<<<<<');
    expect(marked).toContain('Within a week.');
    expect(marked).toContain('Within a minute.');
    writeFileSync(pagePath, GUIDE.replace('takes orders.', 'takes orders and returns.').replace('Not yet.', 'Within a minute.'));
    expect(await call('vantage_sync', { dir: wc })).toMatch(/saved \S+\/sample version/);
    expect(await call('vantage_read', { addresses: [`${ws}/sample/pages/guide.md#refunds`] })).toContain('Within a minute.');

    // A picture is attached by its path.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    mkdirSync(join(wc, ws, 'sample', 'assets'), { recursive: true });
    writeFileSync(join(wc, ws, 'sample', 'assets', 'screen.png'), png);
    writeFileSync(pagePath, `${readFileSync(pagePath, 'utf8')}\n![The screen](assets/screen.png)\n`);
    expect(await call('vantage_sync', { dir: wc })).toMatch(/saved \S+\/sample version/);
    expect(await call('vantage_outline', { address: `${ws}/sample` })).toContain('files: assets/screen.png');
    await t.ctx.db.close();
  });

  test('a folder of records comes in by its path, and a registry is a folder of files', async () => {
    const t = await testApp();
    const me = await t.bearer('agent');
    const { call, calls } = await agentThroughBridge(t, { url: 'http://hub.test', token: me.token });
    const ws = /^\s+(\S+)\s/m.exec((await call('vantage_outline', {})).split('\n')[1]!)![1]!;
    await call(TOOL_DOOR, { tool: 'vantage_registries', arguments: { action: 'create', workspace: ws, prefix: 'SHOP', name: 'Shop decisions' } });
    const dir = mkdtempSync(join(tmpdir(), 'vantage-adr-'));
    const record = (n: string, title: string) => `# ADR-${n}: ${title}\n\n| | |\n|---|---|\n| **Decision Date** | 2026-11-01 |\n| **Decision Maker** | The maintainers |\n\n## Status\n\nAccepted\n\n## Context\n\n${'Two apps wrote to the orders store. '.repeat(40)}\n\n## Decision\n\nOnly the Shop API writes orders.\n\n## Consequences\n\nOne writer.\n`;
    writeFileSync(join(dir, '2001-one-writer.md'), record('2001', 'Orders go through one API'));
    writeFileSync(join(dir, '2002-one-reader.md'), record('2002', 'Reports read a copy'));
    const imported = await call(TOOL_DOOR, { tool: 'vantage_decision_import', arguments: { registry: 'SHOP', dir } });
    expect(imported).toContain('Imported 2 into SHOP');
    // About three thousand characters of records moved; the call carried a path.
    expect(calls.at(-1)!.charsIn).toBeLessThan(300);

    const wc = join(dir, 'wc');
    expect(await call('vantage_checkout', { address: 'SHOP', dir: wc })).toContain('2 files');
    const files = readdirSync(join(wc, 'decisions', 'SHOP')).sort();
    expect(files).toEqual(['2001-orders-go-through-one-api.md', '2002-reports-read-a-copy.md']);
    const path = join(wc, 'decisions', 'SHOP', files[0]!);
    // The header carries the record's permanent id, and a sync reads past it.
    expect(readFileSync(path, 'utf8')).toMatch(/^record: SHOP-2001\nid: adr:[0-9A-HJKMNP-TV-Z]{26}\n/m);
    writeFileSync(path, readFileSync(path, 'utf8').replace('Only the Shop API writes orders.', 'Only the Shop API writes orders, through one queue.'));
    writeFileSync(join(wc, 'decisions', 'SHOP', 'new.md'), '---\ntitle: Refunds go through the same API\nstatus: proposed\ncategory: 2\ndecided: 2026-11-21\ndeciders: [The maintainers]\n---\n\n## Context\n\nRefunds were written by hand.\n\n## Decision\n\nThe Shop API writes refunds.\n\n## Consequences\n\nOne writer.\n');
    const synced = await call('vantage_sync', { dir: wc });
    expect(synced).toContain('saved SHOP-2001 (decision)');
    expect(synced).toContain('created SHOP-2003: Refunds go through the same API');
    expect(existsSync(join(wc, 'decisions', 'SHOP', '2003-refunds-go-through-the-same-api.md'))).toBe(true);
    expect(existsSync(join(wc, 'decisions', 'SHOP', 'new.md'))).toBe(false);
    expect(await call('vantage_sync', { dir: wc })).toContain('nothing here changed');
    expect(await call('vantage_read', { addresses: ['SHOP-2001#decision'] })).toContain('through one queue.');
    expect(await call('vantage_read', { addresses: ['SHOP-2001'] })).toMatch(/^id: adr:[0-9A-HJKMNP-TV-Z]{26}$/m);
    await t.ctx.db.close();
  });

  test('a hub that cannot be reached leaves the local tools and the guide working and says why a hub call failed', async () => {
    const { client, logs, call } = await agentThroughBridge(undefined, { url: 'http://hub.test', token: 'x' });
    const tools = (await client.listTools()).tools.map((x) => x.name);
    expect(tools).toContain('vantage_render');
    expect(tools).not.toContain('vantage_patch');
    expect(logs.some((l) => l.includes('unreachable'))).toBe(true);
    expect(await call('vantage_validate', { text: SAMPLE_YAML })).toContain('ok');
    expect(await call('vantage_read', { addresses: ['guide#relations'] })).toContain('## Relations');
  });

  test('a revoked token fails the hub call with the way back', async () => {
    const t = await testApp();
    const me = await t.bearer('agent');
    const { client } = await agentThroughBridge(t, { url: 'http://hub.test', token: me.token });
    await client.listTools();
    await t.ctx.db.query('update tokens set revoked_at = now()');
    const r = await client.callTool({ name: 'vantage_outline', arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('vantage login http://hub.test');
    await t.ctx.db.close();
  });
});

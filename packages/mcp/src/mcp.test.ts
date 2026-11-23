import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './server.ts';
import { join } from 'node:path';
import { rmSync, statSync } from 'node:fs';

const shop = join(import.meta.dir, '..', '..', '..', 'examples', 'shop', 'shop.vantage.yaml');

describe('mcp', () => {
  test('exposes the tools and renders an image with notes', async () => {
    const server = createMcpServer();
    const client = new Client({ name: 'test', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(['vantage_explore', 'vantage_export', 'vantage_icons', 'vantage_import', 'vantage_outline', 'vantage_read', 'vantage_render', 'vantage_validate']);
    const v = await client.callTool({ name: 'vantage_validate', arguments: { file: shop } });
    expect((v.content as { text: string }[])[0]!.text).toContain('ok: 22 nodes');
    const r = await client.callTool({ name: 'vantage_render', arguments: { file: shop, view: 'context', scale: 1 } });
    const content = r.content as { type: string; mimeType?: string; text?: string }[];
    expect(content[0]!.type).toBe('image');
    expect(content[0]!.mimeType).toBe('image/png');
    expect(content[1]!.text).toContain('score');
    const pdf = await client.callTool({ name: 'vantage_render', arguments: { file: shop, view: 'context', format: 'pdf', titleBlock: { title: 'Shop' } } });
    const pdfContent = pdf.content as { type: string; resource?: { mimeType: string; blob: string } }[];
    expect(pdfContent[0]!.type).toBe('resource');
    expect(pdfContent[0]!.resource!.mimeType).toBe('application/pdf');
    expect(Buffer.from(pdfContent[0]!.resource!.blob, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    const drawio = await client.callTool({ name: 'vantage_render', arguments: { file: shop, view: 'context', format: 'drawio' } });
    expect((drawio.content as { text: string }[])[0]!.text).toContain('<mxfile');
    const out = join(import.meta.dir, '..', '..', '..', 'out', 'mcp-test.vsdx');
    const exported = await client.callTool({ name: 'vantage_export', arguments: { file: shop, out, format: 'vsdx', views: ['context', 'data'] } });
    expect((exported.content as { text: string }[])[0]!.text).toContain('2 views');
    expect(statSync(out).size).toBeGreaterThan(1000);
    rmSync(out);
    const bad = await client.callTool({ name: 'vantage_validate', arguments: { text: 'nodes: [' } });
    expect(bad.isError).toBe(true);
    const drawing = join(import.meta.dir, '..', '..', 'import', 'fixtures', 'flat.drawio');
    const imported = await client.callTool({ name: 'vantage_import', arguments: { file: drawing } });
    const importedText = imported.content as { text: string }[];
    expect(importedText[0]!.text).toContain('name: Browser');
    expect(importedText[1]!.text).toContain('Order Flow: 7 shapes');
    expect(imported.isError).toBe(false);
    await client.close();
  });

  test('a server without file access has no import tool', async () => {
    const server = createMcpServer({ files: false });
    const client = new Client({ name: 'test', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).not.toContain('vantage_import');
    await client.close();
  });
});

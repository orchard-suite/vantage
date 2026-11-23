import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { testApp } from '../testing.ts';

describe('mcp stream', () => {
  test('a stateless server refuses the GET stream, so a client asks once and stops', async () => {
    const t = await testApp();
    const me = await t.bearer('agent');
    const direct = await t.app.request('/mcp', { method: 'GET', headers: { ...me.headers, accept: 'text/event-stream' } });
    expect(direct.status).toBe(405);
    expect(direct.headers.get('allow')).toBe('POST');

    let gets = 0;
    const fetchViaApp = (input: string | URL, init?: RequestInit): Promise<Response> => {
      if ((init?.method ?? 'GET') === 'GET') gets++;
      return Promise.resolve(t.app.request(String(input), init));
    };
    const transport = new StreamableHTTPClientTransport(new URL('http://hub.test/mcp'), { fetch: fetchViaApp, requestInit: { headers: me.headers } });
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(transport);
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    // The SDK reopens an ended stream after a second; past that, a refused one is still asked for only once.
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    expect(gets).toBe(1);
    await client.close();
    await t.ctx.db.close();
  });
});

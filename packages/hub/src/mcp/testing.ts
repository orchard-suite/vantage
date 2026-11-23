/** An MCP client over the test app's own /mcp route, with what it sent and received counted. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBridge, type CallMeasure, type HubLink } from '@vantage/mcp';
import type { TestApp } from '../testing.ts';

export interface Agent {
  readonly client: Client;
  /** Calls a tool and answers its text; throws when the tool answered an error. */
  call(name: string, args?: Record<string, unknown>): Promise<string>;
  /** The same, and answers an error as text. */
  attempt(name: string, args?: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  /** Characters of arguments sent and of text answered, and calls made, since the last reset. */
  readonly cost: { in: number; out: number; calls: number };
  reset(): void;
}

export async function agent(t: TestApp, headers: Record<string, string>, query = ''): Promise<Agent> {
  const fetchViaApp = (input: string | URL, init?: RequestInit): Promise<Response> => Promise.resolve(t.app.request(String(input), init));
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://hub.test/mcp${query}`), { fetch: fetchViaApp, requestInit: { headers } }));
  const cost = { in: 0, out: 0, calls: 0 };
  const attempt = async (name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n');
    cost.in += JSON.stringify(args).length;
    cost.out += text.length;
    cost.calls += 1;
    return { text, isError: r.isError === true };
  };
  return {
    client,
    attempt,
    call: async (name, args) => {
      const r = await attempt(name, args);
      if (r.isError) throw new Error(`${name} answered an error: ${r.text}`);
      return r.text;
    },
    cost,
    reset: () => Object.assign(cost, { in: 0, out: 0, calls: 0 }),
  };
}

export interface Laptop {
  readonly client: Client;
  readonly logs: string[];
  /** Every call the bridge's door measured, in order. */
  readonly calls: CallMeasure[];
  call(name: string, args?: Record<string, unknown>): Promise<string>;
}

/** The laptop's bridge wired to the in-process hub, as an agent on a machine with a disk sees it. With no app, the hub cannot be reached. */
export async function laptop(t: TestApp | undefined, link: HubLink, opts: { renewEveryMs?: number } = {}): Promise<Laptop> {
  const logs: string[] = [];
  const calls: CallMeasure[] = [];
  const fetchViaApp = (input: string | URL, init?: RequestInit): Promise<Response> => {
    if (!t) throw new Error('connect ECONNREFUSED');
    return Promise.resolve(t.app.request(String(input).replace(link.url, ''), init));
  };
  const connectHub = async (l: HubLink): Promise<Client> => {
    if (!t) throw new Error('connect ECONNREFUSED');
    const transport = new StreamableHTTPClientTransport(new URL(`${l.url}/mcp?tools=all`), { fetch: (input, init) => Promise.resolve(t.app.request(String(input), init)), requestInit: { headers: { authorization: `Bearer ${l.token}` } } });
    const client = new Client({ name: 'bridge-test', version: '0' });
    await client.connect(transport);
    return client;
  };
  const bridge = await createBridge(link, { connectHub, fetch: fetchViaApp, log: (line) => logs.push(line), onCall: (m) => calls.push(m), ...opts });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await bridge.connect(a);
  const client = new Client({ name: 'agent', version: '0' });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<string> => ((await client.callTool({ name, arguments: args })).content as { text?: string }[]).map((c) => c.text ?? '').join('\n');
  return { client, logs, calls, call };
}

/**
 * The door an agent connects to. It lists the small core and one tool,
 * vantage_tool, that lists every other tool by group and calls it. Behind
 * it stands a backend that holds every tool. Each call is measured here,
 * once, whatever tool it reaches: the characters it took and the
 * characters it answered.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { GROUPS, groupOf } from './catalog.ts';

/** Whatever holds the tools: an MCP server in this process, a hub over HTTP, or both. */
export interface Backend {
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
}

/** One finished tool call, as the door saw it. */
export interface CallMeasure {
  readonly tool: string;
  /** True when the call came through vantage_tool. */
  readonly onDemand: boolean;
  readonly charsIn: number;
  /** Characters of text answered. */
  readonly charsOut: number;
  /** Characters of pictures and files answered, as base64. */
  readonly binaryOut: number;
  readonly ms: number;
  readonly isError: boolean;
}

export interface FrontOptions {
  readonly name: string;
  readonly version: string;
  readonly instructions: string;
  /** The tools always listed, in this order. */
  readonly core: readonly string[];
  /** List every tool and leave vantage_tool out, for a host that loads tools on demand itself. */
  readonly all?: boolean | undefined;
  readonly onCall?: ((m: CallMeasure) => void) | undefined;
}

export const TOOL_DOOR = 'vantage_tool';

const DOOR: Tool = {
  name: TOOL_DOOR,
  description: `Every other Vantage tool, by group: ${Object.entries(GROUPS)
    .map(([g, v]) => `${g} (${v.about})`)
    .join('; ')}. With nothing, lists the groups; with group, its tools; with tool, how to call it; with tool and arguments, calls it.`,
  inputSchema: {
    type: 'object',
    properties: {
      group: { type: 'string', description: 'List the tools of one group' },
      tool: { type: 'string', description: 'A tool name from a group' },
      arguments: { type: 'object', description: 'Call the tool with these; {} for a tool that takes none' },
    },
  },
};

const text = (t: string, isError = false): CallToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) });

const firstSentence = (s: string | undefined): string => (/^.*?[.:](?=\s|$)/.exec(s ?? '')?.[0] ?? s ?? '').trim();

function sizes(result: CallToolResult): { charsOut: number; binaryOut: number } {
  let charsOut = 0;
  let binaryOut = 0;
  for (const c of result.content ?? []) {
    if (c.type === 'text') charsOut += c.text.length;
    else if (c.type === 'image' || c.type === 'audio') binaryOut += c.data.length;
    else if (c.type === 'resource') binaryOut += 'blob' in c.resource ? c.resource.blob.length : c.resource.text.length;
  }
  return { charsOut, binaryOut };
}

export function createFront(backend: Backend, opts: FrontOptions): Server {
  const server = new Server({ name: opts.name, version: opts.version }, { capabilities: { tools: {} }, instructions: opts.instructions });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const every = await backend.listTools();
    if (opts.all) return { tools: every };
    const core = opts.core.map((n) => every.find((t) => t.name === n)).filter((t): t is Tool => t !== undefined);
    return { tools: [...core, DOOR] };
  });

  const door = async (args: { group?: unknown; tool?: unknown; arguments?: unknown }): Promise<{ result: CallToolResult; called?: string }> => {
    const every = (await backend.listTools()).filter((t) => !opts.core.includes(t.name));
    const inGroup = (g: string): Tool[] => every.filter((t) => (groupOf(t.name) ?? 'other') === g);
    if (typeof args.tool === 'string') {
      const tool = every.find((t) => t.name === args.tool);
      if (!tool) return { result: text(`no tool ${args.tool}; groups: ${Object.keys(GROUPS).join(', ')}`, true) };
      if (args.arguments === undefined) return { result: text(`${tool.name}: ${tool.description ?? ''}\narguments: ${JSON.stringify(tool.inputSchema)}`) };
      return { result: await backend.callTool(tool.name, (args.arguments ?? {}) as Record<string, unknown>), called: tool.name };
    }
    if (typeof args.group === 'string') {
      const tools = inGroup(args.group);
      if (!tools.length) return { result: text(`no group ${args.group}; groups: ${Object.keys(GROUPS).join(', ')}`, true) };
      return { result: text(tools.map((t) => `${t.name}: ${firstSentence(t.description)}`).join('\n')) };
    }
    const groups = [...Object.keys(GROUPS), 'other'].map((g) => ({ g, names: inGroup(g).map((t) => t.name) })).filter((x) => x.names.length);
    return { result: text(groups.map((x) => `${x.g}: ${x.names.join(', ')}`).join('\n')) };
  };

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const started = performance.now();
    let tool = name;
    let onDemand = false;
    let result: CallToolResult;
    try {
      if (name === TOOL_DOOR && !opts.all) {
        const d = await door(args);
        result = d.result;
        if (d.called) {
          tool = d.called;
          onDemand = true;
        }
      } else {
        result = await backend.callTool(name, args);
      }
    } catch (err) {
      result = text((err as Error).message, true);
    }
    opts.onCall?.({ tool, onDemand, charsIn: JSON.stringify(args).length, ...sizes(result), ms: Math.round(performance.now() - started), isError: result.isError === true });
    return result;
  });

  return server;
}

/** Several backends as one: a tool is listed once, and the first backend that holds a name answers for it. */
export function firstOf(backends: readonly Backend[]): Backend {
  let owner = new Map<string, Backend>();
  const list = async (): Promise<Tool[]> => {
    const next = new Map<string, Backend>();
    const out: Tool[] = [];
    for (const b of backends) {
      for (const t of await b.listTools()) {
        if (next.has(t.name)) continue;
        next.set(t.name, b);
        out.push(t);
      }
    }
    owner = next;
    return out;
  };
  return {
    listTools: list,
    async callTool(name, args) {
      if (!owner.has(name)) await list();
      const b = owner.get(name);
      if (!b) return text(`no tool ${name}`, true);
      return b.callTool(name, args);
    },
  };
}

/** A backend that can be let go of. */
export interface ClosableBackend extends Backend {
  close(): Promise<void>;
}

/** An MCP server in this process as a backend. It connects on first use. */
export function inProcess(server: McpServer): ClosableBackend {
  let client: Promise<Client> | undefined;
  const connected = (): Promise<Client> =>
    (client ??= (async () => {
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide);
      const c = new Client({ name: 'vantage-front', version: '1' });
      await c.connect(clientSide);
      return c;
    })());
  return {
    listTools: async () => (await (await connected()).listTools()).tools,
    callTool: async (name, args) => (await (await connected()).callTool({ name, arguments: args })) as CallToolResult,
    close: async () => {
      if (client) await (await client).close().catch(() => undefined);
      await server.close().catch(() => undefined);
    },
  };
}

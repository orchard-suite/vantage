/**
 * The stdio MCP server for a laptop. With no hub it serves the tools that
 * work on files and the guide. Once `vantage login` links a hub it is the
 * bridge: the same tools, every tool the hub has, and a path wherever a
 * tool takes content. VANTAGE_TOOLS=all lists every tool, for a host that
 * loads tools on demand itself.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerGuideDoor, registerLocalTools } from './tools.ts';
import { readHubLink } from './hub.ts';
import { createBridge, createLocalDoor } from './bridge.ts';

export interface McpOptions {
  /** Allow file path arguments; the stdio server on a laptop says yes, the hub says no. */
  readonly files?: boolean;
}

/** Every local tool on one server, with no door in front: for embedding and for tests. */
export function createMcpServer(opts: McpOptions = {}): McpServer {
  const server = new McpServer({ name: 'vantage', version: '1.0.0' });
  registerLocalTools(server, { files: opts.files ?? true });
  registerGuideDoor(server);
  return server;
}

export async function startMcp(env: Record<string, string | undefined> = process.env): Promise<void> {
  const all = env['VANTAGE_TOOLS'] === 'all';
  const link = readHubLink(env);
  if (!link) {
    await createLocalDoor({ all }).connect(new StdioServerTransport());
    return;
  }
  process.stderr.write(`vantage: local tools plus the hub at ${link.url}\n`);
  await (await createBridge(link, { all })).connect(new StdioServerTransport());
}

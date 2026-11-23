/**
 * MCP over streamable HTTP at /mcp, stateless: each request builds a
 * server bound to the bearer's principal, handles the message, and
 * closes. Bearer tokens only, a Vantage token or an access token the
 * OIDC issuer signed for this hub; browser sessions are not accepted here.
 * The resource metadata (RFC 9728) names the hub itself as the
 * authorization server, so an OAuth client signs a person in through the
 * hub (web/oauth-routes.ts).
 * With no session there is no stream for the server to push on and none
 * to end, so GET and DELETE answer 405, which tells a client to stop
 * asking; a GET stream would close with the request and the client would
 * reopen it at once, forever.
 */
import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { agentInstructions, CORE, createFront, inProcess, registerLocalTools, type CallMeasure, type LocalEngine } from '@vantage/mcp';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { Principal } from '../auth/principal.ts';
import { registerHubTools } from './tools.ts';
import { registerLiveTools } from './live-tools.ts';
import { registerReviewTools } from './review-tools.ts';
import { registerDecisionTools } from './decision-tools.ts';
import { registerTextTools } from './text-tools.ts';
import { registerItemTools } from './item-tools.ts';
import { savedDocuments } from './saved.ts';
import { MCP_SCOPE } from '../web/oauth-routes.ts';

export const MCP_SERVER_VERSION = '1.0.0';

/** The local tools' drawing, on the render pool. */
function poolEngine(ctx: AppContext): LocalEngine {
  return {
    render: (args) => ctx.render.run('localRender', args),
    explore: (args) => ctx.render.run('localExplore', args),
    validate: (args) => ctx.render.run('localValidate', args),
    exportDocument: (args) => ctx.render.run('localExport', args),
  };
}

export interface HubDoor {
  readonly server: Server;
  close(): Promise<void>;
}

/** Every tool the hub has, on one server; the door in front of it decides which an agent is shown. */
export function hubTools(ctx: AppContext, p: Principal): McpServer {
  const tools = new McpServer({ name: 'vantage-hub-tools', version: MCP_SERVER_VERSION });
  registerLocalTools(tools, { files: false, engine: poolEngine(ctx), saved: savedDocuments(ctx, p) });
  registerTextTools(tools, ctx, p);
  registerHubTools(tools, ctx, p);
  registerLiveTools(tools, ctx, p);
  registerReviewTools(tools, ctx, p);
  registerDecisionTools(tools, ctx, p);
  registerItemTools(tools, ctx, p);
  return tools;
}

/**
 * The door an agent connects to: the small core and vantage_tool, or every
 * tool when `all` is asked for. Every call is measured here, once: a log
 * line and two counters, by tool. No conversation is named.
 */
export function createHubMcpServer(ctx: AppContext, p: Principal, opts: { readonly all?: boolean } = {}): HubDoor {
  const log = ctx.log.child({ surface: 'mcp', userId: p.userId });
  const backend = inProcess(hubTools(ctx, p));
  const onCall = (m: CallMeasure): void => {
    log.info('mcp.tool', { tool: m.tool, listed: m.onDemand ? 'on_demand' : 'core', isError: m.isError, charsIn: m.charsIn, charsOut: m.charsOut, binaryOut: m.binaryOut, ms: m.ms });
    ctx.metrics.agentCalls.add(1, { tool: m.tool, outcome: m.isError ? 'error' : 'ok', listed: m.onDemand ? 'on_demand' : 'core' });
    ctx.metrics.agentChars.add(m.charsIn, { tool: m.tool, direction: 'in' });
    ctx.metrics.agentChars.add(m.charsOut, { tool: m.tool, direction: 'out' });
    if (m.binaryOut) ctx.metrics.agentChars.add(m.binaryOut, { tool: m.tool, direction: 'binary_out' });
  };
  const server = createFront(backend, { name: 'vantage-hub', version: MCP_SERVER_VERSION, instructions: agentInstructions(), core: CORE, all: opts.all, onCall });
  return { server, close: () => backend.close() };
}

export function mcpRoutes(ctx: AppContext): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  const metadataUrl = `${ctx.config.PUBLIC_URL}/.well-known/oauth-protected-resource/mcp`;
  const challenge = `Bearer realm="${ctx.config.PUBLIC_URL}/mcp", resource_metadata="${metadataUrl}"`;
  const metadata = { resource: `${ctx.config.PUBLIC_URL}/mcp`, authorization_servers: [ctx.config.PUBLIC_URL], scopes_supported: [MCP_SCOPE], bearer_methods_supported: ['header'] };
  app.get('/.well-known/oauth-protected-resource', (c) => c.json(metadata));
  app.get('/.well-known/oauth-protected-resource/mcp', (c) => c.json(metadata));
  app.all('/mcp', async (c) => {
    const p = c.get('principal');
    const agent = p && (p.via === 'token' || p.via === 'issuer');
    if (!agent) {
      ctx.log.info('mcp.unauthorized', { reason: p ? 'not a bearer token' : 'no credentials' });
      return c.json({ jsonrpc: '2.0', error: { code: -32001, message: 'bearer token required' }, id: null }, 401, { 'www-authenticate': challenge });
    }
    if (c.req.method === 'GET' || c.req.method === 'DELETE') {
      return c.json({ jsonrpc: '2.0', error: { code: -32000, message: 'method not allowed: this server is stateless and offers no stream' }, id: null }, 405, { allow: 'POST' });
    }
    // A client that lists tools on demand itself, or the laptop bridge, asks for every tool.
    const door = createHubMcpServer(ctx, p, { all: c.req.query('tools') === 'all' });
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await door.server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await door.server.close().catch(() => undefined);
      await door.close();
    }
  });
  return app;
}

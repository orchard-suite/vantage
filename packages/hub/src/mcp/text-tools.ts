/**
 * The five verbs every kind of content is reached through: outline, find,
 * read, patch, write. Their names and arguments are the shared definition
 * in @vantage/mcp; the work is in ../text.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FIND, OUTLINE, PATCH, READ, WRITE, WRITE_SHAPE } from '@vantage/mcp';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { parseAddress } from '../text/address.ts';
import { outline } from '../text/outline.ts';
import { find } from '../text/find.ts';
import { read } from '../text/read.ts';
import { changeText, patch, write } from '../text/change.ts';
import { guardFor, text } from './run.ts';

export function registerTextTools(server: McpServer, ctx: AppContext, p: Principal): void {
  const guarded = guardFor(ctx.log.child({ surface: 'mcp', userId: p.userId }));

  server.registerTool(
    OUTLINE.name,
    { description: OUTLINE.description, inputSchema: OUTLINE.shape },
    guarded<{ address?: string | undefined }>(OUTLINE.name, async ({ address }) => text(await outline(ctx, p, parseAddress(address)))),
  );

  server.registerTool(
    FIND.name,
    { description: FIND.description, inputSchema: FIND.shape },
    guarded<{ query: string; in?: string | undefined; regex?: boolean | undefined; count?: boolean | undefined }>(FIND.name, async (args) => text(await find(ctx, p, args))),
  );

  server.registerTool(
    READ.name,
    { description: READ.description, inputSchema: READ.shape },
    guarded<{ addresses: string[]; held?: Record<string, string> | undefined }>(READ.name, async ({ addresses, held }) => {
      const r = await read(ctx, p, addresses, held);
      return text(r.text, r.isError);
    }),
  );

  server.registerTool(
    PATCH.name,
    { description: PATCH.description, inputSchema: PATCH.shape },
    guarded<{ edits: Parameters<typeof patch>[2]; message?: string | undefined; minor?: boolean | undefined }>(PATCH.name, async ({ edits, message, minor }) => {
      const r = changeText(await patch(ctx, p, edits, { message, minor, surface: 'mcp' }));
      return text(r.text, r.isError);
    }),
  );

  server.registerTool(
    WRITE.name,
    { description: WRITE.description, inputSchema: WRITE_SHAPE },
    guarded<{ writes: { address: string; text: string }[]; assets?: Record<string, string> | undefined; message?: string | undefined }>(WRITE.name, async (args) => {
      const r = changeText(await write(ctx, p, args.writes, args.assets, { message: args.message, surface: 'mcp' }));
      return text(r.text, r.isError);
    }),
  );
}

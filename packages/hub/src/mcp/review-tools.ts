/**
 * The review tools: who a comment may mention, where the caller was
 * mentioned, and reactions on boxes. Each call runs as the bearer's
 * principal with the same checks as the API.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { requireWorkspace } from '../authz.ts';
import { documentBySlug } from '../documents/repo.ts';
import { HttpError } from '../http.ts';
import { guardFor } from './run.ts';
import { documentReaders, listMentions } from '../mentions.ts';
import { addReaction, listReactions, reactionsText, ReactionKindSchema, removeReaction, type ReactionKind } from '../reactions.ts';
import { clockOf } from '../day.ts';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) });

export function registerReviewTools(server: McpServer, ctx: AppContext, p: Principal): void {
  const log = ctx.log.child({ surface: 'mcp', userId: p.userId });
  const actor = { orgId: p.orgId, userId: p.userId, who: p.token ? `${p.userId} via token ${p.token.id}` : p.userId, surface: 'mcp' as const };
  const guarded = guardFor(log);
  const doc = async (workspace: string, document: string) => {
    const ws = await requireWorkspace(ctx.db, p, workspace, 'viewer');
    const d = await documentBySlug(ctx.db, ws.id, document);
    if (!d) throw new HttpError(404, `document ${workspace}/${document} not found`);
    return { workspace: ws, document: d };
  };
  const ref = { workspace: z.string().describe('Workspace slug'), document: z.string().describe('Document slug') };

  server.registerTool(
    'vantage_people',
    { description: 'People who can read a document, with the id to mention each in a comment as <@id>.', inputSchema: ref },
    guarded<{ workspace: string; document: string }>('vantage_people', async (args) => {
      const s = await doc(args.workspace, args.document);
      const people = await documentReaders(ctx.db, p.orgId, s.workspace.id);
      return text(people.map((r) => `<@${r.id}>  ${r.label}${r.email ? `  ${r.email}` : ''}`).join('\n') || 'nobody');
    }),
  );

  server.registerTool(
    'vantage_mentions',
    { description: 'Comments that mention the person you act for, newest first, each with its document, view, boxes, and a link that opens it.', inputSchema: { limit: z.number().int().min(1).max(200).optional() } },
    guarded<{ limit?: number | undefined }>('vantage_mentions', async ({ limit }) => {
      const rows = await listMentions(ctx, p, limit ?? 20);
      return text(rows.map((m) => `${m.commentId}  ${m.resolved ? 'resolved' : 'open'}  ${m.workspace}/${m.document} view=${m.view ?? '-'} boxes=${m.targets.join(',') || '-'}  by ${m.authorLabel ?? '-'}  ${clockOf(m.createdAt)}\n  ${m.text.replace(/\n/g, '\n  ')}\n  ${m.link}`).join('\n') || 'no mentions');
    }),
  );

  server.registerTool(
    'vantage_reactions',
    {
      description:
        'Reactions on boxes from review sessions: up (thumbs up), wrong (looks wrong), question. list shows each box with its counts and who, most flagged first; a box marked orphaned is no longer in the view. add puts your reaction on a box (wrong takes an optional sentence and also files a comment on the box); remove takes it off.',
      inputSchema: {
        ...ref,
        action: z.enum(['list', 'add', 'remove']),
        view: z.string().optional().describe('View id; filters list, required for add and remove'),
        box: z.string().optional().describe('Box id (node or group) in the view; for add and remove'),
        kind: ReactionKindSchema.optional().describe('up, wrong, or question; for add and remove'),
        text: z.string().optional().describe('For add with wrong: the sentence for its comment'),
      },
    },
    guarded<{ workspace: string; document: string; action: 'list' | 'add' | 'remove'; view?: string | undefined; box?: string | undefined; kind?: ReactionKind | undefined; text?: string | undefined }>('vantage_reactions', async (args) => {
      const s = await doc(args.workspace, args.document);
      if (args.action === 'list') return text(reactionsText(await listReactions(ctx, s.document, p.userId, args.view)));
      if (!args.view || !args.box || !args.kind) return text('view, box, and kind are required for add and remove', true);
      if (args.action === 'remove') {
        const removed = await removeReaction(ctx, actor, s.document.id, { view: args.view, box: args.box, kind: args.kind });
        return text(removed ? `removed ${args.kind} from ${args.view}/${args.box}` : `you had no ${args.kind} on ${args.view}/${args.box}`);
      }
      const r = await addReaction(ctx, actor, { workspace: s.workspace, document: s.document }, { view: args.view, box: args.box, kind: args.kind, ...(args.text !== undefined ? { text: args.text } : {}) });
      if (!r.added) return text(`you already had ${args.kind} on ${args.view}/${args.box}`);
      return text(`added ${args.kind} on ${args.view}/${args.box}${r.comment ? `; filed comment ${r.comment.id}` : ''}`);
    }),
  );
}

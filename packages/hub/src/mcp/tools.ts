/**
 * The document tools that are not text: delete, move, history, diff, a
 * workspace's icons, comments, and recordings, and the workspaces
 * themselves. Reading and writing are the
 * five verbs in text-tools.ts; review tools (people, mentions, reactions)
 * are in review-tools.ts. Each call runs as the bearer's principal.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { memberWorkspaces, requireDelete, requireWorkspace } from '../authz.ts';
import { moveDocument } from '../documents/move.ts';
import { moveRegistry } from '../decisions/registry-move.ts';
import { kindOfDocument } from '../tracking/kinds.ts';
import { createTeamWorkspace } from '../workspace-create.ts';
import { deleteDocument } from '../documents/delete.ts';
import { documentBySlug, headVersion, listVersions, versionById, type DocumentRow } from '../documents/repo.ts';
import { deleteWorkspaceIcon, iconType, listWorkspaceIcons, putWorkspaceIcon, ICON_TYPES } from '../workspace-icons.ts';
import { unifiedDiff } from '../documents/merge.ts';
import { listComments, mentionTokens, resolveComment } from '../comments.ts';
import { listRecordings } from '../recordings.ts';
import { postComment, renderMentions, userLabels } from '../mentions.ts';
import { HttpError } from '../http.ts';
import { decisionHistory } from '../decisions/read.ts';
import { parseAddress } from '../text/address.ts';
import { guardFor, text } from './run.ts';


interface Ref {
  readonly workspace: string;
  readonly document: string;
}

export function registerHubTools(server: McpServer, ctx: AppContext, p: Principal): void {
  const log = ctx.log.child({ surface: 'mcp', userId: p.userId });
  const who = p.token ? `${p.userId} via token ${p.token.id}` : p.userId;
  const guarded = guardFor(log);
  const doc = async (workspace: string, document: string, role: 'viewer' | 'author'): Promise<{ ws: Awaited<ReturnType<typeof requireWorkspace>>; d: DocumentRow }> => {
    const ws = await requireWorkspace(ctx.db, p, workspace, role);
    const d = await documentBySlug(ctx.db, ws.id, document);
    if (!d) throw new HttpError(404, `document ${workspace}/${document} not found`);
    return { ws, d };
  };
  const ref = { workspace: z.string().describe('Workspace slug'), document: z.string().describe('Document slug') };
  server.registerTool(
    'vantage_delete',
    {
      description:
        "Delete a document for good: its versions, comments, guest links, and publications go with it, and nothing brings it back. Only when the person asks to delete that diagram by name; never to clean up or to start over. The workspace's rule decides who may: by default the person who made it, the workspace owner, and org admins.",
      inputSchema: ref,
    },
    guarded<Ref>('vantage_delete', async ({ workspace, document }) => {
      const { ws, d } = await doc(workspace, document, 'author');
      requireDelete(p, ws, d.created_by);
      await deleteDocument(ctx, { orgId: p.orgId, userId: p.userId, who, surface: 'mcp' }, d);
      return text(`deleted ${ws.slug}/${d.slug} (${d.name})`);
    }),
  );

  server.registerTool(
    'vantage_move',
    {
      description:
        "Move a document, or a whole decision registry, to another workspace. A program keeps its diagrams, decisions, roadmap, and work in a workspace of its own; this is how they get there. A document keeps its id, versions, comments, guest links, and every link to its boxes; when it defines a kind of item, the kind and its items go with it; its old address stays an alias that sends people and tools to the new one. A registry keeps its prefix, so every citation still resolves. The caller must be able to delete the document where it is (the workspace's delete rule) and author where it goes.",
      inputSchema: {
        address: z.string().min(1).describe('workspace/document, or a registry prefix (KD)'),
        to: z.string().min(1).describe('Slug of the workspace it goes to'),
      },
    },
    guarded<{ address: string; to: string }>('vantage_move', async ({ address, to }) => {
      const slash = address.indexOf('/');
      if (slash < 0) {
        const r = await moveRegistry(ctx, p, who, address.trim().toUpperCase(), to);
        return text(r.from === r.to ? `registry ${r.prefix} is already in ${r.to}` : `moved registry ${r.prefix} (${r.records} records) from ${r.from} to ${r.to}; its citations are unchanged`);
      }
      const { ws, d } = await doc(address.slice(0, slash), address.slice(slash + 1), 'author');
      requireDelete(p, ws, d.created_by);
      const target = await requireWorkspace(ctx.db, p, to, 'author');
      const kind = await kindOfDocument(ctx.db, d.id);
      const moved = await moveDocument(ctx, { orgId: p.orgId, userId: p.userId, who, surface: 'mcp' }, d, target);
      const items = kind ? Number((await ctx.db.query<{ n: number }>('select count(*)::int as n from items where kind_id = $1', [kind.id]))[0]!.n) : 0;
      return text([`moved ${ws.slug}/${d.slug} to ${target.slug}/${moved.slug}; ${ws.slug}/${d.slug} now sends people and tools there`, ...(kind ? [`kind ${kind.prefix} and its ${items} items went with it`] : [])].join('\n'));
    }),
  );

  server.registerTool(
    'vantage_workspaces',
    {
      description:
        "The workspaces you may open, or make a team workspace you author. A program gets a workspace of its own for its diagrams, decisions, roadmap, and work; a platform gets one for what its programs share. Make one before writing a program's first document when none names it.",
      inputSchema: {
        action: z.enum(['list', 'create']).default('list'),
        name: z.string().min(1).max(120).optional().describe('For create: the display name'),
        slug: z.string().min(1).max(64).optional().describe('For create: the url slug; default the slug of the name'),
      },
    },
    guarded<{ action?: 'list' | 'create' | undefined; name?: string | undefined; slug?: string | undefined }>('vantage_workspaces', async (args) => {
      if (args.action === 'create') {
        if (!args.name) return text('name is required to make a workspace', true);
        const made = await createTeamWorkspace(ctx, p, who, { name: args.name, slug: args.slug });
        return text(`made workspace ${made.slug} (${made.name}); you are its author`);
      }
      const rows = await memberWorkspaces(ctx.db, p);
      return text(rows.map((w) => `${w.slug}  ${w.name}  (${w.kind}, ${w.role})`).join('\n') || 'no workspaces');
    }),
  );

  server.registerTool(
    'vantage_workspace_icons',
    {
      description: "The workspace's own icon pack: logos and marks every document in the workspace names as pack/name (acme/logo). List them, put one (an SVG or picture in base64; documents re-render), or delete one. Shipped pack names (generic, azure, aws, k8s, brand) are taken.",
      inputSchema: {
        workspace: z.string().describe('Workspace slug'),
        action: z.enum(['list', 'put', 'delete']),
        id: z.string().optional().describe('Icon id, pack/name; for put and delete'),
        data: z.string().optional().describe('The picture in base64; for put'),
        format: z.enum(['svg', 'png', 'jpg', 'gif', 'webp']).optional().describe('Picture format; for put, default svg'),
      },
    },
    guarded<{ workspace: string; action: 'list' | 'put' | 'delete'; id?: string | undefined; data?: string | undefined; format?: 'svg' | 'png' | 'jpg' | 'gif' | 'webp' | undefined }>('vantage_workspace_icons', async (args) => {
      const ws = await requireWorkspace(ctx.db, p, args.workspace, args.action === 'list' ? 'viewer' : 'author');
      const actor = { orgId: p.orgId, who, surface: 'mcp' as const };
      if (args.action === 'list') {
        const rows = await listWorkspaceIcons(ctx.db, ws.id);
        return text(rows.length ? rows.map((r) => `${r.id} (${r.content_type}, ${r.size} bytes)`).join('\n') : 'the workspace has no icons of its own');
      }
      if (!args.id) return text('id is required', true);
      if (args.action === 'delete') {
        await deleteWorkspaceIcon(ctx, actor, ws.id, args.id);
        return text(`deleted ${args.id}; documents in ${ws.slug} re-render`);
      }
      if (!args.data) return text('data is required for put', true);
      const type = iconType(undefined, `icon.${args.format ?? 'svg'}`);
      if (!type) return text(`format must be one of ${ICON_TYPES.join(', ')}`, true);
      const row = await putWorkspaceIcon(ctx, actor, ws.id, args.id, new Uint8Array(Buffer.from(args.data, 'base64')), type);
      return text(`stored ${row.id} (${row.content_type}, ${row.size} bytes); documents in ${ws.slug} re-render`);
    }),
  );

  server.registerTool(
    'vantage_history',
    { description: 'The versions of a document or the revisions of a decision record, newest first: when, who, and why.', inputSchema: { address: z.string().describe('workspace/document, or a record such as SHOP-2001'), limit: z.number().int().min(1).max(200).optional() } },
    guarded<{ address: string; limit?: number | undefined }>('vantage_history', async ({ address, limit }) => {
      const a = parseAddress(address);
      if (a.kind === 'record') {
        const revs = (await decisionHistory(ctx, p, a.ref)).slice(0, limit ?? 20);
        return text(revs.map((r) => `${r.createdAt}  ${r.author ?? '-'} (${r.surface})  ${r.message}`).join('\n') || 'no history');
      }
      if (a.kind !== 'document') return text('history is kept for a document (workspace/document) and for a record (SHOP-2001)', true);
      const { d } = await doc(a.workspace, a.document, 'viewer');
      const versions = await listVersions(ctx.db, d.id, limit ?? 20);
      return text(versions.map((v) => `${v.id}  ${v.created_at.toISOString()}  ${v.surface}  ${v.author_user_id ?? '-'}  ${v.message || '(no message)'}${v.parent_id ? '' : '  [root]'}`).join('\n') || 'no versions');
    }),
  );

  server.registerTool(
    'vantage_diff',
    { description: 'Unified diff between two versions; defaults to the head and its parent.', inputSchema: { ...ref, from: z.string().optional(), to: z.string().optional() } },
    guarded<Ref & { from?: string | undefined; to?: string | undefined }>('vantage_diff', async (args) => {
      const { d } = await doc(args.workspace, args.document, 'viewer');
      const to = args.to ? await versionById(ctx.db, args.to) : await headVersion(ctx.db, d);
      if (!to || to.document_id !== d.id) return text('version not found', true);
      const from = args.from ? await versionById(ctx.db, args.from) : to.parent_id ? await versionById(ctx.db, to.parent_id) : undefined;
      if (from && from.document_id !== d.id) return text('version not found', true);
      return text(unifiedDiff(from ? `version ${from.id}` : 'empty', from?.yaml ?? '', `version ${to.id}`, to.yaml));
    }),
  );

  server.registerTool(
    'vantage_comments',
    { description: 'Comments on a document; open ones by default.', inputSchema: { ...ref, view: z.string().optional(), include_resolved: z.boolean().optional() } },
    guarded<Ref & { view?: string | undefined; include_resolved?: boolean | undefined }>('vantage_comments', async (args) => {
      const { d } = await doc(args.workspace, args.document, 'viewer');
      const rows = await listComments(ctx.db, d.id, { view: args.view, open: !args.include_resolved });
      const labels = await userLabels(ctx.db, rows.flatMap((c) => mentionTokens(c.text)));
      const mentions = (c: (typeof rows)[number]): string => {
        const ids = mentionTokens(c.text);
        return ids.length ? `  mentions=${ids.map((id) => `${labels.get(id) ?? id} <@${id}>`).join(',')}` : '';
      };
      return text(rows.map((c) => `${c.id}  ${c.resolved_at ? 'resolved' : 'open'}  view=${c.view_id ?? '-'} boxes=${c.targets.join(',') || '-'}  by ${c.author_user_id ?? '-'}${mentions(c)}\n  ${renderMentions(c.text, labels).replace(/\n/g, '\n  ')}`).join('\n') || 'no comments');
    }),
  );

  server.registerTool(
    'vantage_recordings',
    { description: 'Voice walkthroughs recorded over a document: per recording its view, length, steps, author, and whether it was made on an older version. Recording and playback happen in the hub viewer.', inputSchema: { ...ref, view: z.string().optional() } },
    guarded<Ref & { view?: string | undefined }>('vantage_recordings', async (args) => {
      const { d } = await doc(args.workspace, args.document, 'viewer');
      const rows = await listRecordings(ctx.db, d.id, { view: args.view });
      const len = (ms: number): string => `${Math.floor(ms / 60_000)}:${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}`;
      return text(rows.map((r) => `${r.id}  view=${r.view_id}  ${len(r.duration_ms)}  ${r.timeline.length} steps  by ${r.author_user_id ?? '-'}  ${r.version_id === d.head_version_id ? 'current version' : `older version ${r.version_id}`}  ${r.created_at.toISOString()}`).join('\n') || 'no recordings');
    }),
  );

  server.registerTool(
    'vantage_comment',
    {
      description:
        'Add a comment to a document, a view, or boxes in a view. A comment on boxes names the view and the ids of the nodes or groups it is about. To mention a person, write <@id> or <@email> in the text with an id from vantage_people; they are told by the hub. Only people who can read the document can be mentioned; any other mention refuses the comment.',
      inputSchema: { ...ref, text: z.string().describe('The comment; <@id> mentions a person'), view: z.string().optional(), targets: z.array(z.string()).optional().describe('Ids of the nodes or groups in the view the comment is about') },
    },
    guarded<Ref & { text: string; view?: string | undefined; targets?: string[] | undefined }>('vantage_comment', async (args) => {
      const { ws, d } = await doc(args.workspace, args.document, 'viewer');
      const r = await postComment(ctx, { orgId: p.orgId, userId: p.userId, who, surface: 'mcp' }, { workspace: ws, document: d }, { text: args.text, viewId: args.view, targets: args.targets });
      return text(`comment ${r.comment.id} added${r.notified.length ? `; told ${r.notified.length} mentioned ${r.notified.length === 1 ? 'person' : 'people'}` : ''}`);
    }),
  );

  server.registerTool(
    'vantage_resolve_comment',
    { description: 'Resolve a comment after addressing it.', inputSchema: { ...ref, comment: z.string() } },
    guarded<Ref & { comment: string }>('vantage_resolve_comment', async (args) => {
      const { d } = await doc(args.workspace, args.document, 'viewer');
      await resolveComment(ctx.db, ctx.log, { orgId: p.orgId, userId: p.userId, who, surface: 'mcp' }, d.id, args.comment, true);
      return text(`comment ${args.comment} resolved`);
    }),
  );
}

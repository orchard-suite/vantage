/**
 * Review: the people a comment may mention, where the caller was
 * mentioned, and reactions on boxes. Each document route comes twice, by
 * workspace and slug for scripts and agents, and by document id for the
 * hub viewer.
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, principal, scopedDocument, scopedDocumentById, who, type DocumentScope } from './common.ts';
import type { Actor } from '../comments.ts';
import { publicComment } from '../comments.ts';
import { documentReaders, listMentions, type MentionScope } from '../mentions.ts';
import { addReaction, listReactions, NewReactionSchema, ReactionKindSchema, removeReaction } from '../reactions.ts';
import type { Principal } from '../auth/principal.ts';

const BY_SLUG = '/workspaces/:workspace/documents/:doc';
const BY_ID = '/documents/:id';

export function reviewActor(p: Principal): Actor {
  return { orgId: p.orgId, userId: p.userId, who: who(p), surface: p.surface };
}

export function mentionScope(s: DocumentScope): MentionScope & { document: DocumentScope['document'] } {
  return { workspace: { id: s.workspace.id, slug: s.workspace.slug }, document: s.document };
}

export function reviewRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  reg.add({ method: 'get', path: '/me/mentions', summary: 'Comments that mention the caller, newest first, with a link to the view and box; only in documents the caller may still read', tag: 'comments', query: ['limit'] });
  app.get('/me/mentions', async (c) => {
    const p = principal(c);
    const mentions = await listMentions(ctx, p, Number(c.req.query('limit') ?? 50));
    ctx.log.debug('mentions.list', { userId: p.userId, count: mentions.length });
    return c.json({ mentions });
  });

  for (const [base, params, scoped] of [
    [BY_SLUG, ['workspace', 'doc'], (c: Context<HubEnv>) => scopedDocument(ctx, c, 'viewer')],
    [BY_ID, ['id'], (c: Context<HubEnv>) => scopedDocumentById(ctx, c, 'viewer')],
  ] as const) {
    reg.add({ method: 'get', path: `${base}/people`, summary: 'People who can read the document, so a comment can mention them as <@id>', tag: 'comments', params: [...params], auth: 'viewer' });
    app.get(`${base}/people`, async (c) => {
      const s = await scoped(c);
      const people = await documentReaders(ctx.db, s.p.orgId, s.workspace.id);
      return c.json({ people: people.map((r) => ({ id: r.id, label: r.label })) });
    });

    reg.add({ method: 'get', path: `${base}/reactions`, summary: 'Reactions on boxes, one entry per box, most flagged first; orphaned when the box is no longer in the view', tag: 'reactions', params: [...params], query: ['view'], auth: 'viewer' });
    app.get(`${base}/reactions`, async (c) => {
      const s = await scoped(c);
      return c.json({ reactions: await listReactions(ctx, s.document, s.p.userId, c.req.query('view')) });
    });

    reg.add({ method: 'post', path: `${base}/reactions`, summary: 'Put a reaction on a box: up, wrong (looks wrong), or question. "wrong" takes an optional sentence and files a comment on the box', tag: 'reactions', params: [...params], body: { view: 'view id', box: 'box id (node or group) in the view', kind: 'up, wrong, or question', text: 'optional, for wrong: the sentence for its comment' }, auth: 'viewer', responses: { '201': 'added', '200': 'already there' } });
    app.post(`${base}/reactions`, async (c) => {
      const s = await scoped(c);
      const input = await body(c, NewReactionSchema);
      const r = await addReaction(ctx, reviewActor(s.p), mentionScope(s), input);
      return c.json({ added: r.added, ...(r.comment ? { comment: publicComment(r.comment) } : {}) }, r.added ? 201 : 200);
    });

    reg.add({ method: 'delete', path: `${base}/reactions`, summary: "Take the caller's reaction off a box; a comment it filed stays", tag: 'reactions', params: [...params], body: { view: 'view id', box: 'box id', kind: 'up, wrong, or question' }, auth: 'viewer', responses: { '200': 'removed tells whether there was one' } });
    app.delete(`${base}/reactions`, async (c) => {
      const s = await scoped(c);
      const input = await body(c, z.object({ view: z.string().min(1).max(200), box: z.string().min(1).max(200), kind: ReactionKindSchema }));
      return c.json({ removed: await removeReaction(ctx, reviewActor(s.p), s.document.id, input) });
    });
  }

  return app;
}

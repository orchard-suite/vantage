/** Search, comments, guest links, and the audit list. */
import { searchDecisions } from '../decisions/read.ts';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, principal, scopedDocument, who } from './common.ts';
import { searchDocuments } from '../search.ts';
import { COMMENT_TARGETS, deleteComment, listComments, publicComment, resolveComment } from '../comments.ts';
import { editComment, postComment } from '../mentions.ts';
import { mentionScope } from './review.ts';
import { createGuestLink, guestLinksAllowed, listGuestLinks, publicGuestLink, revokeGuestLink } from '../guest.ts';
import { listAudit } from '../audit.ts';
import { requireAdmin, requireWorkspace } from '../authz.ts';
import { forbidden } from '../http.ts';

const DOC = '/workspaces/:workspace/documents/:doc';

export function collabRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  reg.add({ method: 'get', path: '/search', summary: 'Full-text search across names, subtitles, facts, descriptions, questions, and view titles (hits), and decision records (decisions), scoped to the workspaces the caller owns or was shared', tag: 'search', query: ['q', 'limit'] });
  app.get('/search', async (c) => {
    const p = principal(c);
    const q = c.req.query('q') ?? '';
    const limit = Number(c.req.query('limit') ?? 20);
    const [hits, decisions] = await Promise.all([searchDocuments(ctx.dbRead, p, q, limit), searchDecisions(ctx, p, q, limit)]);
    ctx.log.info('search', { userId: p.userId, query: q, hits: hits.length, decisions: decisions.length });
    return c.json({ query: q, hits, decisions });
  });

  reg.add({ method: 'get', path: `${DOC}/comments`, summary: 'Comments on a document; ?view= and ?open=true filter', tag: 'comments', params: ['workspace', 'doc'], query: ['view', 'open'], auth: 'viewer' });
  app.get(`${DOC}/comments`, async (c) => {
    const { document } = await scopedDocument(ctx, c, 'viewer');
    const rows = await listComments(ctx.db, document.id, { view: c.req.query('view'), open: c.req.query('open') === 'true' });
    return c.json({ comments: rows.map(publicComment) });
  });

  reg.add({ method: 'post', path: `${DOC}/comments`, summary: 'Add a comment to a document, a view, or boxes in a view. <@id> or <@email> in the text mentions a person who can read the document (see .../people) and tells them; a mention of anyone else is refused with 400', tag: 'comments', params: ['workspace', 'doc'], body: { text: 'markdown; <@id> mentions a person', view: 'optional view id', targets: 'optional box ids (nodes and groups) in the view' }, auth: 'viewer', responses: { '201': 'created; mentions lists the user ids it names', '400': 'a mention names someone who cannot read the document' } });
  app.post(`${DOC}/comments`, async (c) => {
    const s = await scopedDocument(ctx, c, 'viewer');
    const input = await body(c, z.object({ text: z.string().min(1).max(10_000), view: z.string().optional(), targets: COMMENT_TARGETS }));
    const { comment } = await postComment(ctx, actor(s.p), mentionScope(s), { text: input.text, viewId: input.view, targets: input.targets });
    return c.json(publicComment(comment), 201);
  });

  reg.add({ method: 'patch', path: `${DOC}/comments/:comment`, summary: 'Edit the text of a comment; only people it newly mentions are told', tag: 'comments', params: ['workspace', 'doc', 'comment'], body: { text: 'markdown; <@id> mentions a person' }, auth: 'viewer', responses: { '200': 'changed', '400': 'a mention names someone who cannot read the document' } });
  app.patch(`${DOC}/comments/:comment`, async (c) => {
    const s = await scopedDocument(ctx, c, 'viewer');
    const input = await body(c, z.object({ text: z.string().min(1).max(10_000) }));
    const existing = (await listComments(ctx.db, s.document.id)).find((x) => x.id === c.req.param('comment'));
    if (existing && existing.author_user_id !== s.p.userId && !s.p.admin) throw forbidden('only the author may edit a comment');
    return c.json(publicComment((await editComment(ctx, actor(s.p), mentionScope(s), c.req.param('comment'), input.text)).comment));
  });

  reg.add({ method: 'post', path: `${DOC}/comments/:comment/resolve`, summary: 'Resolve (or reopen with {"resolved": false}) a comment', tag: 'comments', params: ['workspace', 'doc', 'comment'], body: { resolved: 'true or false' }, auth: 'viewer' });
  app.post(`${DOC}/comments/:comment/resolve`, async (c) => {
    const { p, document } = await scopedDocument(ctx, c, 'viewer');
    const input = await body(c, z.object({ resolved: z.boolean().default(true) }));
    return c.json(publicComment(await resolveComment(ctx.db, ctx.log, actor(p), document.id, c.req.param('comment'), input.resolved)));
  });

  reg.add({ method: 'delete', path: `${DOC}/comments/:comment`, summary: 'Delete a comment', tag: 'comments', params: ['workspace', 'doc', 'comment'], auth: 'author', responses: { '204': 'deleted' } });
  app.delete(`${DOC}/comments/:comment`, async (c) => {
    const { p, document } = await scopedDocument(ctx, c, 'author');
    await deleteComment(ctx.db, ctx.log, actor(p), document.id, c.req.param('comment'));
    return c.body(null, 204);
  });

  reg.add({ method: 'get', path: `${DOC}/guest-links`, summary: 'Guest links of a document', tag: 'guest-links', params: ['workspace', 'doc'], auth: 'author' });
  app.get(`${DOC}/guest-links`, async (c) => {
    const { document } = await scopedDocument(ctx, c, 'author');
    return c.json({ guestLinks: (await listGuestLinks(ctx.db, document.id)).map(publicGuestLink) });
  });

  reg.add({ method: 'post', path: `${DOC}/guest-links`, summary: 'Create a signed guest link with expiry and optional passcode and view', tag: 'guest-links', params: ['workspace', 'doc'], body: { expiresInHours: 'default 168', passcode: 'optional', view: 'optional view id to limit to' }, auth: 'author', responses: { '201': 'created with url' } });
  app.post(`${DOC}/guest-links`, async (c) => {
    const { p, workspace, document } = await scopedDocument(ctx, c, 'author');
    if (!guestLinksAllowed(ctx.config, workspace)) throw forbidden(ctx.config.GUEST_LINKS ? 'guest links are disabled for this workspace' : 'guest links are turned off on this hub');
    const input = await body(c, z.object({ expiresInHours: z.number().min(1).max(24 * 365).default(168), passcode: z.string().min(4).max(100).optional(), view: z.string().optional() }));
    const { row, token } = await createGuestLink(ctx.db, ctx.log, ctx.config.SESSION_SECRET, { orgId: p.orgId, documentId: document.id, viewId: input.view, createdBy: p.userId, expiresAt: new Date(Date.now() + input.expiresInHours * 3_600_000), passcode: input.passcode }, p.surface);
    return c.json({ ...publicGuestLink(row), url: `${ctx.config.PUBLIC_URL}/g/${token}` }, 201);
  });

  reg.add({ method: 'delete', path: `${DOC}/guest-links/:link`, summary: 'Revoke a guest link', tag: 'guest-links', params: ['workspace', 'doc', 'link'], auth: 'author', responses: { '204': 'revoked' } });
  app.delete(`${DOC}/guest-links/:link`, async (c) => {
    const { p, document } = await scopedDocument(ctx, c, 'author');
    await revokeGuestLink(ctx.db, ctx.log, p.orgId, document.id, c.req.param('link'), who(p), p.surface);
    return c.body(null, 204);
  });

  reg.add({ method: 'get', path: '/audit', summary: 'Audit entries, newest first; admins see the org, authors see their workspace with ?workspace=', tag: 'audit', query: ['workspace', 'target', 'limit', 'before'] });
  app.get('/audit', async (c) => {
    const p = principal(c);
    const limit = Number(c.req.query('limit') ?? 100);
    const before = c.req.query('before') ? new Date(c.req.query('before')!) : undefined;
    const workspace = c.req.query('workspace');
    if (workspace) {
      const ws = await requireWorkspace(ctx.db, p, workspace, 'author');
      const docIds = (await ctx.db.query<{ id: string }>('select id from documents where workspace_id = $1', [ws.id])).map((d) => d.id);
      const rows = (await listAudit(ctx.db, p.orgId, { limit: 500, ...(before ? { before } : {}) })).filter((r) => r.target === `workspace:${ws.id}` || docIds.some((d) => r.target === `document:${d}`)).slice(0, limit);
      return c.json({ audit: rows });
    }
    requireAdmin(p);
    return c.json({ audit: await listAudit(ctx.db, p.orgId, { limit, ...(c.req.query('target') ? { target: c.req.query('target')! } : {}), ...(before ? { before } : {}) }) });
  });

  return app;
}

function actor(p: { orgId: string; userId: string; surface: import('../audit.ts').Surface; token?: { id: string } }): { orgId: string; userId: string; who: string; surface: import('../audit.ts').Surface } {
  return { orgId: p.orgId, userId: p.userId, who: p.token ? `${p.userId} via token ${p.token.id}` : p.userId, surface: p.surface };
}

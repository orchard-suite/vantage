/**
 * What the hub viewer calls, scoped by document id: steer edits, comments
 * with open counts, version history with scores, the visual diff of one
 * view between two versions, and restore.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, scopedDocumentById, who } from './common.ts';
import { headVersion, versionById, type VersionSummary } from '../documents/repo.ts';
import { saveDocument } from '../documents/save.ts';
import { applySteer, SteerActionSchema } from '../documents/steer.ts';
import { visualDiff } from '../documents/visual-diff.ts';
import { COMMENT_TARGETS, listComments, mentionTokens, publicComment, resolveComment, type CommentRow } from '../comments.ts';
import { postComment, userLabels } from '../mentions.ts';
import { mentionScope, reviewActor } from './review.ts';
import { saveJson, summary } from './documents.ts';
import { REFUSED, REFUSES } from '../documents/check.ts';
import { HttpError, notFound } from '../http.ts';

const DOC = '/documents/:id';

export interface OpenCounts {
  readonly total: number;
  readonly byView: Record<string, number>;
  readonly byNode: Record<string, number>;
}

/** Unresolved comments per view and per box; a comment on boxes counts once for its view and once for each box. */
export function openCounts(rows: readonly CommentRow[]): OpenCounts {
  const byView: Record<string, number> = {};
  const byNode: Record<string, number> = {};
  let total = 0;
  for (const c of rows) {
    if (c.resolved_at) continue;
    total++;
    if (c.view_id) byView[c.view_id] = (byView[c.view_id] ?? 0) + 1;
    for (const t of c.targets) byNode[t] = (byNode[t] ?? 0) + 1;
  }
  return { total, byView, byNode };
}

export function viewerRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  reg.add({ method: 'post', path: `${DOC}/steer`, summary: `Apply one steering action to the head YAML and save it as a version; 409 when expectedVersion is not the head. ${REFUSES}`, tag: 'steer', params: ['id'], body: { action: 'one of order, collapse, expand, hide, arrange, note, question, bind', expectedVersion: 'the version the viewer shows' }, auth: 'author', responses: { '200': 'saved', '409': 'the document moved; reload', ...REFUSED } });
  app.post(`${DOC}/steer`, async (c) => {
    const { p, workspace, document } = await scopedDocumentById(ctx, c, 'author');
    const input = await body(c, z.object({ action: SteerActionSchema, expectedVersion: z.string().min(1) }));
    const head = await headVersion(ctx.db, document);
    if (!head) throw notFound('version');
    if (head.id !== input.expectedVersion) {
      ctx.log.info('steer.stale', { documentId: document.id, head: head.id, expected: input.expectedVersion });
      throw new HttpError(409, 'the document changed since this view loaded', { head: summary(head) });
    }
    const steered = applySteer(head.yaml, input.action);
    const r = await saveDocument(ctx, { orgId: p.orgId, workspaceId: workspace.id, documentId: document.id, yaml: steered.yaml, message: steered.message, expectedVersionId: head.id, authorUserId: p.userId, who: who(p), surface: p.surface });
    ctx.log.info('steer.applied', { documentId: document.id, kind: input.action.kind, status: r.status, by: p.userId });
    return c.json({ ...saveJson(r), message: steered.message }, r.status === 'conflict' ? 409 : 200);
  });

  reg.add({ method: 'post', path: `${DOC}/restore`, summary: `Save the YAML of an older version as a new version. ${REFUSES}`, tag: 'versions', params: ['id'], body: { version: 'the version to restore', expectedVersion: 'the version the viewer shows' }, auth: 'author', responses: { '200': 'saved', '409': 'the document moved; reload', ...REFUSED } });
  app.post(`${DOC}/restore`, async (c) => {
    const { p, workspace, document } = await scopedDocumentById(ctx, c, 'author');
    const input = await body(c, z.object({ version: z.string().min(1), expectedVersion: z.string().min(1) }));
    const head = await headVersion(ctx.db, document);
    if (!head) throw notFound('version');
    if (head.id !== input.expectedVersion) throw new HttpError(409, 'the document changed since this view loaded', { head: summary(head) });
    const v = await versionById(ctx.db, input.version);
    if (!v || v.document_id !== document.id) throw notFound('version');
    const r = await saveDocument(ctx, { orgId: p.orgId, workspaceId: workspace.id, documentId: document.id, yaml: v.yaml, imports: v.imports, pins: v.pins, attachments: v.attachments, message: `restore: version ${v.id}`, expectedVersionId: head.id, authorUserId: p.userId, who: who(p), surface: p.surface });
    ctx.log.info('version.restored', { documentId: document.id, from: v.id, status: r.status, by: p.userId });
    return c.json(saveJson(r), r.status === 'conflict' ? 409 : 200);
  });

  reg.add({ method: 'get', path: `${DOC}/comments`, summary: 'Comments on a document with open counts per view and node', tag: 'comments', params: ['id'], auth: 'viewer' });
  app.get(`${DOC}/comments`, async (c) => {
    const { document } = await scopedDocumentById(ctx, c, 'viewer');
    const rows = await listComments(ctx.db, document.id);
    const labels = await userLabels(ctx.db, rows.flatMap((r) => [r.author_user_id, ...mentionTokens(r.text)]));
    const label = (id: string | null): string | null => (id ? labels.get(id) ?? null : null);
    return c.json({ comments: rows.map((r) => ({ ...publicComment(r), authorLabel: label(r.author_user_id), mentionLabels: Object.fromEntries(mentionTokens(r.text).map((id) => [id, label(id) ?? id])) })), counts: openCounts(rows) });
  });

  reg.add({ method: 'post', path: `${DOC}/comments`, summary: 'Add a comment to a view or to boxes in it; <@id> mentions a person who can read the document and tells them', tag: 'comments', params: ['id'], body: { text: 'markdown; <@id> mentions a person', view: 'view id', targets: 'optional box ids (nodes and groups) in the view' }, auth: 'viewer', responses: { '201': 'created', '400': 'a mention names someone who cannot read the document' } });
  app.post(`${DOC}/comments`, async (c) => {
    const s = await scopedDocumentById(ctx, c, 'viewer');
    const input = await body(c, z.object({ text: z.string().min(1).max(10_000), view: z.string().min(1), targets: COMMENT_TARGETS }));
    const { comment } = await postComment(ctx, reviewActor(s.p), mentionScope(s), { text: input.text, viewId: input.view, targets: input.targets });
    return c.json(publicComment(comment), 201);
  });

  reg.add({ method: 'post', path: `${DOC}/comments/:comment/resolve`, summary: 'Resolve or reopen a comment', tag: 'comments', params: ['id', 'comment'], body: { resolved: 'true or false' }, auth: 'viewer' });
  app.post(`${DOC}/comments/:comment/resolve`, async (c) => {
    const { p, document } = await scopedDocumentById(ctx, c, 'viewer');
    const input = await body(c, z.object({ resolved: z.boolean().default(true) }));
    const row = await resolveComment(ctx.db, ctx.log, { orgId: p.orgId, userId: p.userId, who: who(p), surface: p.surface }, document.id, c.req.param('comment'), input.resolved);
    return c.json(publicComment(row));
  });

  reg.add({ method: 'get', path: `${DOC}/versions`, summary: 'Version history, newest first, with author label and layout score per view', tag: 'versions', params: ['id'], query: ['limit'], auth: 'viewer' });
  app.get(`${DOC}/versions`, async (c) => {
    const { document } = await scopedDocumentById(ctx, c, 'viewer');
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50)));
    const rows = await ctx.db.query<VersionSummary & { author_label: string | null }>(
      'select v.id, v.org_id, v.document_id, v.hash, v.author_user_id, v.surface, v.message, v.parent_id, v.scores, v.created_at, coalesce(u.display_name, u.subject) as author_label from versions v left join users u on u.id = v.author_user_id where v.document_id = $1 order by v.created_at desc limit $2',
      [document.id, limit],
    );
    return c.json({ head: document.head_version_id, versions: rows.map((v) => ({ ...summary(v), authorLabel: v.author_label })) });
  });

  reg.add({ method: 'get', path: `${DOC}/diff/:a/:b/:file`, summary: 'Visual diff of one view from version a to version b: <view>.svg is the picture with the narrative, <view>.json is the change list', tag: 'versions', params: ['id', 'a', 'b', 'file'], query: ['theme'], auth: 'viewer' });
  app.get(`${DOC}/diff/:a/:b/:file{[^/]+\\.(svg|json)}`, async (c) => {
    const { document } = await scopedDocumentById(ctx, c, 'viewer');
    const from = await versionById(ctx.db, c.req.param('a'));
    const to = await versionById(ctx.db, c.req.param('b'));
    if (!from || !to || from.document_id !== document.id || to.document_id !== document.id) throw notFound('version');
    const file = c.req.param('file');
    const dot = file.lastIndexOf('.');
    const view = file.slice(0, dot);
    const d = await visualDiff(ctx, document, from, to, view, c.req.query('theme') === 'dark' ? 'dark' : 'light');
    ctx.log.debug('diff.visual', { documentId: document.id, from: from.id, to: to.id, view, changes: d.changes.length });
    if (file.endsWith('.json')) return c.json({ from: from.id, to: to.id, view, changes: d.changes });
    return c.body(d.svg, 200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'private, max-age=31536000, immutable' });
  });

  return app;
}

/**
 * Editing a document's YAML in the viewer, scoped by document id and open
 * to its authors only: the head text, a draw of unsaved text with the
 * document's own imports, pictures, and icons, a save with optimistic
 * concurrency, and the YAML-aware merge of an edit over a head that moved.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, scopedDocumentById, who, type DocumentScope } from './common.ts';
import { saveJson } from './documents.ts';
import { REFUSED, REFUSES } from '../documents/check.ts';
import { MAX_PREVIEW_CHARS } from './preview.ts';
import { headVersion, versionById, type VersionRow } from '../documents/repo.ts';
import { saveDocument } from '../documents/save.ts';
import { mergeYaml } from '../documents/merge.ts';
import { resourceInputs } from '../documents/assets.ts';
import { notFound } from '../http.ts';

const DOC = '/documents/:id';

/** The version message when the author leaves it empty. */
export const DEFAULT_EDIT_MESSAGE = 'edit YAML in the browser';

const DraftBody = z.object({ yaml: z.string().max(MAX_PREVIEW_CHARS), view: z.string().max(200).optional(), theme: z.enum(['light', 'dark']).optional() });
const SaveBody = z.object({ yaml: z.string().min(1).max(5_000_000), message: z.string().max(2000).optional(), expectedVersion: z.string().min(1) });
const MergeBody = z.object({ yaml: z.string().min(1).max(5_000_000), base: z.string().min(1) });

export function editorRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  const head = async (scope: DocumentScope): Promise<VersionRow> => {
    const v = await headVersion(ctx.db, scope.document);
    if (!v) throw notFound('version');
    return v;
  };

  reg.add({ method: 'get', path: `${DOC}/source`, summary: 'The head version and its YAML, for the editor', tag: 'documents', params: ['id'], auth: 'author' });
  app.get(`${DOC}/source`, async (c) => {
    const v = await head(await scopedDocumentById(ctx, c, 'author'));
    return c.json({ version: v.id, yaml: v.yaml });
  });

  reg.add({ method: 'post', path: `${DOC}/preview`, summary: "Draw one view of unsaved YAML with the document's imports, pictures, and workspace icons: the picture as the viewer's stage takes it, its layout score and notes, and the checker diagnostics with their lines; nothing is stored", tag: 'documents', params: ['id'], body: { yaml: 'the edited .vantage.yaml text', view: 'optional view id; defaults to the first view', theme: 'light or dark' }, auth: 'author' });
  app.post(`${DOC}/preview`, async (c) => {
    const scope = await scopedDocumentById(ctx, c, 'author');
    const input = await body(c, DraftBody);
    const v = await head(scope);
    const started = performance.now();
    const resources = await resourceInputs(ctx, { orgId: scope.document.org_id, workspaceId: scope.document.workspace_id, attachments: v.attachments });
    const out = await ctx.render.run('preview', { yaml: input.yaml, imports: v.imports, resources, view: input.view, theme: input.theme ?? 'light', entry: true });
    ctx.log.debug('source.preview', { documentId: scope.document.id, userId: scope.p.userId, chars: input.yaml.length, ms: Math.round(performance.now() - started), ok: out.svg !== null, errors: out.diagnostics.filter((d) => d.severity === 'error').length });
    return c.json(out);
  });

  reg.add({ method: 'post', path: `${DOC}/source`, summary: `Save edited YAML as a new version with a message; merged when the head moved since expectedVersion, 409 with the merged text and its conflict markers when both changed the same lines. ${REFUSES}`, tag: 'documents', params: ['id'], body: { yaml: 'the edited .vantage.yaml text', message: 'the version message', expectedVersion: 'the version the edit started from' }, auth: 'author', responses: { '200': 'saved, unchanged, or merged; a merge answers the saved text as yaml', '409': 'conflict: preview holds the text with conflict markers, head the version to edit from', ...REFUSED } });
  app.post(`${DOC}/source`, async (c) => {
    const { p, workspace, document } = await scopedDocumentById(ctx, c, 'author');
    const input = await body(c, SaveBody);
    const message = input.message?.trim() || DEFAULT_EDIT_MESSAGE;
    const r = await saveDocument(ctx, { orgId: p.orgId, workspaceId: workspace.id, documentId: document.id, yaml: input.yaml, message, expectedVersionId: input.expectedVersion, authorUserId: p.userId, writer: p, who: who(p), surface: p.surface });
    ctx.log.info('source.saved', { documentId: document.id, status: r.status, merged: r.status === 'saved' && r.merged, expected: input.expectedVersion, by: p.userId });
    if (r.status === 'conflict') return c.json(saveJson(r), 409);
    return c.json({ ...saveJson(r), ...(r.status === 'saved' && r.merged ? { yaml: r.version.yaml } : {}) });
  });

  reg.add({ method: 'post', path: `${DOC}/merge`, summary: 'Merge an edit made from version base over the head, the way a save merges, without saving: the merged text, or the text with conflict markers and their count', tag: 'documents', params: ['id'], body: { yaml: 'the edited text', base: 'the version the edit started from' }, auth: 'author', responses: { '200': 'status current, merged, or conflict, with head and yaml' } });
  app.post(`${DOC}/merge`, async (c) => {
    const scope = await scopedDocumentById(ctx, c, 'author');
    const input = await body(c, MergeBody);
    const h = await head(scope);
    if (h.id === input.base) return c.json({ status: 'current', head: h.id, yaml: input.yaml, conflicts: 0 });
    const base = await versionById(ctx.db, input.base);
    if (!base || base.document_id !== scope.document.id) throw notFound('version');
    const m = mergeYaml(base.yaml, h.yaml, input.yaml);
    ctx.log.info('source.merge', { documentId: scope.document.id, head: h.id, base: base.id, ok: m.ok, conflicts: m.ok ? 0 : m.conflicts, by: scope.p.userId });
    return c.json(m.ok ? { status: 'merged', head: h.id, yaml: m.text, conflicts: 0 } : { status: 'conflict', head: h.id, yaml: m.preview, conflicts: m.conflicts });
  });

  return app;
}

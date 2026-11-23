/** Documents, versions, diffs, and artifacts. */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, scopedDocument, scopedDocumentById, who, type DocumentScope } from './common.ts';
import { mayDeleteDocument, requireDelete, requireWorkspace } from '../authz.ts';
import { deleteDocument } from '../documents/delete.ts';
import { moveDocument } from '../documents/move.ts';
import { artifactsFor, documentBySlug, headVersion, listDocuments, listVersions, versionById, type ArtifactKind, type ArtifactRow, type VersionSummary } from '../documents/repo.ts';
import { enqueue } from '../worker/jobs.ts';
import { plainBytes, storedArtifact } from '../documents/derived.ts';
import { saveDocument, type SaveResult } from '../documents/save.ts';
import { editDocument, EditOperationsSchema } from '../documents/edit.ts';
import { decodeAssets } from '../documents/assets.ts';
import { incomingFiles, pageFiles, readPage } from '../documents/pages.ts';
import { checkDocument, REFUSED, REFUSES } from '../documents/check.ts';
import { unifiedDiff } from '../documents/merge.ts';
import { badRequest, notFound } from '../http.ts';

const SaveBody = z.object({
  name: z.string().min(1).max(200).optional(),
  yaml: z.string().min(1).max(5_000_000),
  imports: z.record(z.string(), z.string()).optional(),
  assets: z.record(z.string(), z.string()).optional(),
  pages: z.record(z.string(), z.string().max(2_000_000)).optional(),
  pins: z.record(z.string(), z.unknown()).optional(),
  message: z.string().max(2000).optional(),
  expectedVersion: z.string().optional(),
});

const EditBody = z.object({
  operations: EditOperationsSchema,
  message: z.string().max(2000).optional(),
  expectedVersion: z.string().optional(),
});

const MoveBody = z
  .object({ workspace: z.string().min(1).optional(), slug: z.string().min(1).optional() })
  .refine((b) => b.workspace !== undefined || b.slug !== undefined, 'name the workspace it goes to, a new slug, or both');

export function documentRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  const base = '/workspaces/:workspace/documents';

  reg.add({ method: 'get', path: base, summary: 'Documents in a workspace', tag: 'documents', params: ['workspace'], auth: 'viewer' });
  app.get(base, async (c) => {
    const ws = await requireWorkspace(ctx.db, c.get('principal'), c.req.param('workspace'), 'viewer');
    const docs = await listDocuments(ctx.db, ws.id);
    return c.json({ documents: docs.map((d) => ({ id: d.id, slug: d.slug, name: d.name, headVersion: d.head_version_id, updatedAt: d.updated_at })) });
  });

  reg.add({ method: 'post', path: base, summary: `Create a document from YAML and its pages; the first version is queued for rendering. ${REFUSES}`, tag: 'documents', params: ['workspace'], body: { name: 'optional; defaults to the document title', yaml: 'the .vantage.yaml text', imports: 'map of import path to yaml text', assets: 'map of file path (as the document names it) to base64 bytes: pictures and custom icon files', pages: 'map of page path (as a doc view names it in file) to Markdown text', message: 'commit message' }, auth: 'author', responses: { '201': 'created', ...REFUSED } });
  app.post(base, async (c) => {
    const p = c.get('principal')!;
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'author');
    const input = await body(c, SaveBody);
    const bytes = { ...decodeAssets(input.assets), ...pageFiles(input.pages) };
    const files = incomingFiles(ctx, p.orgId, bytes);
    const r = await saveDocument(ctx, { orgId: p.orgId, workspaceId: ws.id, name: input.name, yaml: input.yaml, imports: input.imports, pins: input.pins, files, message: input.message, authorUserId: p.userId.startsWith('source:') ? null : p.userId, who: who(p), surface: p.surface });
    return c.json(saveJson(r), 201);
  });

  reg.add({ method: 'post', path: '/workspaces/:workspace/check', summary: 'Check a document whole without saving it: its YAML and its pages, laid over the files of an existing document when one is named. Answers the errors (what every save refuses), each with its code, message, path, and line, the warnings, and with scores each view\'s layout score and notes', tag: 'documents', params: ['workspace'], body: { yaml: 'the .vantage.yaml text', pages: 'optional: path to Markdown text', assets: 'optional: path to base64', document: 'optional: slug of the document the text would be saved to', scores: 'optional: also lay out every view' }, auth: 'viewer' });
  app.post('/workspaces/:workspace/check', async (c) => {
    const p = c.get('principal')!;
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'viewer');
    const input = await body(c, SaveBody.extend({ document: z.string().optional(), scores: z.boolean().optional() }));
    const target = input.document ? await documentBySlug(ctx.db, ws.id, input.document) : undefined;
    const head = target ? await headVersion(ctx.db, target) : undefined;
    return c.json(await checkDocument(ctx, { orgId: p.orgId, workspaceId: ws.id, attachments: head?.attachments }, { yaml: input.yaml, imports: input.imports ?? head?.imports, files: { ...decodeAssets(input.assets), ...pageFiles(input.pages) }, scores: input.scores }));
  });

  reg.add({ method: 'get', path: `${base}/:doc`, summary: 'One document with its head version, and whether the caller may delete it', tag: 'documents', params: ['workspace', 'doc'], auth: 'viewer' });
  app.get(`${base}/:doc`, async (c) => {
    const { p, document, workspace } = await scopedDocument(ctx, c, 'viewer');
    const head = await headVersion(ctx.db, document);
    return c.json({ id: document.id, slug: document.slug, name: document.name, workspace: workspace.slug, role: workspace.role, canDelete: mayDeleteDocument(p, workspace, document.created_by), headVersion: head ? summary(head) : null, updatedAt: document.updated_at, viewer: `${ctx.config.PUBLIC_URL}/w/${workspace.slug}/${document.slug}` });
  });

  reg.add({ method: 'put', path: `${base}/:doc`, summary: `Save a new version; 409 with a diff when the expected version is stale and the merge conflicts. ${REFUSES}`, tag: 'documents', params: ['workspace', 'doc'], body: { yaml: 'the .vantage.yaml text', expectedVersion: 'the version the edit started from', message: 'commit message', imports: 'map of import path to yaml text', assets: 'map of file path to base64 bytes; laid over the files already attached, and files the document no longer names are dropped', pages: 'map of page path to Markdown text', pins: 'per view geometry' }, auth: 'author', responses: { '200': 'saved, unchanged, or merged', '409': 'conflict with diff and preview', ...REFUSED } });
  app.put(`${base}/:doc`, async (c) => {
    const { p, workspace, document } = await scopedDocument(ctx, c, 'author');
    const input = await body(c, SaveBody);
    const bytes = { ...decodeAssets(input.assets), ...pageFiles(input.pages) };
    const files = incomingFiles(ctx, p.orgId, bytes);
    const r = await saveDocument(ctx, { orgId: p.orgId, workspaceId: workspace.id, documentId: document.id, yaml: input.yaml, imports: input.imports, pins: input.pins, files, message: input.message, expectedVersionId: input.expectedVersion, authorUserId: p.userId.startsWith('source:') ? null : p.userId, who: who(p), surface: p.surface });
    return c.json(saveJson(r), r.status === 'conflict' ? 409 : 200);
  });

  reg.add({ method: 'post', path: `${base}/:doc/edits`, summary: `Apply a list of path operations to a version and save the result as one version; 400 names the operation that failed and saves nothing, 409 as for a save. ${REFUSES}`, tag: 'documents', params: ['workspace', 'doc'], body: { operations: 'in order: {op: set, path, value}, {op: add, path, value}, {op: remove, path}; a path is dot separated, and a list item is found by id, a node also by the slug of its name and at any depth, or by index', expectedVersion: 'the version the operations were written against; defaults to the head', message: 'commit message; defaults to a list of the operations' }, auth: 'author', responses: { '200': 'saved, unchanged, or merged', '400': 'an operation failed, or a doc view would read a file the document does not carry', '409': 'conflict with diff and preview', ...REFUSED } });
  app.post(`${base}/:doc/edits`, async (c) => {
    const { p, workspace, document } = await scopedDocument(ctx, c, 'author');
    const input = await body(c, EditBody);
    const r = await editDocument(ctx, { orgId: p.orgId, workspaceId: workspace.id, document, operations: input.operations, message: input.message, expectedVersionId: input.expectedVersion, authorUserId: p.userId.startsWith('source:') ? null : p.userId, who: who(p), surface: p.surface });
    return c.json(saveJson(r), r.status === 'conflict' ? 409 : 200);
  });

  const remove = async (scope: DocumentScope): Promise<void> => {
    requireDelete(scope.p, scope.workspace, scope.document.created_by);
    await deleteDocument(ctx, { orgId: scope.p.orgId, userId: scope.p.userId, who: who(scope.p), surface: scope.p.surface }, scope.document);
  };
  const deleteRuleText = "the workspace's deleteDiagrams rule decides: authors (any author), makers (the person who made it; the default), or owner. The workspace owner and org admins always may";

  reg.add({ method: 'delete', path: `${base}/:doc`, summary: `Delete a document with its versions, comments, guest links, and publications; ${deleteRuleText}`, tag: 'documents', params: ['workspace', 'doc'], auth: 'author', responses: { '204': 'deleted', '403': 'the delete rule does not let the caller' } });
  app.delete(`${base}/:doc`, async (c) => {
    await remove(await scopedDocument(ctx, c, 'author'));
    return c.body(null, 204);
  });

  reg.add({ method: 'delete', path: '/documents/:id', summary: 'Delete a document by id; the same rule as by slug', tag: 'documents', params: ['id'], auth: 'author', responses: { '204': 'deleted', '403': 'the delete rule does not let the caller' } });
  app.delete('/documents/:id', async (c) => {
    await remove(await scopedDocumentById(ctx, c, 'author'));
    return c.body(null, 204);
  });

  reg.add({ method: 'post', path: '/documents/:id/move', summary: "Move a document to another workspace of the organization, give it a new slug, or both, with its versions, comments, stars, guest links, publications, and walkthroughs; the old address stays an alias that sends people and tools to the new one. A document that changes workspace leaves its folder, and the workspace icons it names come along. The caller must be able to delete it where it is (the same rule as a delete) and author where it goes; org admins always may", tag: 'documents', params: ['id'], body: { workspace: 'optional: the slug of the workspace it goes to; default the one it is in', slug: 'optional: the slug it takes; default the one it has. Name at least one' }, auth: 'author', responses: { '200': 'moved; the answer names its new workspace, slug, and link', '400': 'neither workspace nor slug, or a slug a new document could not take', '403': 'the delete rule or the new workspace does not let the caller', '409': 'the workspace already has a document at that slug' } });
  app.post('/documents/:id/move', async (c) => {
    const scope = await scopedDocumentById(ctx, c, 'author');
    requireDelete(scope.p, scope.workspace, scope.document.created_by);
    const input = await body(c, MoveBody);
    const to = input.workspace ? await requireWorkspace(ctx.db, scope.p, input.workspace, 'author') : scope.workspace;
    const moved = await moveDocument(ctx, { orgId: scope.p.orgId, userId: scope.p.userId, who: who(scope.p), surface: scope.p.surface }, scope.document, { workspace: to, slug: input.slug });
    return c.json({ id: moved.id, slug: moved.slug, workspace: to.slug, url: `/w/${encodeURIComponent(to.slug)}/${encodeURIComponent(moved.slug)}` });
  });

  reg.add({ method: 'get', path: `${base}/:doc/versions`, summary: 'Version history, newest first', tag: 'versions', params: ['workspace', 'doc'], query: ['limit'], auth: 'viewer' });
  app.get(`${base}/:doc/versions`, async (c) => {
    const { document } = await scopedDocument(ctx, c, 'viewer');
    const versions = await listVersions(ctx.db, document.id, Number(c.req.query('limit') ?? 50));
    return c.json({ versions: versions.map(summary) });
  });

  reg.add({ method: 'get', path: `${base}/:doc/versions/:version`, summary: 'One version; ?format=yaml returns the text alone', tag: 'versions', params: ['workspace', 'doc', 'version'], query: ['format'], auth: 'viewer' });
  app.get(`${base}/:doc/versions/:version`, async (c) => {
    const { document } = await scopedDocument(ctx, c, 'viewer');
    const v = await versionById(ctx.db, c.req.param('version'));
    if (!v || v.document_id !== document.id) throw notFound('version');
    if (c.req.query('format') === 'yaml') return c.text(v.yaml, 200, { 'content-type': 'application/yaml; charset=utf-8' });
    return c.json({ ...summary(v), yaml: v.yaml, imports: v.imports, pins: v.pins, attachments: v.attachments, artifacts: (await artifactsFor(ctx.db, v.hash)).map(artifactJson) });
  });

  reg.add({ method: 'get', path: `${base}/:doc/pages`, summary: 'The pages of the head version (or ?version=): the Markdown files its doc views read. With ?path= it answers that page as Markdown text', tag: 'documents', params: ['workspace', 'doc'], query: ['version', 'path'], auth: 'viewer' });
  app.get(`${base}/:doc/pages`, async (c) => {
    const { document } = await scopedDocument(ctx, c, 'viewer');
    const v = c.req.query('version') ? await versionById(ctx.db, c.req.query('version')!) : await headVersion(ctx.db, document);
    if (!v || v.document_id !== document.id) throw notFound('version');
    const path = c.req.query('path');
    if (path === undefined) return c.json({ version: v.id, pages: v.attachments.filter((a) => /\.md$/i.test(a.path)).map((a) => ({ path: a.path, hash: a.hash, bytes: a.size })) });
    const text = await readPage(ctx, v, path);
    if (text === undefined) throw notFound('page');
    return c.text(text, 200, { 'content-type': 'text/markdown; charset=utf-8', 'x-vantage-version': v.id });
  });

  reg.add({ method: 'put', path: `${base}/:doc/pages`, summary: `Save pages as one new version without sending the YAML again; a page the head changed since expectedVersion is merged line by line, and 409 names the page when both changed the same lines. ${REFUSES}`, tag: 'documents', params: ['workspace', 'doc'], body: { pages: 'path to Markdown text; every path must be a file a doc view names', assets: 'optional: path to base64, for pictures the pages embed', message: 'optional', expectedVersion: 'the version the pages were read from' }, auth: 'author', responses: { '200': 'saved, unchanged, or merged', '400': 'a path is not a page, or no doc view names it; the paths are listed and nothing is saved', '409': 'a page both sides changed on the same lines', ...REFUSED } });
  app.put(`${base}/:doc/pages`, async (c) => {
    const { p, workspace, document } = await scopedDocument(ctx, c, 'author');
    const input = await body(c, z.object({ pages: z.record(z.string(), z.string().max(2_000_000)), assets: z.record(z.string(), z.string()).optional(), message: z.string().max(2000).optional(), expectedVersion: z.string().optional() }));
    const head = await headVersion(ctx.db, document);
    if (!head) throw notFound('version');
    const bytes = { ...decodeAssets(input.assets), ...pageFiles(input.pages) };
    const r = await saveDocument(ctx, { orgId: p.orgId, workspaceId: workspace.id, documentId: document.id, yaml: head.yaml, files: incomingFiles(ctx, p.orgId, bytes), message: input.message, expectedVersionId: input.expectedVersion, authorUserId: p.userId.startsWith('source:') ? null : p.userId, who: who(p), surface: p.surface });
    return c.json(saveJson(r), r.status === 'conflict' ? 409 : 200);
  });

  reg.add({ method: 'get', path: `${base}/:doc/diff`, summary: 'Unified diff between two versions (defaults: parent of head to head)', tag: 'versions', params: ['workspace', 'doc'], query: ['from', 'to'], auth: 'viewer' });
  app.get(`${base}/:doc/diff`, async (c) => {
    const { document } = await scopedDocument(ctx, c, 'viewer');
    const head = await headVersion(ctx.db, document);
    if (!head) throw notFound('version');
    const to = c.req.query('to') ? await versionById(ctx.db, c.req.query('to')!) : head;
    const fromId = c.req.query('from') ?? to?.parent_id ?? undefined;
    const from = fromId ? await versionById(ctx.db, fromId) : undefined;
    if (!to || to.document_id !== document.id) throw notFound('version');
    if (from && from.document_id !== document.id) throw notFound('version');
    return c.text(unifiedDiff(from ? `version ${from.id}` : 'empty', from?.yaml ?? '', `version ${to.id}`, to.yaml), 200, { 'content-type': 'text/x-diff; charset=utf-8' });
  });

  reg.add({ method: 'get', path: `${base}/:doc/artifacts`, summary: 'Artifacts of the head version (or ?version=)', tag: 'artifacts', params: ['workspace', 'doc'], query: ['version'], auth: 'viewer' });
  app.get(`${base}/:doc/artifacts`, async (c) => {
    const { document } = await scopedDocument(ctx, c, 'viewer');
    const v = c.req.query('version') ? await versionById(ctx.db, c.req.query('version')!) : await headVersion(ctx.db, document);
    if (!v || v.document_id !== document.id) throw notFound('version');
    return c.json({ version: v.id, hash: v.hash, artifacts: listed(await artifactsFor(ctx.db, v.hash)) });
  });

  reg.add({ method: 'get', path: `${base}/:doc/artifacts/:kind`, summary: 'An artifact body: svg and png need ?view=; html and bundle do not. SVG, PNG, and HTML are made on first request; a version never drawn answers 202 and draws.', tag: 'artifacts', params: ['workspace', 'doc', 'kind'], query: ['view', 'version'], auth: 'viewer' });
  app.get(`${base}/:doc/artifacts/:kind`, async (c) => {
    const { document } = await scopedDocument(ctx, c, 'viewer');
    const kind = c.req.param('kind');
    if (!isKind(kind)) throw badRequest('kind must be svg, png, html, or bundle');
    const v = c.req.query('version') ? await versionById(ctx.db, c.req.query('version')!) : await headVersion(ctx.db, document);
    if (!v || v.document_id !== document.id) throw notFound('version');
    const view = kind === 'svg' || kind === 'png' ? c.req.query('view') : '';
    if (view === undefined) throw badRequest('view is required for svg and png');
    const file = await storedArtifact(ctx, v, view, kind);
    if (!file) {
      // A version a burst of saves passed over was never drawn; the first reader to ask has it drawn.
      if (!(await artifactsFor(ctx.db, v.hash)).length) {
        await enqueue(ctx.db, { orgId: document.org_id, kind: 'render', payload: { versionId: v.id, documentId: document.id }, dedupeKey: `version:${v.id}` });
        return c.json({ status: 'drawing', version: v.id }, 202, { 'retry-after': '2' });
      }
      throw notFound('artifact');
    }
    // A redraw replaces the files of the same version, so the tag names the render and the client revalidates.
    const etag = `"${v.hash}-${file.renderId ?? 'r0'}-${view}-${kind}"`;
    const headers = { 'cache-control': 'private, no-cache', etag };
    if (c.req.header('if-none-match') === etag) return c.body(null, 304, headers);
    const gzipOk = /\bgzip\b/.test(c.req.header('accept-encoding') ?? '');
    const bytes = gzipOk ? file.bytes : plainBytes(file);
    return c.body(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 200, { ...headers, 'content-type': file.contentType, ...(file.gzip && gzipOk ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}) });
  });

  return app;
}

function isKind(k: string): k is ArtifactKind {
  return k === 'svg' || k === 'png' || k === 'html' || k === 'bundle';
}

/** Stored artifacts, plus the SVG and PNG of every view and the HTML that would be made on request; those carry no size yet. */
function listed(rows: readonly ArtifactRow[]): Record<string, unknown>[] {
  const out = rows.map(artifactJson);
  const has = new Set(rows.map((r) => `${r.view_id}/${r.kind}`));
  for (const r of rows) {
    if (r.kind === 'view' && !has.has(`${r.view_id}/svg`)) out.push({ view: r.view_id, kind: 'svg', bytes: null, contentType: 'image/svg+xml', derived: true });
    if ((r.kind === 'view' || r.kind === 'svg') && !has.has(`${r.view_id}/png`)) out.push({ view: r.view_id, kind: 'png', bytes: null, contentType: 'image/png', derived: true });
    if (r.kind === 'bundle' && !has.has('/html')) out.push({ view: null, kind: 'html', bytes: null, contentType: 'text/html; charset=utf-8', derived: true });
  }
  return out;
}

export function summary(v: VersionSummary): Record<string, unknown> {
  return { id: v.id, hash: v.hash, author: v.author_user_id, surface: v.surface, message: v.message, parent: v.parent_id, scores: v.scores, createdAt: v.created_at };
}

function artifactJson(a: { view_id: string; kind: string; bytes: number; content_type: string }): Record<string, unknown> {
  return { view: a.view_id || null, kind: a.kind, bytes: Number(a.bytes), contentType: a.content_type };
}

export function saveJson(r: SaveResult): Record<string, unknown> {
  const document = { id: r.document.id, slug: r.document.slug, name: r.document.name };
  if (r.status === 'conflict') return { status: 'conflict', document, head: summary(r.head), conflicts: r.conflicts, diff: r.diff, preview: r.preview, ...(r.path !== undefined ? { page: r.path } : {}) };
  return { status: r.status, document, version: summary(r.version), ...(r.status === 'saved' ? { merged: r.merged } : {}), ...(r.moved.length ? { movedDecisions: r.moved } : {}) };
}

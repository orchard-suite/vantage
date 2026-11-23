/**
 * What the viewer's Export and Share dialogs and the hub's import page
 * call:
 * - one-off exports of a document in any publication format, rendered the
 *   way a publication renders them (one file, or a zip of several);
 * - guest links by document id, with what the dialog needs to show them;
 * - importing a draw.io, Visio (or Lucidchart's VSDX export) or Ilograph
 *   drawing: a preview with the import report, then the document itself.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zipSync } from 'fflate';
import { PublicationSchema, type Artifact } from '@vantage/publish';
import { importDiagram } from '@vantage/import';
import { resolveForeignIcon } from '@vantage/server';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, principal, scopedDocumentById, who } from './common.ts';
import { headVersion } from '../documents/repo.ts';
import { hubProducer } from '../publishing/producer.ts';
import { createGuestLink, guestLinksAllowed, listGuestLinks, publicGuestLink, revokeGuestLink } from '../guest.ts';
import { saveDocument } from '../documents/save.ts';
import { REFUSED, REFUSES } from '../documents/check.ts';
import { storeAssets } from '../documents/assets.ts';
import { requireWorkspace } from '../authz.ts';
import { audit } from '../audit.ts';
import { HttpError, badRequest, forbidden, notFound } from '../http.ts';

const DOC = '/documents/:id';
const FORMATS = ['png', 'svg', 'pdf', 'html', 'drawio', 'vsdx'] as const;
/** A drawing bigger than this is refused before it is parsed. */
export const MAX_DRAWING_BYTES = 25 * 1024 * 1024;

const ExportQuery = z.object({
  format: z.enum(FORMATS),
  views: z.string().optional(),
  theme: z.enum(['light', 'dark', 'print', 'colorblind']).optional(),
  titleBlock: z.enum(['true', 'false']).optional(),
});

function download(c: { body: (data: ArrayBuffer, status: 200, headers: Record<string, string>) => Response }, name: string, type: string, bytes: Uint8Array): Response {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return c.body(ab, 200, { 'content-type': type, 'content-disposition': `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"`, 'cache-control': 'private, no-store' });
}

/** ?types= is JSON: box id to type ("" leaves the box untyped). Anything else is ignored rather than refused. */
function typeOverrides(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = z.record(z.string().max(200), z.string().max(60)).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function shareRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  reg.add({ method: 'get', path: `${DOC}/export`, summary: 'Download the head version as png, svg, pdf, html, drawio or vsdx; several files come as a zip', tag: 'export', params: ['id'], query: ['format', 'views', 'theme', 'titleBlock'], auth: 'viewer' });
  app.get(`${DOC}/export`, async (c) => {
    const { p, document } = await scopedDocumentById(ctx, c, 'viewer');
    const q = ExportQuery.safeParse(c.req.query());
    if (!q.success) throw badRequest(`format must be one of ${FORMATS.join(', ')}; theme light, dark, print or colorblind`);
    const version = await headVersion(ctx.db, document);
    if (!version) throw notFound('version');
    const views = q.data.views ? q.data.views.split(',').map((v) => v.trim()).filter(Boolean) : undefined;
    const warnings: string[] = [];
    const publication = PublicationSchema.parse({ id: `export-${document.id}`, document: document.id, formats: [q.data.format], target: 'download', config: {}, ...(views ? { views } : {}), ...(q.data.theme ? { theme: q.data.theme } : {}), titleBlock: q.data.titleBlock === 'true' });
    const stamp = { title: document.name, version: version.id, publishedAt: new Date().toISOString() };
    let artifacts: readonly Artifact[];
    try {
      artifacts = await hubProducer(ctx, { document, version, stamp, onWarning: (m) => warnings.push(m) })({ publication, stamp });
    } catch (err) {
      throw new HttpError(422, (err as Error).message);
    }
    if (!artifacts.length) throw badRequest(warnings[0] ?? 'nothing to export');
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'document.export', surface: p.surface, target: `document:${document.id}`, details: { format: q.data.format, views: views ?? null, files: artifacts.length } });
    if (warnings.length) c.header('x-vantage-warnings', warnings.join('; '));
    if (artifacts.length === 1) return download(c, artifacts[0]!.filename, artifacts[0]!.contentType, artifacts[0]!.bytes);
    const zip = zipSync(Object.fromEntries(artifacts.map((a) => [a.filename, a.bytes])), { level: 6 });
    return download(c, `${document.slug}.${q.data.format}.zip`, 'application/zip', zip);
  });

  reg.add({ method: 'get', path: `${DOC}/share`, summary: 'What the share dialog shows: guest links (authors), whether links are allowed, the embed address, the workspace', tag: 'guest-links', params: ['id'], auth: 'viewer' });
  app.get(`${DOC}/share`, async (c) => {
    const { workspace, document } = await scopedDocumentById(ctx, c, 'viewer');
    const author = workspace.role === 'author';
    const links = author ? (await listGuestLinks(ctx.db, document.id)).filter((l) => !l.revoked_at && l.expires_at.getTime() > Date.now()) : [];
    return c.json({
      canShare: author,
      guestLinksAllowed: guestLinksAllowed(ctx.config, workspace),
      guestLinksOnHub: ctx.config.GUEST_LINKS,
      guestLinks: links.map(publicGuestLink),
      embedBase: `${ctx.config.PUBLIC_URL}/embed/${encodeURIComponent(workspace.slug)}/${encodeURIComponent(document.slug)}`,
      workspace: { slug: workspace.slug, name: workspace.name, kind: workspace.kind, url: `${ctx.config.PUBLIC_URL}/w/${encodeURIComponent(workspace.slug)}?tab=members` },
    });
  });

  reg.add({ method: 'post', path: `${DOC}/guest-links`, summary: 'Create a guest link by document id', tag: 'guest-links', params: ['id'], body: { expiresInHours: 'default 168', passcode: 'optional', view: 'optional view id' }, auth: 'author', responses: { '201': 'created with url' } });
  app.post(`${DOC}/guest-links`, async (c) => {
    const { p, workspace, document } = await scopedDocumentById(ctx, c, 'author');
    if (!guestLinksAllowed(ctx.config, workspace)) throw forbidden(ctx.config.GUEST_LINKS ? 'guest links are disabled for this workspace' : 'guest links are turned off on this hub');
    const input = await body(c, z.object({ expiresInHours: z.number().min(1).max(24 * 365).default(168), passcode: z.string().min(4).max(100).optional(), view: z.string().optional() }));
    const { row, token } = await createGuestLink(ctx.db, ctx.log, ctx.config.SESSION_SECRET, { orgId: p.orgId, documentId: document.id, viewId: input.view, createdBy: p.userId, expiresAt: new Date(Date.now() + input.expiresInHours * 3_600_000), passcode: input.passcode }, p.surface);
    return c.json({ ...publicGuestLink(row), url: `${ctx.config.PUBLIC_URL}/g/${token}` }, 201);
  });

  reg.add({ method: 'delete', path: `${DOC}/guest-links/:link`, summary: 'Revoke a guest link by document id', tag: 'guest-links', params: ['id', 'link'], auth: 'author', responses: { '204': 'revoked' } });
  app.delete(`${DOC}/guest-links/:link`, async (c) => {
    const { p, document } = await scopedDocumentById(ctx, c, 'author');
    await revokeGuestLink(ctx.db, ctx.log, p.orgId, document.id, c.req.param('link'), who(p), p.surface);
    return c.body(null, 204);
  });

  reg.add({ method: 'post', path: '/workspaces/:workspace/drawings', summary: `Import a draw.io, Visio/Lucidchart (vsdx), Ilograph, Mermaid, or PlantUML drawing, or a Markdown file with diagram blocks (raw bytes, ?filename=); ?preview=true returns the report without saving. ${REFUSES}`, tag: 'transfer', params: ['workspace'], query: ['filename', 'preview', 'layout', 'guess', 'types'], auth: 'author', responses: { '200': 'preview', '201': 'created', '400': 'unreadable drawing', '413': 'too large', ...REFUSED } });
  app.post('/workspaces/:workspace/drawings', async (c) => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'author');
    const filename = (c.req.query('filename') ?? '').trim();
    if (!filename) throw badRequest('filename is required, so the format can be told');
    const length = Number(c.req.header('content-length') ?? 0);
    if (length > MAX_DRAWING_BYTES) throw new HttpError(413, 'that drawing is over 25 MB');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength > MAX_DRAWING_BYTES) throw new HttpError(413, 'that drawing is over 25 MB');
    if (!bytes.byteLength) throw badRequest('the file is empty');
    let result;
    try {
      result = importDiagram(bytes, { filename, iconResolver: resolveForeignIcon, layout: c.req.query('layout') === 'auto' ? 'auto' : 'keep', guessTypes: c.req.query('guess') !== 'false', types: typeOverrides(c.req.query('types')) });
    } catch (err) {
      ctx.log.info('drawing.import.unreadable', { filename, error: (err as Error).message });
      throw badRequest(`could not read ${filename}: ${(err as Error).message}`);
    }
    const r = result.report;
    const report = {
      filename: r.filename,
      format: r.format,
      title: result.document.title ?? filename,
      counts: r.counts,
      pages: r.pages.map((pg, i) => ({ name: pg.name, view: result.document.views[i]?.title ?? pg.name })),
      warnings: [...r.warnings, ...r.merged],
      unmappedStyles: r.unmappedStyles,
      pictures: r.pictures,
      errors: r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message),
      typed: r.typed,
      layout: r.layout,
    };
    if (c.req.query('preview') === 'true') return c.json({ report });
    const attachments = await storeAssets(ctx, p.orgId, result.assets);
    const saved = await saveDocument(ctx, { orgId: p.orgId, workspaceId: ws.id, yaml: result.yaml, attachments, message: `import ${filename}`, authorUserId: p.userId, who: who(p), surface: p.surface });
    if (saved.status === 'conflict') throw new HttpError(409, 'import conflicted with an existing document');
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'document.import', surface: p.surface, target: `document:${saved.document.id}`, details: { filename, format: r.format, nodes: r.counts.nodes, relations: r.counts.relations } });
    return c.json({ report, document: { id: saved.document.id, slug: saved.document.slug, name: saved.document.name }, url: `/w/${encodeURIComponent(ws.slug)}/${encodeURIComponent(saved.document.slug)}` }, 201);
  });

  return app;
}

/**
 * Per-document live endpoints addressed by document id, so a published
 * copy or a notification link needs no workspace slug: the current bundle
 * for self-refreshing HTML, and the drift report with its rendered view.
 * Both answer only readers whose grants reach the document.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { DriftInput } from '@vantage/layout';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { principal } from './common.ts';
import { workspaceRole } from '../authz.ts';
import { documentById, headVersion, type DocumentRow, type VersionRow } from '../documents/repo.ts';
import { headBundle } from '../web/bundle-serve.ts';
import { badRequest, notFound } from '../http.ts';
import { driftReport, observedForDocument } from '../worker/artifacts.ts';
import { resourceInputs } from '../documents/assets.ts';

export interface DriftView {
  readonly svg: string;
  readonly sentences: readonly string[];
  readonly counts: { missing: number; undeclared: number; mismatched: number };
}

/** The drift view of one view of a document: the laid-out picture with disagreements drawn on it, drawn on the render pool. */
export async function renderDriftView(ctx: AppContext, doc: DocumentRow, head: VersionRow, viewId: string | undefined): Promise<DriftView> {
  const observed = await observedForDocument(ctx, doc, head);
  const resources = await resourceInputs(ctx, { orgId: doc.org_id, workspaceId: doc.workspace_id, attachments: head.attachments });
  const report = await driftReport(ctx, doc.id);
  const items: DriftInput[] = (report?.report.items ?? []).map((i) => (i.kind === 'observed-not-declared' ? { kind: i.kind, containerId: i.containerId, key: i.key, name: i.name, type: i.type } : i.kind === 'fact-mismatch' ? { kind: i.kind, nodeId: i.nodeId, label: i.label, declared: i.declared, observed: i.observed } : { kind: i.kind, nodeId: i.nodeId, bind: i.bind, ...(i.missingSince !== undefined ? { missingSince: i.missingSince } : {}) }));
  const out = await ctx.render.run('driftView', { yaml: head.yaml, imports: head.imports, observed: observed.model, resources, viewId, items });
  if (!out.ok && out.reason === 'unparsable') throw badRequest('document does not parse', { issues: out.issues });
  if (!out.ok) throw notFound(viewId ? `view ${viewId}` : 'view (the document has none)');
  ctx.log.info('drift.rendered', { documentId: doc.id, viewId: out.viewId, items: items.length, ...out.counts });
  return { svg: out.svg, sentences: out.sentences, counts: out.counts };
}

export function driftRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  const readable = async (c: Context<HubEnv>): Promise<{ doc: DocumentRow; head: VersionRow | undefined }> => {
    const p = principal(c);
    const doc = await documentById(ctx.db, c.req.param('document') ?? '');
    if (!doc || doc.org_id !== p.orgId) throw notFound('document');
    const role = await workspaceRole(ctx.db, p, doc.workspace_id);
    if (!role) {
      ctx.log.info('document.denied', { documentId: doc.id, userId: p.userId });
      throw notFound('document');
    }
    return { doc, head: await headVersion(ctx.db, doc) };
  };

  reg.add({ method: 'get', path: '/documents/:document/bundle', summary: 'The current version and viewer bundle of a document, for self-refreshing HTML copies; readers only', tag: 'documents', params: ['document'], auth: 'viewer', responses: { '200': '{ version, bundle }', '404': 'unknown, not readable, or not rendered yet' } });
  app.get('/documents/:document/bundle', async (c) => {
    const { doc, head } = await readable(c);
    if (!head) throw notFound('version');
    const joined = await headBundle(ctx, { document: doc });
    if (!joined) throw notFound('bundle (not rendered yet?)');
    const origin = c.req.header('origin');
    const headers: Record<string, string> = { 'cache-control': 'no-store' };
    if (origin && ctx.config.EMBED_ORIGINS.includes(origin)) {
      headers['access-control-allow-origin'] = origin;
      headers['access-control-allow-credentials'] = 'true';
      headers['vary'] = 'origin';
    } else if (origin) ctx.log.debug('bundle.origin.refused', { documentId: doc.id, origin });
    ctx.log.debug('bundle.served', { documentId: doc.id, versionId: joined.versionId, bytes: joined.json.length });
    return c.body(`{"version":${JSON.stringify(joined.versionId)},"bundle":${joined.json}}`, 200, { ...headers, 'content-type': 'application/json' });
  });

  reg.add({ method: 'get', path: '/documents/:document/drift', summary: 'The drift report of a document; ?format=svg|png renders the drift view of ?view= (default the first view)', tag: 'drift', params: ['document'], query: ['view', 'format'], auth: 'viewer' });
  app.get('/documents/:document/drift', async (c) => {
    const { doc, head } = await readable(c);
    if (!head) throw notFound('version');
    const format = c.req.query('format');
    if (format === 'svg' || format === 'png') {
      const view = await renderDriftView(ctx, doc, head, c.req.query('view'));
      if (format === 'svg') return c.body(view.svg, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
      const png = await ctx.render.run('png', { svg: view.svg });
      return c.body(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer, 200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
    }
    if (format !== undefined) throw badRequest('format must be svg or png');
    const report = await driftReport(ctx, doc.id);
    const sentences = report && report.report.items.length ? await renderDriftView(ctx, doc, head, c.req.query('view')).then((v) => v.sentences).catch(() => []) : [];
    return c.json({ document: { id: doc.id, slug: doc.slug, name: doc.name }, version: head.id, reportVersion: report?.version_id ?? null, updatedAt: report?.updated_at ?? null, counts: report?.counts ?? { declaredNotObserved: 0, observedNotDeclared: 0, factMismatch: 0 }, items: report?.report.items ?? [], sentences, bindSources: doc.bind_sources });
  });

  return app;
}

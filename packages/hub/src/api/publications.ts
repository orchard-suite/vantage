/**
 * Publications: which document, which views, which formats, which target,
 * when. Scoped to a workspace; authors manage them. Target config names
 * secrets by reference and is validated against the target's schema. With
 * PUBLICATION_APPROVAL a publication runs only once an admin approves it,
 * and a change to what it sends or where takes the approval back.
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { TriggerSchema } from '@vantage/publish';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, Name, principal, who } from './common.ts';
import { requireWorkspace, type AccessibleWorkspace } from '../authz.ts';
import type { Principal } from '../auth/principal.ts';
import { audit } from '../audit.ts';
import { randomId } from '../crypto.ts';
import { badRequest, forbidden, notFound } from '../http.ts';
import { documentBySlug } from '../documents/repo.ts';
import { enqueue } from '../worker/jobs.ts';
import { cronProblem } from '../worker/cron.ts';
import { blockedReason, destinationChanged, listPublicationRuns, listPublications, publicationById, type PublicationRow } from '../publishing/repo.ts';

const PublicationBody = z
  .object({
    name: Name,
    document: z.string().min(1).describe('Document slug in this workspace'),
    views: z.array(z.string().min(1)).optional(),
    formats: z.array(z.enum(['html', 'png', 'svg', 'pdf', 'drawio', 'vsdx'])).min(1),
    target: z.string().min(1),
    config: z.record(z.string(), z.unknown()).default({}),
    trigger: TriggerSchema.default({ kind: 'manual' }),
    audience: z.enum(['org', 'public', 'external']).default('org'),
    theme: z.enum(['light', 'dark', 'print', 'colorblind']).optional(),
    titleBlock: z.boolean().default(true),
    enabled: z.boolean().default(true),
  })
  .strict();

export function publicationJson(p: PublicationRow, documentSlug?: string): Record<string, unknown> {
  return { id: p.id, name: p.name, workspaceId: p.workspace_id, documentId: p.document_id, ...(documentSlug ? { document: documentSlug } : {}), views: p.views, formats: p.formats, target: p.target, config: p.config, trigger: p.trigger, audience: p.audience, theme: p.theme, titleBlock: p.title_block, enabled: p.enabled, approval: p.approval, approvalAt: p.approval_at, createdBy: p.created_by, lastRun: p.last_run, createdAt: p.created_at, updatedAt: p.updated_at };
}

export function publicationRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  const base = '/workspaces/:workspace/publications';

  const validate = (input: z.output<typeof PublicationBody>): void => {
    const target = ctx.targets.get(input.target);
    if (!target) throw badRequest(`unknown target ${input.target}`, { known: ctx.targets.list().map((t) => t.id) });
    const parsed = target.configSchema.safeParse(input.config);
    if (!parsed.success) throw badRequest('invalid target config', { issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`) });
    if (input.trigger.kind === 'schedule') {
      const problem = cronProblem(input.trigger.cron);
      if (problem) throw badRequest(`invalid schedule: ${problem}`);
    }
  };

  const scoped = async (c: Context<HubEnv>, role: 'viewer' | 'author'): Promise<{ p: Principal; ws: AccessibleWorkspace; pub: PublicationRow }> => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace') ?? '', role);
    const pub = await publicationById(ctx.db, c.req.param('publication') ?? '');
    if (!pub || pub.workspace_id !== ws.id) throw notFound('publication');
    return { p, ws, pub };
  };

  reg.add({ method: 'get', path: base, summary: 'Publications of a workspace (?document= filters by slug)', tag: 'publications', params: ['workspace'], query: ['document'], auth: 'viewer' });
  app.get(base, async (c) => {
    const ws = await requireWorkspace(ctx.db, c.get('principal'), c.req.param('workspace'), 'viewer');
    const slug = c.req.query('document');
    const doc = slug ? await documentBySlug(ctx.db, ws.id, slug) : undefined;
    if (slug && !doc) throw notFound('document');
    const docs = new Map((await ctx.db.query<{ id: string; slug: string }>('select id, slug from documents where workspace_id = $1', [ws.id])).map((d) => [d.id, d.slug]));
    return c.json({ publications: (await listPublications(ctx.db, ws.id, doc?.id)).map((p) => publicationJson(p, docs.get(p.document_id))) });
  });

  reg.add({ method: 'post', path: base, summary: 'Create a publication; config is validated against the target schema', tag: 'publications', params: ['workspace'], body: { name: 'label', document: 'document slug', views: 'view ids; omit for all', formats: 'html, png, svg, pdf, drawio, vsdx', target: 'target id', config: 'target config; secrets by name', trigger: '{kind: manual | on-save | schedule, cron (read in the hub time zone)}', audience: 'org | public | external', theme: 'optional', titleBlock: 'default true', enabled: 'default true' }, auth: 'author', responses: { '201': 'created', '400': 'invalid target, config, or schedule' } });
  app.post(base, async (c) => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'author');
    const input = await body(c, PublicationBody);
    validate(input);
    const doc = await documentBySlug(ctx.db, ws.id, input.document);
    if (!doc) throw notFound('document');
    const id = randomId();
    await ctx.db.query('insert into publications (id, org_id, workspace_id, document_id, name, views, formats, target, config, trigger, audience, theme, title_block, enabled, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)', [id, p.orgId, ws.id, doc.id, input.name, input.views ? JSON.stringify(input.views) : null, JSON.stringify(input.formats), input.target, JSON.stringify(input.config), JSON.stringify(input.trigger), input.audience, input.theme ?? null, input.titleBlock, input.enabled, p.userId]);
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'publication.create', surface: p.surface, target: `publication:${id}`, details: { documentId: doc.id, target: input.target, formats: input.formats, trigger: input.trigger.kind, audience: input.audience } });
    ctx.log.info('publication.created', { publicationId: id, documentId: doc.id, target: input.target, trigger: input.trigger.kind });
    return c.json(publicationJson((await publicationById(ctx.db, id))!, doc.slug), 201);
  });

  reg.add({ method: 'get', path: `${base}/:publication`, summary: 'One publication with its last run', tag: 'publications', params: ['workspace', 'publication'], auth: 'viewer' });
  app.get(`${base}/:publication`, async (c) => {
    const { pub } = await scoped(c, 'viewer');
    return c.json(publicationJson(pub));
  });

  reg.add({ method: 'put', path: `${base}/:publication`, summary: 'Replace a publication', tag: 'publications', params: ['workspace', 'publication'], body: { name: 'label', document: 'document slug', formats: 'array', target: 'target id', config: 'object', trigger: 'object', audience: 'string', theme: 'optional', titleBlock: 'boolean', enabled: 'boolean' }, auth: 'author' });
  app.put(`${base}/:publication`, async (c) => {
    const { p, ws, pub } = await scoped(c, 'author');
    const input = await body(c, PublicationBody);
    validate(input);
    const doc = await documentBySlug(ctx.db, ws.id, input.document);
    if (!doc) throw notFound('document');
    const moved = destinationChanged(pub, { document_id: doc.id, views: input.views ?? null, formats: input.formats, target: input.target, config: input.config, trigger: input.trigger, audience: input.audience });
    const approval = moved && pub.approval === 'approved' ? 'pending' : pub.approval;
    await ctx.db.query('update publications set document_id = $2, name = $3, views = $4, formats = $5, target = $6, config = $7, trigger = $8, audience = $9, theme = $10, title_block = $11, enabled = $12, approval = $13, updated_at = now() where id = $1', [pub.id, doc.id, input.name, input.views ? JSON.stringify(input.views) : null, JSON.stringify(input.formats), input.target, JSON.stringify(input.config), JSON.stringify(input.trigger), input.audience, input.theme ?? null, input.titleBlock, input.enabled, approval]);
    if (approval !== pub.approval) ctx.log.info('publication.approval.reset', { publicationId: pub.id });
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'publication.update', surface: p.surface, target: `publication:${pub.id}`, details: { target: input.target, trigger: input.trigger.kind, enabled: input.enabled, approval } });
    return c.json(publicationJson((await publicationById(ctx.db, pub.id))!, doc.slug));
  });

  reg.add({ method: 'delete', path: `${base}/:publication`, summary: 'Delete a publication and its run history', tag: 'publications', params: ['workspace', 'publication'], auth: 'author', responses: { '204': 'deleted' } });
  app.delete(`${base}/:publication`, async (c) => {
    const { p, pub } = await scoped(c, 'author');
    await ctx.db.transaction(async (tx) => {
      await tx.query('delete from publications where id = $1', [pub.id]);
      await audit(tx, ctx.log, { orgId: p.orgId, who: who(p), what: 'publication.delete', surface: p.surface, target: `publication:${pub.id}`, details: { name: pub.name } });
    });
    return c.body(null, 204);
  });

  reg.add({ method: 'post', path: `${base}/:publication/run`, summary: 'Queue a publication run now', tag: 'publications', params: ['workspace', 'publication'], auth: 'author', responses: { '202': 'queued with jobId', '403': 'waiting for approval or stopped by an admin' } });
  app.post(`${base}/:publication/run`, async (c) => {
    const { p, pub } = await scoped(c, 'author');
    const blocked = blockedReason(pub, ctx.config.PUBLICATION_APPROVAL);
    if (blocked) throw forbidden(blocked);
    const jobId = await enqueue(ctx.db, { orgId: p.orgId, kind: 'publication-run', payload: { publicationId: pub.id, trigger: 'manual', who: who(p) } });
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'publication.run.queue', surface: p.surface, target: `publication:${pub.id}`, details: { jobId } });
    return c.json({ jobId, publicationId: pub.id }, 202);
  });

  reg.add({ method: 'get', path: `${base}/:publication/runs`, summary: 'Run history, newest first', tag: 'publications', params: ['workspace', 'publication'], query: ['limit'], auth: 'viewer' });
  app.get(`${base}/:publication/runs`, async (c) => {
    const { pub } = await scoped(c, 'viewer');
    const runs = await listPublicationRuns(ctx.db, pub.id, Number(c.req.query('limit') ?? 50));
    return c.json({ runs: runs.map((r) => ({ id: r.id, jobId: r.job_id, trigger: r.trigger, status: r.status, version: r.version_id, startedAt: r.started_at, finishedAt: r.finished_at, written: r.written, skipped: r.skipped, error: r.error })) });
  });

  return app;
}

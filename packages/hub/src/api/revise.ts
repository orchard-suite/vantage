/**
 * Revising a document from its comments: whether this hub can, the models
 * on offer, a request that queues a revision, its progress, the visual diff
 * of its proposal, and accept or reject. Accepting saves the proposal as a
 * version (merged when the head moved) and resolves the comments it
 * addressed. Admins see each person's use by month and model, and set
 * what each person and the whole organization may spend.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, principal, scopedDocumentById, who, type DocumentScope } from './common.ts';
import { saveJson } from './documents.ts';
import { REFUSED, REFUSES } from '../documents/check.ts';
import { headVersion, versionById } from '../documents/repo.ts';
import { saveDocument } from '../documents/save.ts';
import { visualDiff } from '../documents/visual-diff.ts';
import { resolveComment, type CommentRow } from '../comments.ts';
import { enqueue } from '../worker/jobs.ts';
import { requireAdmin } from '../authz.ts';
import { badRequest, HttpError, notFound } from '../http.ts';
import { audit } from '../audit.ts';
import { createRevision, listRevisions, moveRevision, publicRevision, revisionById, type RevisionRow } from '../revise/repo.ts';
import { allowance, clearPersonLimits, orgLimits, OrgLimitsSchema, personLimits, PersonLimitsSchema, refusal, setOrgLimits, setPersonLimits } from '../revise/limits.ts';
import { monthKey, monthlyTotals, monthStart, parseMonth, usageCsv, usageForMonth } from '../revise/usage.ts';

const DOC = '/documents/:id';
const REV = `${DOC}/revisions/:revision`;

export function reviseRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  const revisionOf = async (scope: DocumentScope, id: string): Promise<RevisionRow> => {
    const r = await revisionById(ctx.db, id);
    if (!r || r.document_id !== scope.document.id) throw notFound('revision');
    return r;
  };

  reg.add({ method: 'get', path: `${DOC}/revise`, summary: 'Whether this hub can revise the document from its comments, the models on offer, what the caller has spent against each limit, and the latest revision', tag: 'revise', params: ['id'], auth: 'viewer' });
  app.get(`${DOC}/revise`, async (c) => {
    const { p, workspace, document } = await scopedDocumentById(ctx, c, 'viewer');
    if (!ctx.ai) return c.json({ enabled: false });
    const [models, allowed, latest] = await Promise.all([ctx.ai.models(), allowance(ctx.db, ctx.config, p.orgId, p.userId), listRevisions(ctx.db, document.id, 1)]);
    return c.json({ enabled: true, canRevise: workspace.role === 'author', models, defaultModel: ctx.ai.defaultModel, allowance: allowed, latest: latest[0] ? publicRevision(latest[0]) : null });
  });

  reg.add({ method: 'post', path: `${DOC}/revisions`, summary: 'Ask the organization\'s model to revise the document from open comments; queues the revision and answers it', tag: 'revise', params: ['id'], body: { comments: 'ids of open comments on the document', model: 'optional model id; the default otherwise' }, auth: 'author', responses: { '202': 'queued', '403': 'an admin turned the model off for the caller', '409': 'a revision of this document is already running', '429': "over the caller's daily or monthly limit, or the organization's monthly limit" } });
  app.post(`${DOC}/revisions`, async (c) => {
    const { p, document } = await scopedDocumentById(ctx, c, 'author');
    if (!ctx.ai) throw new HttpError(404, 'this hub has no model API configured');
    const input = await body(c, z.object({ comments: z.array(z.string().min(1)).min(1).max(50), model: z.string().min(1).optional() }));
    const model = input.model ?? ctx.ai.defaultModel;
    if (!(await ctx.ai.models()).includes(model)) throw badRequest(`model ${model} is not offered on this hub`);
    const allowed = await allowance(ctx.db, ctx.config, p.orgId, p.userId);
    const refused = refusal(allowed);
    if (refused) {
      ctx.log.info('revise.refused', { documentId: document.id, by: p.userId, status: refused.status, reason: refused.message, today: allowed.today, month: allowed.month, orgMonth: allowed.orgMonth });
      throw refused;
    }
    const ids = [...new Set(input.comments)];
    const open = await ctx.db.query<CommentRow>('select * from comments where document_id = $1 and id = any($2::text[]) and resolved_at is null', [document.id, ids]);
    if (open.length !== ids.length) throw badRequest('every comment must be an open comment on this document');
    const head = await headVersion(ctx.db, document);
    if (!head) throw notFound('version');
    const rev = await createRevision(ctx.db, { orgId: p.orgId, documentId: document.id, baseVersionId: head.id, requestedBy: p.userId, commentIds: ids, model });
    await enqueue(ctx.db, { orgId: p.orgId, kind: 'revise', payload: { revisionId: rev.id } });
    ctx.log.info('revise.requested', { revisionId: rev.id, documentId: document.id, model, comments: ids.length, by: p.userId, today: allowed.today, month: allowed.month, orgMonth: allowed.orgMonth });
    return c.json(publicRevision(rev), 202);
  });

  reg.add({ method: 'get', path: REV, summary: 'A revision: its state, summary, the comments it addressed, and its tokens', tag: 'revise', params: ['id', 'revision'], auth: 'viewer' });
  app.get(REV, async (c) => {
    const scope = await scopedDocumentById(ctx, c, 'viewer');
    return c.json(publicRevision(await revisionOf(scope, c.req.param('revision'))));
  });

  reg.add({ method: 'get', path: `${REV}/diff/:file`, summary: 'Visual diff of one view from the base version to the proposal: <view>.svg is the picture, <view>.json the change list', tag: 'revise', params: ['id', 'revision', 'file'], query: ['theme'], auth: 'viewer' });
  app.get(`${REV}/diff/:file{[^/]+\\.(svg|json)}`, async (c) => {
    const scope = await scopedDocumentById(ctx, c, 'viewer');
    const rev = await revisionOf(scope, c.req.param('revision'));
    const base = rev.base_version_id ? await versionById(ctx.db, rev.base_version_id) : undefined;
    if (!base || rev.yaml === null) throw notFound('proposal');
    const file = c.req.param('file');
    const view = file.slice(0, file.lastIndexOf('.'));
    const d = await visualDiff(ctx, scope.document, base, { ...base, yaml: rev.yaml }, view, c.req.query('theme') === 'dark' ? 'dark' : 'light');
    if (file.endsWith('.json')) return c.json({ revision: rev.id, view, changes: d.changes });
    return c.body(d.svg, 200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'private, max-age=31536000, immutable' });
  });

  reg.add({ method: 'post', path: `${REV}/accept`, summary: `Save a ready revision as a new version, merged when the head moved, and resolve the comments it addressed. ${REFUSES}`, tag: 'revise', params: ['id', 'revision'], auth: 'author', responses: { '200': 'saved', '409': 'not ready, or the document changed in the same places', ...REFUSED } });
  app.post(`${REV}/accept`, async (c) => {
    const scope = await scopedDocumentById(ctx, c, 'author');
    const { p, workspace, document } = scope;
    const rev = await revisionOf(scope, c.req.param('revision'));
    if (rev.state !== 'ready' || rev.yaml === null || !rev.base_version_id) throw new HttpError(409, `this revision is ${rev.state}, not ready to accept`);
    const r = await saveDocument(ctx, { orgId: p.orgId, workspaceId: workspace.id, documentId: document.id, yaml: rev.yaml, message: versionMessage(rev), expectedVersionId: rev.base_version_id, authorUserId: p.userId, who: who(p), surface: p.surface });
    if (r.status === 'conflict') {
      ctx.log.info('revise.accept.conflict', { revisionId: rev.id, documentId: document.id, conflicts: r.conflicts });
      return c.json({ ...saveJson(r), error: 'the document changed in the same places since the revision was asked for; ask again' }, 409);
    }
    if (!(await moveRevision(ctx.db, rev.id, ['ready'], 'accepted', { versionId: r.version.id }))) throw new HttpError(409, 'this revision was accepted or rejected meanwhile');
    const actor = { orgId: p.orgId, userId: p.userId, who: `${who(p)} by revision ${rev.id}`, surface: p.surface };
    for (const id of rev.addressed) await resolveComment(ctx.db, ctx.log, actor, document.id, id, true).catch((err: unknown) => ctx.log.warn('revise.resolve.failed', { revisionId: rev.id, commentId: id, error: (err as Error).message }));
    ctx.metrics.revisions.add(1, { outcome: 'accepted' });
    ctx.log.info('revise.accepted', { revisionId: rev.id, documentId: document.id, versionId: r.version.id, status: r.status, resolved: rev.addressed.length, by: p.userId });
    return c.json({ ...saveJson(r), revision: publicRevision({ ...rev, state: 'accepted', version_id: r.version.id }) });
  });

  reg.add({ method: 'post', path: `${REV}/reject`, summary: 'Drop a ready revision; nothing is saved and its comments stay open', tag: 'revise', params: ['id', 'revision'], auth: 'author', responses: { '200': 'rejected', '409': 'not ready' } });
  app.post(`${REV}/reject`, async (c) => {
    const scope = await scopedDocumentById(ctx, c, 'author');
    const rev = await revisionOf(scope, c.req.param('revision'));
    if (!(await moveRevision(ctx.db, rev.id, ['ready'], 'rejected'))) throw new HttpError(409, `this revision is ${rev.state}, not ready`);
    ctx.metrics.revisions.add(1, { outcome: 'rejected' });
    ctx.log.info('revise.rejected', { revisionId: rev.id, documentId: scope.document.id, by: scope.p.userId });
    return c.json(publicRevision({ ...rev, state: 'rejected' }));
  });

  /** The month a request names with ?month=YYYY-MM, else this one. */
  const askedMonth = (q: string | undefined): Date => {
    if (q === undefined) return monthStart(new Date());
    const m = parseMonth(q);
    if (!m) throw badRequest('month is YYYY-MM');
    return m;
  };

  reg.add({ method: 'get', path: '/admin/ai-usage', summary: "Each person's revisions and tokens in one UTC month (default this one), split by model, the biggest spender first, with the organization's totals for the 12 months up to it", tag: 'admin', query: ['month'], auth: 'admin' });
  app.get('/admin/ai-usage', async (c) => {
    const p = requireAdmin(principal(c));
    const month = askedMonth(c.req.query('month'));
    const [people, months] = await Promise.all([usageForMonth(ctx.db, p.orgId, month), monthlyTotals(ctx.db, p.orgId, month, 12)]);
    return c.json({ month: monthKey(month), people, months });
  });

  reg.add({ method: 'get', path: '/admin/ai-usage.csv', summary: 'The same month as CSV, one line per person and model', tag: 'admin', query: ['month'], auth: 'admin' });
  app.get('/admin/ai-usage.csv', async (c) => {
    const p = requireAdmin(principal(c));
    const month = askedMonth(c.req.query('month'));
    const key = monthKey(month);
    return c.body(usageCsv(key, await usageForMonth(ctx.db, p.orgId, month)), 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="vantage-revisions-${key}.csv"` });
  });

  reg.add({ method: 'get', path: '/admin/ai-limits', summary: "What revisions may spend: each person's default daily and monthly tokens, the organization's monthly tokens, and the people with limits of their own", tag: 'admin', auth: 'admin' });
  app.get('/admin/ai-limits', async (c) => {
    const p = requireAdmin(principal(c));
    const [defaults, people] = await Promise.all([orgLimits(ctx.db, ctx.config, p.orgId), personLimits(ctx.db, p.orgId)]);
    return c.json({ defaults, people });
  });

  reg.add({ method: 'put', path: '/admin/ai-limits', summary: 'Set the default daily and monthly tokens for each person and the monthly tokens for the organization; null is no limit', tag: 'admin', body: { daily: 'tokens or null', monthly: 'tokens or null', orgMonthly: 'tokens or null' }, auth: 'admin' });
  app.put('/admin/ai-limits', async (c) => {
    const p = requireAdmin(principal(c));
    const input = await body(c, OrgLimitsSchema);
    await setOrgLimits(ctx.db, p.orgId, p.userId, input);
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'ai.limits.set', surface: p.surface, target: `org:${p.orgId}`, details: input });
    return c.json({ defaults: await orgLimits(ctx.db, ctx.config, p.orgId) });
  });

  reg.add({ method: 'put', path: '/admin/ai-limits/users/:user', summary: "Set one person's own daily and monthly tokens (left out or null keeps the default), or block them", tag: 'admin', params: ['user'], body: { daily: 'tokens or null', monthly: 'tokens or null', blocked: 'true or false' }, auth: 'admin' });
  app.put('/admin/ai-limits/users/:user', async (c) => {
    const p = requireAdmin(principal(c));
    const input = await body(c, PersonLimitsSchema);
    await setPersonLimits(ctx.db, p.orgId, c.req.param('user'), p.userId, input);
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'ai.limits.user.set', surface: p.surface, target: `user:${c.req.param('user')}`, details: input });
    return c.json({ people: await personLimits(ctx.db, p.orgId) });
  });

  reg.add({ method: 'delete', path: '/admin/ai-limits/users/:user', summary: 'Put a person back on the default limits', tag: 'admin', params: ['user'], auth: 'admin', responses: { '204': 'cleared' } });
  app.delete('/admin/ai-limits/users/:user', async (c) => {
    const p = requireAdmin(principal(c));
    await clearPersonLimits(ctx.db, p.orgId, c.req.param('user'));
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'ai.limits.user.clear', surface: p.surface, target: `user:${c.req.param('user')}` });
    return c.body(null, 204);
  });

  return app;
}

/** The version message: the revision's summary, cut to one line. */
function versionMessage(rev: RevisionRow): string {
  const line = (rev.summary ?? '').split(/\n/)[0]!.trim();
  return `revise: ${line.length > 160 ? `${line.slice(0, 157)}...` : line || `${rev.comment_ids.length} comment${rev.comment_ids.length === 1 ? '' : 's'}`}`;
}

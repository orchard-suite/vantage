/** Workspaces and grants. */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, Name, principal, Slug, who } from './common.ts';
import { accessibleWorkspaces, memberWorkspaces, DELETE_RULES, deleteRule, isWorkspaceOwner, requireWorkspace } from '../authz.ts';
import { audit } from '../audit.ts';
import { createTeamWorkspace } from '../workspace-create.ts';
import { randomId } from '../crypto.ts';
import { badRequest, forbidden, notFound } from '../http.ts';
import { maybe } from '../db/db.ts';
import { listNotifications, NotificationSettingsSchema } from '../notify/notify.ts';
import { listReviews } from '../worker/review.ts';

const Settings = z
  .object({
    retentionVersions: z.number().int().min(1).max(1000).optional(),
    /** Days after which an observed value dims in every picture of this workspace. */
    freshnessDays: z.number().int().min(1).max(365).optional(),
    guestLinks: z.boolean().optional(),
    /** Who may delete diagrams besides the owner and org admins; only they may change it. */
    deleteDiagrams: z.enum(DELETE_RULES).optional(),
    /** Where drift, review, and publication failures go; secrets by name. */
    notifications: NotificationSettingsSchema.optional(),
  })
  .strict();

export function workspaceRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  reg.add({ method: 'get', path: '/workspaces', summary: 'Workspaces the caller owns or was shared, with the role held; admins pass ?all=true for every workspace in the org', tag: 'workspaces', query: ['all'], auth: 'user' });
  app.get('/workspaces', async (c) => {
    const p = principal(c);
    const rows = c.req.query('all') === 'true' && p.admin ? await accessibleWorkspaces(ctx.db, p) : await memberWorkspaces(ctx.db, p);
    return c.json({ workspaces: rows.map((w) => ({ id: w.id, slug: w.slug, name: w.name, kind: w.kind, role: w.role, settings: w.settings, disabledAt: w.disabled_at })) });
  });

  reg.add({ method: 'post', path: '/workspaces', summary: 'Create a team workspace; the creator becomes an author. With TEAM_WORKSPACES=granted, admins and people an admin lets only', tag: 'workspaces', body: { name: 'display name', slug: 'optional url slug' }, responses: { '201': 'created', '403': 'not allowed to make team workspaces' } });
  app.post('/workspaces', async (c) => {
    const p = principal(c);
    const input = await body(c, z.object({ name: Name, slug: Slug.optional() }));
    const made = await createTeamWorkspace(ctx, p, who(p), input);
    return c.json({ ...made, kind: 'team', role: 'author' }, 201);
  });

  reg.add({ method: 'get', path: '/workspaces/:workspace', summary: 'One workspace; authors also see its grants', tag: 'workspaces', params: ['workspace'], auth: 'viewer' });
  app.get('/workspaces/:workspace', async (c) => {
    const ws = await requireWorkspace(ctx.db, c.get('principal'), c.req.param('workspace'), 'viewer');
    const grants = ws.role === 'author' ? await ctx.db.query('select id, role, subject_kind, subject_id, created_at from grants where workspace_id = $1 order by created_at', [ws.id]) : undefined;
    return c.json({ id: ws.id, slug: ws.slug, name: ws.name, kind: ws.kind, role: ws.role, settings: ws.settings, disabledAt: ws.disabled_at, purgeAfter: ws.purge_after, ...(grants ? { grants } : {}) });
  });

  reg.add({ method: 'patch', path: '/workspaces/:workspace', summary: 'Rename a workspace or change its settings (retention, freshness threshold, guest links, notifications, who may delete diagrams). Only the workspace owner and org admins change deleteDiagrams', tag: 'workspaces', params: ['workspace'], body: { name: 'display name', settings: 'retentionVersions, freshnessDays, guestLinks, deleteDiagrams: authors|makers|owner, notifications: { to: [{ person: email } | { group: slug } | { chain: slug }], kinds }' }, auth: 'author', responses: { '200': 'changed', '403': 'deleteDiagrams changed by someone other than the owner or an org admin' } });
  app.patch('/workspaces/:workspace', async (c) => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'author');
    const input = await body(c, z.object({ name: Name.optional(), settings: Settings.optional() }));
    if (input.settings?.deleteDiagrams !== undefined && input.settings.deleteDiagrams !== deleteRule(ws) && !isWorkspaceOwner(p, ws)) throw forbidden('only the workspace owner and org admins decide who may delete diagrams');
    const settings = { ...ws.settings, ...(input.settings ?? {}) };
    await ctx.db.query('update workspaces set name = $2, settings = $3 where id = $1', [ws.id, input.name ?? ws.name, JSON.stringify(settings)]);
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'workspace.update', surface: p.surface, target: `workspace:${ws.id}`, details: { name: input.name ?? null, settings: input.settings ?? null } });
    return c.json({ id: ws.id, slug: ws.slug, name: input.name ?? ws.name, settings });
  });

  reg.add({ method: 'get', path: '/workspaces/:workspace/notifications', summary: 'Notifications sent for this workspace, newest first, with delivery outcomes', tag: 'workspaces', params: ['workspace'], query: ['limit'], auth: 'viewer' });
  app.get('/workspaces/:workspace/notifications', async (c) => {
    const ws = await requireWorkspace(ctx.db, c.get('principal'), c.req.param('workspace'), 'viewer');
    const rows = await listNotifications(ctx, ws.id, Number(c.req.query('limit') ?? 50));
    return c.json({ notifications: rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, delivered: n.delivered, createdAt: n.created_at })) });
  });

  reg.add({ method: 'get', path: '/workspaces/:workspace/reviews', summary: 'Nightly reviews of this workspace, newest first, with per-document scores and drift', tag: 'workspaces', params: ['workspace'], query: ['limit'], auth: 'viewer' });
  app.get('/workspaces/:workspace/reviews', async (c) => {
    const ws = await requireWorkspace(ctx.db, c.get('principal'), c.req.param('workspace'), 'viewer');
    const rows = await listReviews(ctx, ws.id, Number(c.req.query('limit') ?? 30));
    return c.json({ reviews: rows.map((r) => ({ id: r.id, startedAt: r.started_at, finishedAt: r.finished_at, documents: r.documents, errors: r.errors, scoreDelta: r.score_delta, driftDelta: r.drift_delta, changed: r.summary.changed, summary: r.summary.documents })) });
  });

  reg.add({ method: 'post', path: '/workspaces/:workspace/grants', summary: 'Grant viewer or author to a user, a team, or the org', tag: 'workspaces', params: ['workspace'], body: { role: 'viewer|author', subjectKind: 'user|team|org', subjectId: 'user id, team id, or org id' }, auth: 'author', responses: { '201': 'created' } });
  app.post('/workspaces/:workspace/grants', async (c) => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'author');
    const input = await body(c, z.object({ role: z.enum(['viewer', 'author']), subjectKind: z.enum(['user', 'team', 'org']), subjectId: z.string().min(1) }));
    const exists = input.subjectKind === 'org' ? input.subjectId === p.orgId : await maybe(ctx.db, `select id from ${input.subjectKind === 'user' ? 'users' : 'teams'} where id = $1 and org_id = $2`, [input.subjectId, p.orgId]);
    if (!exists) throw badRequest(`${input.subjectKind} ${input.subjectId} not found`);
    const id = randomId();
    await ctx.db.query('insert into grants (id, org_id, workspace_id, role, subject_kind, subject_id) values ($1, $2, $3, $4, $5, $6) on conflict (workspace_id, subject_kind, subject_id) do update set role = excluded.role', [id, p.orgId, ws.id, input.role, input.subjectKind, input.subjectId]);
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'grant.set', surface: p.surface, target: `workspace:${ws.id}`, details: { ...input } });
    const row = await maybe<{ id: string }>(ctx.db, 'select id from grants where workspace_id = $1 and subject_kind = $2 and subject_id = $3', [ws.id, input.subjectKind, input.subjectId]);
    return c.json({ id: row!.id, ...input }, 201);
  });

  reg.add({ method: 'delete', path: '/workspaces/:workspace/grants/:grant', summary: 'Remove a grant', tag: 'workspaces', params: ['workspace', 'grant'], auth: 'author', responses: { '204': 'removed' } });
  app.delete('/workspaces/:workspace/grants/:grant', async (c) => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'author');
    const rows = await ctx.db.query('delete from grants where workspace_id = $1 and id = $2 returning id', [ws.id, c.req.param('grant')]);
    if (!rows.length) throw notFound('grant');
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'grant.remove', surface: p.surface, target: `workspace:${ws.id}`, details: { grantId: c.req.param('grant') } });
    return c.body(null, 204);
  });

  return app;
}

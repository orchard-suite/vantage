/** Organization administration: users, teams, workspace lifecycle, publications and connectors across every workspace, retention, jobs. */
import { renameFor } from '../tracking/roster.ts';
import { Hono } from 'hono';
import { z } from 'zod';
import { slug as slugOf } from '@vantage/model';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, Name, principal, Slug, who } from './common.ts';
import { requireAdmin, workspaceBySlug } from '../authz.ts';
import { audit } from '../audit.ts';
import { randomId } from '../crypto.ts';
import { badRequest, notFound } from '../http.ts';
import { maybe } from '../db/db.ts';
import { enqueue, listJobs } from '../worker/jobs.ts';
import { blockedReason, orgPublications, publicationById, setApproval } from '../publishing/repo.ts';
import { publicationJson } from './publications.ts';
import { orgConnectors, setConnectorApproval, sourceById } from '../sources/repo.ts';
import { sourceJson } from './sources.ts';

export function adminRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  app.use('/admin/*', async (c, next) => {
    requireAdmin(c.get('principal'));
    await next();
  });

  reg.add({ method: 'get', path: '/admin/users', summary: 'Every user in the org', tag: 'admin', auth: 'admin' });
  app.get('/admin/users', async (c) => {
    const p = principal(c);
    const rows = await ctx.db.query('select id, subject, email, display_name, is_admin, can_create_workspaces, disabled_at, created_at from users where org_id = $1 order by created_at', [p.orgId]);
    return c.json({ users: rows });
  });

  reg.add({ method: 'patch', path: '/admin/users/:user', summary: 'Disable or enable a user, set org admin, or let them make team workspaces. Disabling expires their guest links and transfers their personal workspace to the caller', tag: 'admin', params: ['user'], body: { disabled: 'true|false', admin: 'true|false', workspaceCreator: 'true|false' }, auth: 'admin' });
  app.patch('/admin/users/:user', async (c) => {
    const p = principal(c);
    const input = await body(c, z.object({ disabled: z.boolean().optional(), admin: z.boolean().optional(), workspaceCreator: z.boolean().optional() }));
    const id = c.req.param('user');
    const user = await maybe<{ id: string }>(ctx.db, 'select id from users where id = $1 and org_id = $2', [id, p.orgId]);
    if (!user) throw notFound('user');
    await ctx.db.transaction(async (tx) => {
      if (input.admin !== undefined) await tx.query('update users set is_admin = $2 where id = $1', [id, input.admin]);
      if (input.workspaceCreator !== undefined) await tx.query('update users set can_create_workspaces = $2 where id = $1', [id, input.workspaceCreator]);
      if (input.disabled === true) {
        await tx.query('update users set disabled_at = now() where id = $1 and disabled_at is null', [id]);
        await tx.query('update tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [id]);
        const links = await tx.query('update guest_links set revoked_at = now() where created_by = $1 and revoked_at is null returning id', [id]);
        const moved = await tx.query("update workspaces set owner_user_id = $2 where owner_user_id = $1 and kind = 'personal' returning id", [id, p.userId]);
        ctx.log.info('admin.user.disabled', { userId: id, guestLinksRevoked: links.length, workspacesTransferred: moved.length, to: p.userId });
      }
      if (input.disabled === false) await tx.query('update users set disabled_at = null where id = $1', [id]);
      await audit(tx, ctx.log, { orgId: p.orgId, who: who(p), what: 'user.update', surface: p.surface, target: `user:${id}`, details: { ...input } });
    });
    return c.json(await maybe(ctx.db, 'select id, subject, email, display_name, is_admin, can_create_workspaces, disabled_at from users where id = $1', [id]));
  });

  reg.add({ method: 'get', path: '/admin/teams', summary: 'Teams with their members', tag: 'admin', auth: 'admin' });
  app.get('/admin/teams', async (c) => {
    const p = principal(c);
    const teams = await ctx.db.query<{ id: string }>('select id, name, slug, external_group, created_at from teams where org_id = $1 order by name', [p.orgId]);
    const members = await ctx.db.query<{ team_id: string; user_id: string }>('select team_id, user_id from team_members where org_id = $1', [p.orgId]);
    return c.json({ teams: teams.map((t) => ({ ...t, members: members.filter((m) => m.team_id === t.id).map((m) => m.user_id) })) });
  });

  reg.add({ method: 'post', path: '/admin/teams', summary: 'Create a hub-managed team', tag: 'admin', body: { name: 'display name', slug: 'optional' }, auth: 'admin', responses: { '201': 'created' } });
  app.post('/admin/teams', async (c) => {
    const p = principal(c);
    const input = await body(c, z.object({ name: Name, slug: Slug.optional() }));
    const slug = input.slug ?? slugOf(input.name);
    if (await maybe(ctx.db, 'select id from teams where org_id = $1 and slug = $2', [p.orgId, slug])) throw badRequest(`team slug ${slug} is taken`);
    const id = randomId();
    await ctx.db.transaction(async (tx) => {
      await tx.query('insert into teams (id, org_id, name, slug) values ($1, $2, $3, $4)', [id, p.orgId, input.name, slug]);
      await renameFor(tx, p.orgId, { team: slug });
    });
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'team.create', surface: p.surface, target: `team:${id}`, details: { slug } });
    return c.json({ id, name: input.name, slug, members: [] }, 201);
  });

  reg.add({ method: 'put', path: '/admin/teams/:team/members/:user', summary: 'Add a user to a team', tag: 'admin', params: ['team', 'user'], auth: 'admin', responses: { '204': 'added' } });
  app.put('/admin/teams/:team/members/:user', async (c) => {
    const p = principal(c);
    const team = await maybe(ctx.db, 'select id from teams where id = $1 and org_id = $2', [c.req.param('team'), p.orgId]);
    const user = await maybe(ctx.db, 'select id from users where id = $1 and org_id = $2', [c.req.param('user'), p.orgId]);
    if (!team || !user) throw notFound(team ? 'user' : 'team');
    await ctx.db.query('insert into team_members (org_id, team_id, user_id) values ($1, $2, $3) on conflict do nothing', [p.orgId, c.req.param('team'), c.req.param('user')]);
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'team.member.add', surface: p.surface, target: `team:${c.req.param('team')}`, details: { userId: c.req.param('user') } });
    return c.body(null, 204);
  });

  reg.add({ method: 'delete', path: '/admin/teams/:team/members/:user', summary: 'Remove a user from a team', tag: 'admin', params: ['team', 'user'], auth: 'admin', responses: { '204': 'removed' } });
  app.delete('/admin/teams/:team/members/:user', async (c) => {
    const p = principal(c);
    const rows = await ctx.db.query('delete from team_members where team_id = $1 and user_id = $2 and org_id = $3 returning user_id', [c.req.param('team'), c.req.param('user'), p.orgId]);
    if (!rows.length) throw notFound('membership');
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'team.member.remove', surface: p.surface, target: `team:${c.req.param('team')}`, details: { userId: c.req.param('user') } });
    return c.body(null, 204);
  });

  reg.add({ method: 'post', path: '/admin/workspaces/:workspace/disable', summary: 'Disable a workspace; it purges after the grace period', tag: 'admin', params: ['workspace'], auth: 'admin' });
  app.post('/admin/workspaces/:workspace/disable', async (c) => {
    const p = principal(c);
    const ws = await workspaceBySlug(ctx.db, p.orgId, c.req.param('workspace'));
    if (!ws) throw notFound('workspace');
    const purgeAfter = new Date(Date.now() + ctx.config.PURGE_GRACE_DAYS * 86_400_000);
    await ctx.db.query('update workspaces set disabled_at = now(), purge_after = $2 where id = $1', [ws.id, purgeAfter]);
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'workspace.disable', surface: p.surface, target: `workspace:${ws.id}`, details: { purgeAfter: purgeAfter.toISOString() } });
    ctx.log.info('admin.workspace.disabled', { workspaceId: ws.id, purgeAfter: purgeAfter.toISOString() });
    return c.json({ id: ws.id, slug: ws.slug, disabled: true, purgeAfter });
  });

  reg.add({ method: 'post', path: '/admin/workspaces/:workspace/enable', summary: 'Re-enable a disabled workspace and cancel its purge', tag: 'admin', params: ['workspace'], auth: 'admin' });
  app.post('/admin/workspaces/:workspace/enable', async (c) => {
    const p = principal(c);
    const ws = await workspaceBySlug(ctx.db, p.orgId, c.req.param('workspace'));
    if (!ws) throw notFound('workspace');
    await ctx.db.query('update workspaces set disabled_at = null, purge_after = null where id = $1', [ws.id]);
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'workspace.enable', surface: p.surface, target: `workspace:${ws.id}` });
    return c.json({ id: ws.id, slug: ws.slug, disabled: false });
  });

  reg.add({ method: 'get', path: '/admin/publications', summary: 'Every publication in the org, waiting ones first, with its workspace, document, who set it up, and whether it may run', tag: 'admin', auth: 'admin' });
  app.get('/admin/publications', async (c) => {
    const p = principal(c);
    const rows = await orgPublications(ctx.db, p.orgId);
    return c.json({
      approvalRequired: ctx.config.PUBLICATION_APPROVAL,
      publications: rows.map((r) => ({ ...publicationJson(r, r.document_slug), workspace: r.workspace_slug, workspaceName: r.workspace_name, documentName: r.document_name, createdByName: r.created_by_name, approvalBy: r.approval_by, blocked: blockedReason(r, ctx.config.PUBLICATION_APPROVAL) ?? null })),
    });
  });

  for (const [action, approval] of [['approve', 'approved'], ['stop', 'stopped']] as const) {
    reg.add({ method: 'post', path: `/admin/publications/:publication/${action}`, summary: action === 'approve' ? 'Approve a publication so it may run; also lets a stopped one run again' : 'Stop a publication; it does not run again until an admin approves it', tag: 'admin', params: ['publication'], auth: 'admin' });
    app.post(`/admin/publications/:publication/${action}`, async (c) => {
      const p = principal(c);
      const pub = await publicationById(ctx.db, c.req.param('publication'));
      if (!pub || pub.org_id !== p.orgId) throw notFound('publication');
      await setApproval(ctx.db, pub.id, approval, p.userId);
      await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: `publication.${action}`, surface: p.surface, target: `publication:${pub.id}`, details: { before: pub.approval, target: pub.target, audience: pub.audience } });
      ctx.log.info(`admin.publication.${approval}`, { publicationId: pub.id, before: pub.approval });
      return c.json(publicationJson((await publicationById(ctx.db, pub.id))!));
    });
  }

  reg.add({ method: 'get', path: '/admin/connectors', summary: 'Every connector in the org, waiting ones first, with its workspace, its OAuth client, who added it, and whether it may push', tag: 'admin', auth: 'admin' });
  app.get('/admin/connectors', async (c) => {
    const p = principal(c);
    const rows = await orgConnectors(ctx.db, p.orgId);
    return c.json({ approvalRequired: ctx.config.CONNECTOR_APPROVAL, connectors: rows.map((r) => ({ ...sourceJson(r, ctx.config.CONNECTOR_APPROVAL), workspace: r.workspace_slug, workspaceName: r.workspace_name, createdByName: r.created_by_name, approvalBy: r.approval_by })) });
  });

  for (const [action, approval] of [['approve', 'approved'], ['stop', 'stopped']] as const) {
    reg.add({ method: 'post', path: `/admin/connectors/:connector/${action}`, summary: action === 'approve' ? 'Approve a connector so it may push; also lets a stopped one push again' : 'Stop a connector; it may not push until an admin approves it', tag: 'admin', params: ['connector'], auth: 'admin' });
    app.post(`/admin/connectors/:connector/${action}`, async (c) => {
      const p = principal(c);
      const s = await sourceById(ctx.db, c.req.param('connector'));
      if (!s || s.org_id !== p.orgId) throw notFound('connector');
      await setConnectorApproval(ctx.db, s.id, approval, p.userId);
      await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: `connector.${action}`, surface: p.surface, target: `connector:${s.id}`, details: { before: s.approval, connector: s.connector, clientId: s.client_id, workspaceId: s.workspace_id } });
      ctx.log.info(`admin.connector.${approval}`, { connectorId: s.id, before: s.approval });
      return c.json(sourceJson((await sourceById(ctx.db, s.id))!, ctx.config.CONNECTOR_APPROVAL));
    });
  }

  reg.add({ method: 'get', path: '/admin/retention', summary: 'Retention defaults and per-workspace overrides', tag: 'admin', auth: 'admin' });
  app.get('/admin/retention', async (c) => {
    const p = principal(c);
    const rows = await ctx.db.query<{ slug: string; settings: Record<string, unknown> }>('select slug, settings from workspaces where org_id = $1 order by slug', [p.orgId]);
    return c.json({ defaults: { retentionVersions: ctx.config.RETENTION_VERSIONS, purgeGraceDays: ctx.config.PURGE_GRACE_DAYS, freshnessDays: ctx.config.FRESHNESS_DAYS }, workspaces: rows.map((r) => ({ slug: r.slug, retentionVersions: r.settings['retentionVersions'] ?? null })) });
  });

  reg.add({ method: 'post', path: '/admin/retention/run', summary: 'Queue the gc and purge jobs now', tag: 'admin', auth: 'admin', responses: { '202': 'queued' } });
  app.post('/admin/retention/run', async (c) => {
    const p = principal(c);
    const gc = await enqueue(ctx.db, { orgId: p.orgId, kind: 'gc', payload: {} });
    const purge = await enqueue(ctx.db, { orgId: p.orgId, kind: 'purge', payload: {} });
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'retention.run', surface: p.surface, target: `org:${p.orgId}`, details: { gc, purge } });
    return c.json({ jobs: { gc, purge } }, 202);
  });

  reg.add({ method: 'get', path: '/admin/jobs', summary: 'Recent jobs with their run logs', tag: 'admin', query: ['limit'], auth: 'admin' });
  app.get('/admin/jobs', async (c) => {
    const p = principal(c);
    return c.json({ jobs: await listJobs(ctx.db, p.orgId, Number(c.req.query('limit') ?? 100)) });
  });

  return app;
}

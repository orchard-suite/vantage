/** Personal and automation tokens for the caller, the apps they connected by signing in, and the agents acting for them. */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, principal, who } from './common.ts';
import { createToken, listTokens, publicToken, revokeToken } from '../auth/tokens.ts';
import { mayCreateTeamWorkspace, requireWorkspace } from '../authz.ts';
import { audit } from '../audit.ts';
import { listGrants, revokeGrant } from '../auth/oauth.ts';
import { agentLabel, listAgents, revokeAgent } from '../auth/agents.ts';
import { forbidden, notFound } from '../http.ts';
import { READER_THEMES, readerTheme, setReaderTheme } from '../theme.ts';

export function tokenRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  reg.add({ method: 'get', path: '/me', summary: 'The caller: user, role, whether they may make team workspaces, teams, surface, the look they picked (system, light, or dark), and the CSRF token for cookie sessions', tag: 'auth' });
  app.get('/me', async (c) => {
    const p = principal(c);
    return c.json({ userId: p.userId, subject: p.subject, admin: p.admin, canCreateWorkspaces: await mayCreateTeamWorkspace(ctx.db, ctx.config.TEAM_WORKSPACES, p), theme: readerTheme(p), teams: p.teamIds, via: p.via, token: p.token ? { id: p.token.id, kind: p.token.kind, scope: p.token.scope } : null, agent: p.agent ?? null, ...(c.get('csrf') ? { csrf: c.get('csrf') } : {}) });
  });

  reg.add({ method: 'put', path: '/me/theme', summary: 'Pick the look of the hub pages and the viewer for the caller, on every device: system follows their system setting', tag: 'auth', body: { theme: 'system|light|dark' } });
  app.put('/me/theme', async (c) => {
    const p = principal(c);
    if (p.connector || p.token?.kind === 'automation') throw forbidden('only a person has a look');
    const { theme } = await body(c, z.object({ theme: z.enum(READER_THEMES) }));
    await setReaderTheme(ctx.db, p.userId, theme);
    ctx.log.info('me.theme', { userId: p.userId, theme });
    return c.json({ theme });
  });

  reg.add({ method: 'get', path: '/tokens', summary: 'Tokens the caller owns (admins: every token in the org with ?all=true)', tag: 'tokens', query: ['all'] });
  app.get('/tokens', async (c) => {
    const p = principal(c);
    const all = c.req.query('all') === 'true' && p.admin;
    return c.json({ tokens: (await listTokens(ctx.db, p.orgId, all ? null : p.userId)).map(publicToken) });
  });

  reg.add({ method: 'post', path: '/tokens', summary: 'Create a personal token, or an automation token scoped to one workspace; the secret is returned once', tag: 'tokens', body: { name: 'label', kind: 'personal|automation', workspace: 'slug (automation)', role: 'viewer|author (automation)', expiresInDays: 'optional' }, responses: { '201': 'created with token' } });
  app.post('/tokens', async (c) => {
    const p = principal(c);
    if (p.via === 'token' && p.token?.kind !== 'personal') throw forbidden('only a person or a personal token may mint tokens');
    const input = await body(c, z.object({ name: z.string().min(1).max(100), kind: z.enum(['personal', 'automation']).default('personal'), workspace: z.string().optional(), role: z.enum(['viewer', 'author']).optional(), expiresInDays: z.number().int().min(1).max(3650).optional() }));
    const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
    let scope = {};
    if (input.kind === 'automation') {
      if (!input.workspace || !input.role) throw forbidden('automation tokens need workspace and role');
      const ws = await requireWorkspace(ctx.db, p, input.workspace, input.role);
      scope = { workspaceId: ws.id, role: input.role };
    }
    const { row, plaintext } = await createToken(ctx.db, { orgId: p.orgId, userId: p.userId, kind: input.kind, scope, name: input.name, expiresAt });
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'token.create', surface: p.surface, target: `user:${p.userId}`, details: { tokenId: row.id, kind: input.kind, scope } });
    return c.json({ ...publicToken(row), token: plaintext }, 201);
  });

  reg.add({ method: 'delete', path: '/tokens/:token', summary: 'Revoke a token', tag: 'tokens', params: ['token'], responses: { '204': 'revoked' } });
  app.delete('/tokens/:token', async (c) => {
    const p = principal(c);
    const ok = await revokeToken(ctx.db, p.orgId, c.req.param('token'), p.admin ? null : p.userId);
    if (!ok) throw notFound('token');
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'token.revoke', surface: p.surface, target: `user:${p.userId}`, details: { tokenId: c.req.param('token') } });
    return c.body(null, 204);
  });

  reg.add({ method: 'get', path: '/connections', summary: 'Apps the caller connected by signing in through the hub (an agent such as Claude), with when each was last used', tag: 'tokens' });
  app.get('/connections', async (c) => {
    const p = principal(c);
    return c.json({ connections: (await listGrants(ctx.db, p.userId)).map((g) => ({ id: g.id, name: g.client_name, createdAt: g.created_at, lastUsedAt: g.last_used_at })) });
  });

  reg.add({ method: 'delete', path: '/connections/:connection', summary: 'Disconnect an app: its access ends now and it must ask again', tag: 'tokens', params: ['connection'], responses: { '204': 'disconnected' } });
  app.delete('/connections/:connection', async (c) => {
    const p = principal(c);
    const ok = await revokeGrant(ctx.db, p.orgId, c.req.param('connection'), p.admin ? null : p.userId);
    if (!ok) throw notFound('connection');
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'connection.revoke', surface: p.surface, target: `user:${p.userId}`, details: { grantId: c.req.param('connection') } });
    return c.body(null, 204);
  });

  reg.add({ method: 'get', path: '/agents', summary: 'The agents acting for the caller (VAN-2009): each with its name, client, host, when it connected, and when it last called the hub', tag: 'tokens' });
  app.get('/agents', async (c) => {
    const p = principal(c);
    return c.json({ agents: (await listAgents(ctx.db, p.userId)).map((a) => ({ id: a.id, name: a.name, label: agentLabel(a), client: a.client, host: a.host, createdAt: a.created_at, lastUsedAt: a.last_used_at })) });
  });

  reg.add({ method: 'delete', path: '/agents/:agent', summary: 'Disconnect an agent: its tokens and grants end now, and it must sign in again', tag: 'tokens', params: ['agent'], responses: { '204': 'disconnected' } });
  app.delete('/agents/:agent', async (c) => {
    const p = principal(c);
    const ok = await revokeAgent(ctx.db, p.orgId, c.req.param('agent'), p.admin ? null : p.userId);
    if (!ok) throw notFound('agent');
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'agent.revoke', surface: p.surface, target: `user:${p.userId}`, details: { agentId: c.req.param('agent') } });
    return c.body(null, 204);
  });

  return app;
}

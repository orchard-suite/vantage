/**
 * How a reader keeps their library in order: stars (theirs alone),
 * folders inside a workspace (authors make and fill them, everyone sees
 * them), and invites by email (authors). The home and workspace pages
 * call these from the browser with the session's CSRF token.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, principal, scopedDocumentById, who } from './common.ts';
import { requireWorkspace } from '../authz.ts';
import { audit } from '../audit.ts';
import { randomId } from '../crypto.ts';
import { maybe } from '../db/db.ts';
import { HttpError, badRequest, notFound } from '../http.ts';
import { grantUser, normalEmail, userByEmail, type InviteRow } from '../library/invites.ts';

const FolderName = z.string().trim().min(1).max(80);

interface FolderRow {
  readonly id: string;
  readonly name: string;
  readonly created_at: Date;
}

export function libraryRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  reg.add({ method: 'put', path: '/documents/:id/star', summary: 'Star a document for yourself', tag: 'library', params: ['id'], auth: 'viewer', responses: { '204': 'starred' } });
  app.put('/documents/:id/star', async (c) => {
    const { p, document } = await scopedDocumentById(ctx, c, 'viewer');
    await ctx.db.query('insert into stars (user_id, document_id) values ($1, $2) on conflict do nothing', [p.userId, document.id]);
    return c.body(null, 204);
  });

  reg.add({ method: 'delete', path: '/documents/:id/star', summary: 'Remove your star', tag: 'library', params: ['id'], auth: 'viewer', responses: { '204': 'unstarred' } });
  app.delete('/documents/:id/star', async (c) => {
    const { p, document } = await scopedDocumentById(ctx, c, 'viewer');
    await ctx.db.query('delete from stars where user_id = $1 and document_id = $2', [p.userId, document.id]);
    return c.body(null, 204);
  });

  const folders = '/workspaces/:workspace/folders';
  reg.add({ method: 'get', path: folders, summary: 'Folders in a workspace with how many diagrams each holds', tag: 'library', params: ['workspace'], auth: 'viewer' });
  app.get(folders, async (c) => {
    const ws = await requireWorkspace(ctx.db, principal(c), c.req.param('workspace'), 'viewer');
    const rows = await ctx.db.query<FolderRow & { n: string }>('select f.id, f.name, f.created_at, count(d.id)::text as n from folders f left join documents d on d.folder_id = f.id where f.workspace_id = $1 group by f.id order by lower(f.name)', [ws.id]);
    return c.json({ folders: rows.map((r) => ({ id: r.id, name: r.name, documents: Number(r.n), createdAt: r.created_at })) });
  });

  reg.add({ method: 'post', path: folders, summary: 'Make a folder', tag: 'library', params: ['workspace'], body: { name: 'up to 80 characters, unique in the workspace' }, auth: 'author', responses: { '201': 'created', '409': 'the name is taken' } });
  app.post(folders, async (c) => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'author');
    const { name } = await body(c, z.object({ name: FolderName }));
    if (await maybe(ctx.db, 'select 1 as x from folders where workspace_id = $1 and lower(name) = lower($2)', [ws.id, name])) throw new HttpError(409, `there is already a folder called ${name}`);
    const id = randomId();
    await ctx.db.query('insert into folders (id, org_id, workspace_id, name) values ($1, $2, $3, $4)', [id, p.orgId, ws.id, name]);
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'folder.create', surface: p.surface, target: `workspace:${ws.id}`, details: { folderId: id, name } });
    return c.json({ id, name, documents: 0 }, 201);
  });

  reg.add({ method: 'patch', path: `${folders}/:folder`, summary: 'Rename a folder', tag: 'library', params: ['workspace', 'folder'], body: { name: 'the new name' }, auth: 'author' });
  app.patch(`${folders}/:folder`, async (c) => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'author');
    const { name } = await body(c, z.object({ name: FolderName }));
    if (await maybe(ctx.db, 'select 1 as x from folders where workspace_id = $1 and lower(name) = lower($2) and id <> $3', [ws.id, name, c.req.param('folder')])) throw new HttpError(409, `there is already a folder called ${name}`);
    const rows = await ctx.db.query('update folders set name = $3 where workspace_id = $1 and id = $2 returning id', [ws.id, c.req.param('folder'), name]);
    if (!rows.length) throw notFound('folder');
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'folder.update', surface: p.surface, target: `workspace:${ws.id}`, details: { folderId: c.req.param('folder'), name } });
    return c.json({ id: c.req.param('folder'), name });
  });

  reg.add({ method: 'delete', path: `${folders}/:folder`, summary: 'Remove a folder; its diagrams stay in the workspace, outside any folder', tag: 'library', params: ['workspace', 'folder'], auth: 'author', responses: { '204': 'removed' } });
  app.delete(`${folders}/:folder`, async (c) => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'author');
    const rows = await ctx.db.query('delete from folders where workspace_id = $1 and id = $2 returning id', [ws.id, c.req.param('folder')]);
    if (!rows.length) throw notFound('folder');
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'folder.delete', surface: p.surface, target: `workspace:${ws.id}`, details: { folderId: c.req.param('folder') } });
    return c.body(null, 204);
  });

  reg.add({ method: 'put', path: '/documents/:id/folder', summary: 'Move a document into a folder of its workspace, or out of any (folderId null)', tag: 'library', params: ['id'], body: { folderId: 'a folder id, or null' }, auth: 'author' });
  app.put('/documents/:id/folder', async (c) => {
    const { p, document } = await scopedDocumentById(ctx, c, 'author');
    const { folderId } = await body(c, z.object({ folderId: z.string().min(1).nullable() }));
    if (folderId && !(await maybe(ctx.db, 'select 1 as x from folders where id = $1 and workspace_id = $2', [folderId, document.workspace_id]))) throw badRequest('that folder is not in this document\'s workspace');
    await ctx.db.query('update documents set folder_id = $2 where id = $1', [document.id, folderId]);
    ctx.log.info('document.folder', { documentId: document.id, folderId, by: p.userId });
    return c.json({ id: document.id, folderId });
  });

  const invites = '/workspaces/:workspace/invites';
  reg.add({ method: 'get', path: invites, summary: 'Invites still waiting for their first sign-in', tag: 'workspaces', params: ['workspace'], auth: 'author' });
  app.get(invites, async (c) => {
    const ws = await requireWorkspace(ctx.db, principal(c), c.req.param('workspace'), 'author');
    const rows = await ctx.db.query<InviteRow>('select * from invites where workspace_id = $1 and accepted_at is null order by created_at desc', [ws.id]);
    return c.json({ invites: rows.map((r) => ({ id: r.id, email: r.email, role: r.role, createdAt: r.created_at })) });
  });

  reg.add({ method: 'post', path: invites, summary: 'Invite by email: a grant now when the address has signed in before, else on its first sign-in', tag: 'workspaces', params: ['workspace'], body: { email: 'the address', role: 'viewer|author' }, auth: 'author', responses: { '200': 'granted at once', '201': 'invite waiting' } });
  app.post(invites, async (c) => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'author');
    const input = await body(c, z.object({ email: z.string().trim().email().max(254), role: z.enum(['viewer', 'author']) }));
    const email = normalEmail(input.email);
    const user = await userByEmail(ctx.db, p.orgId, email);
    if (user) {
      await grantUser(ctx.db, p.orgId, ws.id, user.id, input.role);
      await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'grant.set', surface: p.surface, target: `workspace:${ws.id}`, details: { role: input.role, subjectKind: 'user', subjectId: user.id, via: 'invite' } });
      return c.json({ status: 'granted', email, role: input.role, userId: user.id }, 200);
    }
    const id = randomId();
    await ctx.db.query(
      `insert into invites (id, org_id, workspace_id, email, role, invited_by) values ($1, $2, $3, $4, $5, $6)
       on conflict (workspace_id, email) do update set role = excluded.role, accepted_at = null, invited_by = excluded.invited_by`,
      [id, p.orgId, ws.id, email, input.role, p.userId.startsWith('source:') ? null : p.userId],
    );
    const row = await maybe<{ id: string }>(ctx.db, 'select id from invites where workspace_id = $1 and email = $2', [ws.id, email]);
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'invite.create', surface: p.surface, target: `workspace:${ws.id}`, details: { email, role: input.role } });
    return c.json({ status: 'invited', id: row!.id, email, role: input.role }, 201);
  });

  reg.add({ method: 'delete', path: `${invites}/:invite`, summary: 'Withdraw an invite', tag: 'workspaces', params: ['workspace', 'invite'], auth: 'author', responses: { '204': 'withdrawn' } });
  app.delete(`${invites}/:invite`, async (c) => {
    const p = principal(c);
    const ws = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'author');
    const rows = await ctx.db.query('delete from invites where workspace_id = $1 and id = $2 and accepted_at is null returning email', [ws.id, c.req.param('invite')]);
    if (!rows.length) throw notFound('invite');
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'invite.delete', surface: p.surface, target: `workspace:${ws.id}`, details: { inviteId: c.req.param('invite') } });
    return c.body(null, 204);
  });

  return app;
}

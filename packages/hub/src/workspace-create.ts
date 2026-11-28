/**
 * Making a team workspace: the caller becomes its author. With
 * TEAM_WORKSPACES=granted only admins and the people an admin lets may.
 * The HTTP API and the agent tools both make workspaces here.
 */
import { slug as slugOf } from '@vantage/model';
import type { AppContext } from './context.ts';
import type { Principal } from './auth/principal.ts';
import { mayCreateTeamWorkspace, workspaceBySlug } from './authz.ts';
import { audit } from './audit.ts';
import { randomId } from './crypto.ts';
import { badRequest, forbidden } from './http.ts';

export interface CreatedWorkspace {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

/** Slugs an address reads as the hub's own things, never as a workspace. */
const RESERVED = new Set(['guide', 'schema', 'scopes', 'standard', 'conflicts']);

export async function createTeamWorkspace(ctx: AppContext, p: Principal, who: string, input: { name: string; slug?: string | undefined }): Promise<CreatedWorkspace> {
  if (!(await mayCreateTeamWorkspace(ctx.db, ctx.config.TEAM_WORKSPACES, p))) throw forbidden('only admins and people an admin lets may make team workspaces here');
  const slug = input.slug ?? slugOf(input.name);
  if (RESERVED.has(slug)) throw badRequest(`workspace slug ${slug} is an address of the hub itself; pick another`);
  if (await workspaceBySlug(ctx.db, p.orgId, slug)) throw badRequest(`workspace slug ${slug} is taken`);
  const id = randomId();
  await ctx.db.transaction(async (tx) => {
    await tx.query("insert into workspaces (id, org_id, kind, name, slug, owner_user_id) values ($1, $2, 'team', $3, $4, $5)", [id, p.orgId, input.name, slug, p.userId]);
    await tx.query("insert into grants (id, org_id, workspace_id, role, subject_kind, subject_id) values ($1, $2, $3, 'author', 'user', $4)", [randomId(), p.orgId, id, p.userId]);
    await audit(tx, ctx.log, { orgId: p.orgId, who, what: 'workspace.create', surface: p.surface, target: `workspace:${id}`, details: { slug } });
  });
  ctx.log.info('workspace.created', { workspaceId: id, slug, by: p.userId });
  return { id, slug, name: input.name };
}

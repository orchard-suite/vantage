/**
 * The admin console's pages, mounted at /admin, for org admins only: the
 * deployment (or a search of it), one workspace, one person, and what
 * revisions spend.
 */
import { Hono, type Context } from 'hono';
import type { AppContext } from '../context.ts';
import type { HubEnv } from './env.ts';
import type { Principal } from '../auth/principal.ts';
import type { AgentSetup } from '../agents.ts';
import type { HomeUser } from './home.ts';
import type { AdminFrame } from './admin-kit.ts';
import type { AdminConnector, AdminPublication } from './admin-flows.ts';
import { memberWorkspaces, requireAdmin } from '../authz.ts';
import { homeDocuments } from './home-data.ts';
import { blockedReason, orgPublications } from '../publishing/repo.ts';
import { connectorBlocked, orgConnectors } from '../sources/repo.ts';
import { notFound, unauthorized } from '../http.ts';
import { adminFootprint, adminRevisions, adminWorkspaceDetail, findDiagrams, type Footprint } from './admin-data.ts';
import { adminHomeHtml } from './admin.ts';
import { adminWorkspaceHtml } from './admin-workspace.ts';
import { adminPersonHtml } from './admin-person.ts';
import { adminRevisionsHtml } from './admin-revisions.ts';

export function adminRoutes(ctx: AppContext, frameUser: (p: Principal) => Promise<HomeUser>, agents: AgentSetup): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  const admin = (c: Context<HubEnv>): Principal => {
    const p = c.get('principal');
    if (!p) throw unauthorized();
    return requireAdmin(p);
  };

  const frame = async (c: Context<HubEnv>, p: Principal): Promise<AdminFrame> => {
    const workspaces = await memberWorkspaces(ctx.db, p);
    const csrf = c.get('csrf');
    return { nonce: c.get('nonce'), ...(csrf ? { csrf } : {}), user: await frameUser(p), workspaces, documents: await homeDocuments(ctx.dbRead, workspaces, p.userId), agents };
  };

  /** Every connector and publication; `off` holds the ids of disabled workspaces. */
  const edges = async (orgId: string, off: ReadonlySet<string>): Promise<{ connectors: AdminConnector[]; publications: AdminPublication[] }> => {
    const [pubs, conns] = await Promise.all([orgPublications(ctx.db, orgId), orgConnectors(ctx.db, orgId)]);
    return {
      publications: pubs.map((r) => ({ row: r, workspaceSlug: r.workspace_slug, workspaceName: r.workspace_name, documentName: r.document_name, createdByName: r.created_by_name, blocked: blockedReason(r, ctx.config.PUBLICATION_APPROVAL), workspaceOff: off.has(r.workspace_id) })),
      connectors: conns.map((r) => ({ row: r, workspaceSlug: r.workspace_slug, workspaceName: r.workspace_name, createdByName: r.created_by_name, blocked: connectorBlocked(r, ctx.config.CONNECTOR_APPROVAL), workspaceOff: off.has(r.workspace_id) })),
    };
  };

  const disabled = (fp: Footprint): Set<string> => new Set(fp.workspaces.filter((w) => w.disabledAt).map((w) => w.id));

  app.get('/', async (c) => {
    const p = admin(c);
    const q = c.req.query('q')?.trim() ?? '';
    const [f, footprint, found] = await Promise.all([frame(c, p), adminFootprint(ctx.dbRead, p.orgId), q ? findDiagrams(ctx.dbRead, p.orgId, q) : Promise.resolve(undefined)]);
    const e = await edges(p.orgId, disabled(footprint));
    return c.html(adminHomeHtml({ ...f, policy: ctx.config, footprint, ...e, ...(q ? { query: q, found: found ?? [] } : {}) }));
  });

  app.get('/w/:workspace', async (c) => {
    const p = admin(c);
    const [f, footprint] = await Promise.all([frame(c, p), adminFootprint(ctx.dbRead, p.orgId)]);
    const e = await edges(p.orgId, disabled(footprint));
    const detail = await adminWorkspaceDetail(ctx.dbRead, footprint, c.req.param('workspace'));
    if (!detail) throw notFound('workspace');
    const id = detail.workspace.id;
    return c.html(
      adminWorkspaceHtml({
        ...f,
        policy: ctx.config,
        detail,
        deploymentBytes: footprint.workspaces.reduce((s, w) => s + w.bytes, 0),
        connectors: e.connectors.filter((x) => x.row.workspace_id === id),
        publications: e.publications.filter((x) => x.row.workspace_id === id),
        targets: footprint.workspaces.filter((w) => !w.disabledAt).map((w) => ({ slug: w.slug, name: w.name })),
      }),
    );
  });

  app.get('/people/:user', async (c) => {
    const p = admin(c);
    const [f, footprint] = await Promise.all([frame(c, p), adminFootprint(ctx.dbRead, p.orgId)]);
    const person = footprint.people.find((x) => x.id === c.req.param('user'));
    if (!person) throw notFound('user');
    return c.html(adminPersonHtml({ ...f, granted: ctx.config.TEAM_WORKSPACES === 'granted', person, owned: footprint.workspaces.filter((w) => w.ownerId === person.id), memberships: footprint.memberships.get(person.id) ?? [] }));
  });

  app.get('/revisions', async (c) => {
    const p = admin(c);
    const [f, footprint] = await Promise.all([frame(c, p), adminFootprint(ctx.dbRead, p.orgId)]);
    const revisions = ctx.ai ? await adminRevisions(ctx.db, ctx.config, p.orgId, c.req.query('month'), footprint.people) : undefined;
    return c.html(adminRevisionsHtml(f, ctx.config, revisions));
  });

  return app;
}

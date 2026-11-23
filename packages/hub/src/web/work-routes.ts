/**
 * The work pages' data: the Work tab's model and the page of one item at
 * /w/:workspace/work/:key. Both read through the tracking verbs, so a
 * person named on an item sees the same item an agent or a module would,
 * and a person who may not see it is answered as if it did not exist.
 */
import { Hono } from 'hono';
import type { AppContext } from '../context.ts';
import type { HubEnv } from './env.ts';
import type { Principal } from '../auth/principal.ts';
import type { AgentSetup } from '../agents.ts';
import type { HomeUser } from './home.ts';
import { memberWorkspaces, accessibleWorkspaces } from '../authz.ts';
import { maybe } from '../db/db.ts';
import { unauthorized } from '../http.ts';
import { appPage } from './frame.ts';
import { frameWorkspaces } from './home.ts';
import { homeDocuments } from './home-data.ts';
import { spaceName } from './library.ts';
import { findItem } from '../tracking/access.ts';
import { membersOf, openMoves } from '../tracking/gate.ts';
import { bodyOf, cardOf, filesOf, find, history, linksOf, notes } from '../tracking/read.ts';
import type { KindRow } from '../tracking/kinds.ts';
import { itemBody, itemUrl, looksOf, WORK_SCRIPT, type WorkLook, type WorkTabModel } from './work-page.ts';

export async function workTabModel(ctx: AppContext, p: Principal, kinds: readonly KindRow[], q: Record<string, string>): Promise<WorkTabModel> {
  const current = kinds.find((k) => k.prefix === q['kind']) ?? kinds[0];
  if (!current) return { kinds, counts: {}, rows: [], total: 0, look: 'list' };
  const state = current.definition.states.some((s) => s.id === q['state']) ? q['state'] : undefined;
  const counts = (await find(ctx, p, { kinds: [current.prefix], countBy: 'state' })).counts ?? {};
  const page = await find(ctx, p, { kinds: [current.prefix], ...(state ? { state } : {}), limit: 100 });
  const looks = looksOf(current);
  const asked = q['look'] as WorkLook | undefined;
  // A roadmap opens on its board; a kind of work opens as a list.
  const look: WorkLook = asked && looks.includes(asked) ? asked : looks.includes('board') ? 'board' : 'list';
  return { kinds, current, counts, rows: page.rows, total: page.total, state, look };
}

export function workRoutes(ctx: AppContext, frameUser: (p: Principal) => Promise<HomeUser>, agents: AgentSetup): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  app.get('/w/:workspace/work/:key', async (c) => {
    const p = c.get('principal');
    if (!p) throw unauthorized();
    const f = await findItem(ctx, p, c.req.param('key'));
    const ws = await maybe<{ slug: string }>(ctx.db, 'select slug from workspaces where id = $1', [f.item.workspaceId]);
    // An item is read from the workspace that holds its kind; an old or hand-made link is sent there.
    if (ws && ws.slug !== c.req.param('workspace')) return c.redirect(itemUrl(ws.slug, f.item.key));
    const card = await cardOf(ctx, f);
    const members = await membersOf(ctx.db, p.orgId, f.kind.definition);
    const [n, h, links, files, body] = await Promise.all([notes(ctx, f), history(ctx, f), linksOf(ctx, f), filesOf(ctx, f), bodyOf(ctx, f.item)]);
    const docSlug = (await maybe<{ slug: string }>(ctx.db, 'select slug from documents where id = $1', [f.kind.document_id]))?.slug ?? '';
    const workspace = (await accessibleWorkspaces(ctx.db, p)).find((w) => w.id === f.item.workspaceId);
    const workspaces = await memberWorkspaces(ctx.db, p);
    const documents = await homeDocuments(ctx.dbRead, workspaces, p.userId);
    const { spaces, shared, starred } = frameWorkspaces(workspaces, documents, p.userId);
    const csrf = c.get('csrf');
    const lifecycleUrl = f.kind.definition.drawnIn.shipped ? undefined : `/w/${encodeURIComponent(ws?.slug ?? '')}/${encodeURIComponent(docSlug)}#${encodeURIComponent(f.kind.definition.drawnIn.view)}`;
    const html = itemBody(workspace, workspace ? spaceName(workspace, p.userId) : '', {
      card,
      body,
      moves: openMoves(f.kind.definition, f.item, f.caller, members),
      notes: n.lines.map((l) => l.replace(/^### /, '**').replace(/\n\n/, '**\n\n')),
      history: h.lines,
      links,
      files,
      author: f.caller.role === 'author',
      held: f.item.holders.includes(p.userId),
      lifecycleUrl,
    });
    return c.html(appPage({ title: `${card.key} ${card.title}`, nonce: c.get('nonce'), ...(csrf ? { csrf } : {}), user: await frameUser(p), workspaces: spaces, sharedCount: shared, starredCount: starred, place: workspace ? { kind: 'workspace', slug: workspace.slug } : { kind: 'home' }, agents, body: html }, WORK_SCRIPT));
  });

  return app;
}

/**
 * Browser routes: the shell, the admin page, the API page, the viewer per document with its bundle
 * (the event stream and presence are live-routes.ts), the embed route, guest link entry, the kit page, and
 * the font and brand files the pages load.
 */
import { Hono, type Context } from 'hono';
import { brandAsset, editorScript, engineScript, fontAsset, viewerScript } from '@vantage/render';
import type { AppContext } from '../context.ts';
import type { HubEnv } from './env.ts';
import { mayCreateTeamWorkspace, memberWorkspaces, requireWorkspace, workspaceBySlug } from '../authz.ts';
import type { Principal } from '../auth/principal.ts';
import { adminRoutes } from './admin-routes.ts';
import { documentBySlug, headVersion, movedTo } from '../documents/repo.ts';
import { embedHtml, messageHtml, passcodeHtml, viewerHtml } from './html.ts';
import { homeHtml } from './home.ts';
import { readerIdentity, homeDocuments, thumbnailArtifact } from './home-data.ts';
import type { FramePlace } from './frame.ts';
import type { HomeUser, ShellResult } from './home.ts';
import { listDecisions, listRegistries, present, recordUrl, requireDecision, searchDecisions } from '../decisions/read.ts';
import { countDecisions, placedByRef, refOf } from '../decisions/repo.ts';
import { STATUSES, type Registry } from '../decisions/types.ts';
import { citationsIn, decisionBody, type DecisionsTabModel } from './decisions-page.ts';
import { decisionCitations } from '../decisions/backlinks.ts';
import { appPage } from './frame.ts';
import { frameWorkspaces } from './home.ts';
import { spaceName } from './library.ts';
import { workspaceHtml, type WorkspaceTab } from './workspace.ts';
import { importHtml } from './import-page.ts';
import { newDiagramHtml } from './new-page.ts';
import { allowance } from '../revise/limits.ts';
import { starter, starterPicture } from './starters.ts';
import { workspaceActivity, workspaceFolders, workspaceInvites, workspaceMembers, workspacePublications, workspaceSources } from './workspace-data.ts';
import { kitHtml } from './kit.ts';
import { kindsIn } from '../tracking/kinds.ts';
import { find as findItems } from '../tracking/read.ts';
import { workRoutes, workTabModel } from './work-routes.ts';
import { apiHtml } from './api-page.ts';
import { API_VERSION } from '../api/index.ts';
import type { RouteDoc } from '../api/openapi.ts';
import { csp } from './middleware.ts';
import { GUEST_COOKIE, resolveFile } from './resolve.ts';
import { readerAudio, readerRecordings } from '../api/recordings.ts';
import { bundleResponse, headBundle, viewEntryResponse, viewKitResponse } from './bundle-serve.ts';
import { createRateLimiter } from '../ratelimit.ts';
import { HttpError, notFound, unauthorized } from '../http.ts';
import { searchDocuments } from '../search.ts';
import { listMentions } from '../mentions.ts';
import { checkPasscode, resolveGuestLink } from '../guest.ts';
import { cookieHeader, readCookie } from '../auth/session.ts';
import { open, seal } from '../crypto.ts';
import { readerTheme } from '../theme.ts';
import { agentSetup } from '../agents.ts';
import { accountHtml } from './account.ts';
import { listTokens } from '../auth/tokens.ts';
import { listGrants } from '../auth/oauth.ts';

export const GUEST_LIMIT = { requests: 120, windowMs: 60_000 };

export function pageRoutes(ctx: AppContext, apiReference: readonly RouteDoc[]): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  const guestLimiter = createRateLimiter(GUEST_LIMIT.requests, GUEST_LIMIT.windowMs);
  // A guest's viewer reads one entry per view of a large document, so entries have a limit of their own.
  const entryLimiter = createRateLimiter(GUEST_LIMIT.requests * 10, GUEST_LIMIT.windowMs);
  const secure = ctx.config.PUBLIC_URL.startsWith('https://');
  const agents = agentSetup(ctx.config.PUBLIC_URL, ctx.config.AGENT_SETUP);
  /** Who the sidebar shows as signed in, and what it offers them. */
  const frameUser = async (p: Principal): Promise<HomeUser & { readonly admin: boolean }> => ({
    id: p.userId,
    ...(await readerIdentity(ctx.db, p)),
    signOut: p.via === 'session',
    admin: p.admin,
    makesWorkspaces: await mayCreateTeamWorkspace(ctx.db, ctx.config.TEAM_WORKSPACES, p),
    theme: readerTheme(p),
  });

  /** Diagrams and decision records in one list, best match first. */
  const searchEverything = async (p: Principal, q: string): Promise<ShellResult[]> => {
    const [docs, decisions] = await Promise.all([searchDocuments(ctx.dbRead, p, q, 20), searchDecisions(ctx, p, q, 20)]);
    const hits: { rank: number; r: ShellResult }[] = [...docs.map((d) => ({ rank: d.rank, r: d })), ...decisions.map((d) => ({ rank: d.rank, r: { workspaceSlug: d.workspaceSlug, documentSlug: '', href: recordUrl(d.workspaceSlug, d.ref), name: `${d.ref} ${d.title}`, headline: d.headline } }))];
    return hits.sort((a, b) => b.rank - a.rank).slice(0, 20).map((h) => h.r);
  };

  /** The Decisions tab: the registry asked for (or the first), its records, and the filter from the query. */
  const decisionsTabModel = async (p: Principal, registries: readonly Registry[], q: Record<string, string>): Promise<DecisionsTabModel> => {
    const current = registries.find((r) => r.prefix === q['registry']) ?? registries[0];
    const category = q['category'] !== undefined && /^\d$/.test(q['category']) ? Number(q['category']) : undefined;
    const status = STATUSES.find((s) => s === q['status']);
    const words = q['q']?.trim() || undefined;
    if (!current) return { registries, all: [], shown: [], filter: {} };
    const all = await listDecisions(ctx, p, current.prefix);
    const shown = category === undefined && !status && !words ? all : await listDecisions(ctx, p, current.prefix, { category, status, query: words });
    return { registries, current, all, shown, filter: { registry: current.prefix, category, status, q: words } };
  };

  app.get('/', async (c) => {
    const p = c.get('principal');
    if (!p) throw unauthorized();
    const workspaces = await memberWorkspaces(ctx.db, p);
    const documents = await homeDocuments(ctx.dbRead, workspaces, p.userId);
    const q = c.req.query('q')?.trim();
    const results = q ? await searchEverything(p, q) : undefined;
    // Older links narrowed the home page to one workspace; that is the workspace page now.
    const ws = c.req.query('ws');
    if (ws && workspaces.some((w) => w.slug === ws)) return c.redirect(`/w/${encodeURIComponent(ws)}`);
    const show = c.req.query('show');
    const place: FramePlace = show === 'shared' ? { kind: 'shared' } : show === 'starred' ? { kind: 'starred' } : show === 'mentions' ? { kind: 'mentions' } : { kind: 'home' };
    const mentions = place.kind === 'mentions' ? await listMentions(ctx, p) : undefined;
    const csrf = c.get('csrf');
    ctx.log.debug('shell.render', { userId: p.userId, workspaces: workspaces.length, documents: documents.length, place: place.kind, query: q ?? null, results: results?.length ?? null });
    return c.html(homeHtml({
      nonce: c.get('nonce'),
      ...(csrf ? { csrf } : {}),
      user: await frameUser(p),
      workspaces,
      documents,
      place,
      sort: c.req.query('sort') === 'name' ? 'name' : 'recent',
      layout: c.req.query('layout') === 'list' ? 'list' : 'grid',
      agents,
      filter: { ...(c.req.query('in') ? { in: c.req.query('in')! } : {}), ...(c.req.query('by') ? { by: c.req.query('by')! } : {}) },
      ...(q ? { query: q, results: results ?? [] } : {}),
      ...(mentions ? { mentions } : {}),
    }));
  });

  app.get('/w/:workspace', async (c) => {
    const p = c.get('principal');
    if (!p) throw unauthorized();
    const workspace = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'viewer');
    const workspaces = await memberWorkspaces(ctx.db, p);
    // An admin may open a workspace nobody shared with them; it stays out of their sidebar.
    const visiting = !workspaces.some((w) => w.id === workspace.id);
    const documents = await homeDocuments(ctx.dbRead, visiting ? [...workspaces, workspace] : workspaces, p.userId);
    const asked = c.req.query('tab');
    const registries = await listRegistries(ctx, p, workspace.slug);
    const tab: WorkspaceTab = asked === 'decisions' || asked === 'work' || asked === 'connectors' || asked === 'publications' || asked === 'activity' || (asked === 'members' && workspace.role === 'author') ? asked : 'diagrams';
    // Counts on the tabs come with every tab; the lists are cheap at workspace scale.
    const [sources, publications, members] = await Promise.all([workspaceSources(ctx, workspace), workspacePublications(ctx.db, workspace), workspace.role === 'author' ? workspaceMembers(ctx.db, workspace) : Promise.resolve(undefined)]);
    const activity = tab === 'activity' ? await workspaceActivity(ctx.db, workspace) : undefined;
    const folders = tab === 'diagrams' ? await workspaceFolders(ctx.db, workspace) : undefined;
    const invites = tab === 'members' && workspace.role === 'author' ? await workspaceInvites(ctx.db, workspace) : undefined;
    const folder = c.req.query('folder');
    const decisions = tab === 'decisions' ? await decisionsTabModel(p, registries, c.req.query()) : undefined;
    const decisionCount = registries.length || tab === 'decisions' ? await countDecisions(ctx.dbRead, registries.map((r) => r.id)) : undefined;
    const kinds = await kindsIn(ctx.db, p.orgId, [workspace.id]);
    const work = tab === 'work' ? await workTabModel(ctx, p, kinds, c.req.query()) : undefined;
    const workCount = kinds.length ? (await findItems(ctx, p, { kinds: kinds.map((k) => k.prefix), limit: 1 })).total : undefined;
    const csrf = c.get('csrf');
    return c.html(workspaceHtml({
      nonce: c.get('nonce'),
      ...(csrf ? { csrf } : {}),
      user: await frameUser(p),
      workspace,
      workspaces,
      documents,
      visiting,
      tab,
      sort: c.req.query('sort') === 'name' ? 'name' : 'recent',
      layout: c.req.query('layout') === 'list' ? 'list' : 'grid',
      agents,
      sources,
      publications,
      approvalRequired: ctx.config.PUBLICATION_APPROVAL,
      connectorApproval: ctx.config.CONNECTOR_APPROVAL,
      ...(members ? { members } : {}),
      ...(activity ? { activity } : {}),
      ...(folders ? { folders } : {}),
      ...(folders && folder && folders.some((f) => f.id === folder) ? { folder } : {}),
      ...(invites ? { invites } : {}),
      ...(decisionCount !== undefined ? { decisionCount } : {}),
      ...(decisions ? { decisions } : {}),
      ...(workCount !== undefined ? { workCount } : {}),
      ...(work ? { work } : {}),
    }));
  });

  app.get('/w/:workspace/decisions/:ref', async (c) => {
    const p = c.get('principal');
    if (!p) throw unauthorized();
    const ref = c.req.param('ref');
    const { row, workspace: wsSlug } = await requireDecision(ctx, p, ref, 'viewer');
    // A record is read from the workspace that holds its registry; an old or hand-made link is sent there.
    if (wsSlug !== c.req.param('workspace') || ref !== refOf(row)) return c.redirect(recordUrl(wsSlug, refOf(row)));
    const workspace = await requireWorkspace(ctx.db, p, wsSlug, 'viewer');
    const [d] = await present(ctx, p, [row]);
    const cites = new Map<string, { url: string; title: string }>();
    const open = new Map((await listRegistries(ctx, p)).map((r) => [r.id, r.workspace]));
    for (const text of citationsIn(d!)) {
      const hit = await placedByRef(ctx.db, p.orgId, text, row.registry_id);
      const ws = hit ? open.get(hit.registry_id) : undefined;
      if (hit && ws) cites.set(text, { url: recordUrl(ws, refOf(hit)), title: hit.title });
    }
    const workspaces = await memberWorkspaces(ctx.db, p);
    const documents = await homeDocuments(ctx.dbRead, workspaces, p.userId);
    const { spaces, shared, starred } = frameWorkspaces(workspaces, documents, p.userId);
    const csrf = c.get('csrf');
    const user = await frameUser(p);
    return c.html(appPage({ title: `${d!.ref} ${d!.title}`, nonce: c.get('nonce'), ...(csrf ? { csrf } : {}), user, workspaces: spaces, sharedCount: shared, starredCount: starred, place: { kind: 'workspace', slug: workspace.slug }, agents, body: decisionBody(d!, workspace, spaceName(workspace, p.userId), cites, await decisionCitations(ctx, p, refOf(row))) }));
  });

  app.route('/admin', adminRoutes(ctx, frameUser, agents));
  app.route('/', workRoutes(ctx, frameUser, agents));

  app.get('/import/:workspace', async (c) => {
    const p = c.get('principal');
    if (!p) throw unauthorized();
    const workspace = await requireWorkspace(ctx.db, p, c.req.param('workspace'), 'author');
    const workspaces = await memberWorkspaces(ctx.db, p);
    const csrf = c.get('csrf');
    return c.html(importHtml({
      nonce: c.get('nonce'),
      ...(csrf ? { csrf } : {}),
      user: await frameUser(p),
      workspace,
      workspaces,
      documents: await homeDocuments(ctx.dbRead, workspaces, p.userId),
      agents,
    }));
  });

  // A new diagram: the reader's own space unless ?in= names another they edit.
  app.get('/new', async (c) => {
    const p = c.get('principal');
    if (!p) throw unauthorized();
    const workspaces = await memberWorkspaces(ctx.db, p);
    const asked = c.req.query('in');
    const editable = workspaces.filter((w) => w.role === 'author');
    // The workspace the reader names, also one an admin reaches from the admin console; else their own space.
    const named = asked ? await requireWorkspace(ctx.db, p, asked, 'viewer').catch(() => undefined) : undefined;
    const workspace = (named?.role === 'author' ? named : undefined) ?? editable.find((w) => w.kind === 'personal' && w.owner_user_id === p.userId) ?? editable[0];
    if (!workspace) throw new HttpError(403, 'you cannot edit any workspace on this hub');
    const csrf = c.get('csrf');
    return c.html(newDiagramHtml({
      nonce: c.get('nonce'),
      ...(csrf ? { csrf } : {}),
      user: await frameUser(p),
      workspace,
      workspaces,
      documents: await homeDocuments(ctx.dbRead, workspaces, p.userId),
      starter: starter(c.req.query('from')),
      agents,
      describe: ctx.ai ? { models: await ctx.ai.models(), defaultModel: ctx.ai.defaultModel, allowance: await allowance(ctx.db, ctx.config, p.orgId, p.userId) } : undefined,
    }));
  });

  // An example's card picture, drawn once per process. Signed in readers only, like the pages that show it.
  app.get('/starters/:file', (c) => {
    if (!c.get('principal')) throw unauthorized();
    const svg = starterPicture(c.req.param('file').replace(/\.svg$/, ''));
    if (!svg) throw notFound('starter');
    return c.body(svg, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'private, max-age=3600' });
  });

  // The picture a card shows: the first view of the head version. Same access as the viewer.
  app.get('/w/:workspace/:doc/thumb.svg', async (c) => {
    const { document } = await resolveFile(ctx, c, `${c.req.param('workspace')}/${c.req.param('doc')}`, guestLimiter, { recordGuestOpen: false });
    const head = await headVersion(ctx.db, document);
    const art = head ? await thumbnailArtifact(ctx.db, head.hash) : undefined;
    if (!art) throw notFound('thumbnail');
    const bytes = await ctx.blob.get(art.blob_key);
    if (!bytes) throw notFound('thumbnail');
    // A view's entry carries its picture; renders from before entries were stored apart kept the SVG itself.
    const svg = art.kind === 'view' ? (JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(bytes)))) as { svg: string }).svg : bytes;
    return c.body(typeof svg === 'string' ? svg : new Uint8Array(svg), 200, { 'content-type': 'image/svg+xml', 'cache-control': 'private, max-age=60' });
  });

  // Public: the sign in, passcode and guest pages load these before anyone is known.
  const ASSET_CACHE = 'public, max-age=86400';
  app.get('/assets/fonts/:file', (c) => {
    const bytes = fontAsset(c.req.param('file'));
    if (!bytes) throw notFound('font');
    return c.body(new Uint8Array(bytes), 200, { 'content-type': 'font/woff2', 'cache-control': ASSET_CACHE });
  });
  app.get('/assets/brand/:file', (c) => {
    const bytes = brandAsset(c.req.param('file'));
    if (!bytes) throw notFound('brand file');
    return c.body(new Uint8Array(bytes), 200, { 'content-type': 'image/svg+xml', 'cache-control': ASSET_CACHE });
  });

  app.get('/api', async (c) => {
    const p = c.get('principal');
    if (!p) throw unauthorized();
    const workspaces = await memberWorkspaces(ctx.db, p);
    const csrf = c.get('csrf');
    return c.html(apiHtml({
      nonce: c.get('nonce'),
      ...(csrf ? { csrf } : {}),
      user: await frameUser(p),
      workspaces,
      documents: await homeDocuments(ctx.dbRead, workspaces, p.userId),
      agents,
      publicUrl: ctx.config.PUBLIC_URL,
      version: API_VERSION,
      routes: apiReference,
    }));
  });

  app.get('/account', async (c) => {
    const p = c.get('principal');
    if (!p) throw unauthorized();
    const workspaces = await memberWorkspaces(ctx.db, p);
    const csrf = c.get('csrf');
    return c.html(accountHtml({
      nonce: c.get('nonce'),
      ...(csrf ? { csrf } : {}),
      user: await frameUser(p),
      subject: p.subject,
      workspaces,
      documents: await homeDocuments(ctx.dbRead, workspaces, p.userId),
      agents,
      tokens: await listTokens(ctx.db, p.orgId, p.userId),
      connections: await listGrants(ctx.db, p.userId),
    }));
  });

  app.get('/kit', (c) => {
    if (!c.get('principal')) throw unauthorized();
    return c.html(kitHtml(c.get('nonce')));
  });

  app.get('/viewer.js', (c) => c.body(viewerScript(), 200, { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=3600' }));
  app.get('/engine.js', (c) => c.body(engineScript(), 200, { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=3600' }));
  app.get('/editor.js', (c) => c.body(editorScript(), 200, { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=3600' }));

  app.get('/w/:workspace/:doc', async (c) => {
    // A document that moved to another workspace is sent there from its old address.
    const p = c.get('principal');
    const here = p ? await workspaceBySlug(ctx.db, p.orgId, c.req.param('workspace')) : undefined;
    if (here && !(await documentBySlug(ctx.db, here.id, c.req.param('doc')))) {
      const moved = await movedTo(ctx.db, here.id, c.req.param('doc'));
      if (moved) return c.redirect(`/w/${moved.split('/').map(encodeURIComponent).join('/')}`, 301);
    }
    const file = `${c.req.param('workspace')}/${c.req.param('doc')}`;
    const { document } = await resolveFile(ctx, c, file, guestLimiter, { recordGuestOpen: false });
    return c.html(viewerHtml(file, document.name, c.get('nonce')));
  });

  const bundle = async (c: Context<HubEnv>, file: string | undefined): Promise<Response> => {
    const resolved = await resolveFile(ctx, c, file, guestLimiter, { recordGuestOpen: Boolean(file?.startsWith('g/')) });
    return bundleResponse(ctx, c, resolved, { csrf: c.get('csrf') });
  };
  const entry = async (c: Context<HubEnv>, file: string | undefined): Promise<Response> => viewEntryResponse(ctx, c, await resolveFile(ctx, c, file, entryLimiter, { recordGuestOpen: false }));
  const kit = async (c: Context<HubEnv>, file: string | undefined): Promise<Response> => viewKitResponse(ctx, c, await resolveFile(ctx, c, file, guestLimiter, { recordGuestOpen: false }));
  app.get('/api/bundle/kit', (c) => kit(c, c.req.query('file')));
  app.get('/w/:workspace/:doc/api/bundle/kit', (c) => kit(c, `${c.req.param('workspace')}/${c.req.param('doc')}`));
  app.get('/api/bundle/view', (c) => entry(c, c.req.query('file')));
  app.get('/w/:workspace/:doc/api/bundle/view', (c) => entry(c, `${c.req.param('workspace')}/${c.req.param('doc')}`));
  // Voice walkthroughs a reader of this bundle may play, guests included.
  app.get('/api/bundle/recordings', async (c) => readerRecordings(ctx, c, await resolveFile(ctx, c, c.req.query('file'), guestLimiter, { recordGuestOpen: false })));
  app.get('/api/bundle/recordings/audio', async (c) => readerAudio(ctx, c, await resolveFile(ctx, c, c.req.query('file'), entryLimiter, { recordGuestOpen: false })));
  app.get('/api/bundle', (c) => bundle(c, c.req.query('file')));
  app.get('/w/:workspace/:doc/api/bundle', (c) => bundle(c, `${c.req.param('workspace')}/${c.req.param('doc')}`));

  app.get('/embed/:workspace/:doc/:view', async (c) => {
    const resolved = await resolveFile(ctx, c, `${c.req.param('workspace')}/${c.req.param('doc')}`, guestLimiter, { recordGuestOpen: false });
    if (resolved.onlyView !== undefined && resolved.onlyView !== c.req.param('view')) throw notFound('view');
    const stored = await headBundle(ctx, resolved, { onlyView: c.req.param('view') });
    if (!stored) throw notFound('view (not rendered yet?)');
    const data = JSON.parse(stored.json) as Record<string, unknown>;
    if (!(data['views'] as unknown[]).length) throw notFound('view');
    const theme = c.req.query('theme');
    const html = embedHtml({ ...data, ...(theme === 'dark' || theme === 'light' ? { theme } : {}) }, c.get('nonce'));
    return c.html(html, 200, { 'content-security-policy': csp(c.get('nonce'), { embed: true }) });
  });

  app.get('/g/:token', async (c) => {
    const token = c.req.param('token');
    const guest = await resolveGuestLink(ctx.db, ctx.config, token);
    if (!guest) return c.html(messageHtml('Link unavailable', 'This guest link is unknown, expired, or revoked.', c.get('nonce')), 404);
    if (guest.passcode_hash) {
      const unlocked = await open(ctx.config.SESSION_SECRET, readCookie(c.req.header('cookie'), GUEST_COOKIE) ?? '');
      if (unlocked !== guest.id) return c.html(passcodeHtml(`/g/${token}`, c.get('nonce'), false));
    }
    return c.html(viewerHtml(`g/${token}`, 'Shared diagram', c.get('nonce')));
  });

  app.post('/g/:token', async (c) => {
    const token = c.req.param('token');
    const guest = await resolveGuestLink(ctx.db, ctx.config, token);
    if (!guest) throw notFound('guest link');
    const form = await c.req.parseBody();
    const passcode = typeof form['passcode'] === 'string' ? form['passcode'] : undefined;
    if (!(await checkPasscode(guest, passcode))) {
      ctx.log.warn('guest.passcode.wrong', { guestLinkId: guest.id });
      return c.html(passcodeHtml(`/g/${token}`, c.get('nonce'), true), 403);
    }
    const cookie = cookieHeader(GUEST_COOKIE, await seal(ctx.config.SESSION_SECRET, guest.id), { maxAge: 3600, secure });
    ctx.log.info('guest.passcode.ok', { guestLinkId: guest.id });
    return new Response(null, { status: 303, headers: { location: `/g/${token}`, 'set-cookie': cookie } });
  });

  return app;
}

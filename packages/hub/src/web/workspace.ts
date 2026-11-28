/**
 * The workspace page at /w/:workspace: its diagrams, its decision records, the connectors its readers
 * see, its publications, who holds a role (authors only, as in the API),
 * and recent activity. Tabs are links (?tab=); every write goes through the
 * same API routes and checks as any client.
 */
import type { WorkspaceScope } from '../scopes/outline.ts';
import { fieldTitle } from '../scopes/profile.ts';
import { DELETE_RULES, deleteRule, isWorkspaceOwner, type AccessibleWorkspace, type DeleteRule } from '../authz.ts';
import type { AgentSetup } from '../agents.ts';
import type { HomeDocument } from './home-data.ts';
import type { Activity, Member, PendingInvite, WorkspaceFolder, WorkspacePublication, WorkspaceSource } from './workspace-data.ts';
import { escapeHtml } from './html.ts';
import { appPage, avatar, familyFor, initials } from './frame.ts';
import { frameWorkspaces, type HomeUser } from './home.ts';
import { ico } from './icons.ts';
import { blockedReason } from '../publishing/repo.ts';
import { connectorBlocked as connectorBlockedText } from '../sources/repo.ts';
import { decisionsTab, type DecisionsTabModel } from './decisions-page.ts';
import { workTab, type WorkTabModel } from './work-page.ts';
import { BOARD_SCRIPT } from './work-views.ts';
import { LIBRARY_SCRIPT, libraryItems, libraryTools, plural, spaceName, when, type Layout, type LibraryOptions, type Sort } from './library.ts';

export type WorkspaceTab = 'diagrams' | 'decisions' | 'work' | 'connectors' | 'publications' | 'members' | 'activity';

export interface WorkspaceModel {
  readonly nonce: string;
  readonly csrf?: string;
  readonly user: HomeUser & { readonly admin: boolean };
  readonly workspace: AccessibleWorkspace;
  readonly workspaces: readonly AccessibleWorkspace[];
  readonly documents: readonly HomeDocument[];
  /** An admin opened a workspace nobody shared with them: the page says so and sits under the admin console. */
  readonly visiting?: boolean;
  readonly tab: WorkspaceTab;
  readonly sort: Sort;
  readonly layout: Layout;
  readonly agents: AgentSetup;
  readonly sources?: readonly WorkspaceSource[];
  readonly publications?: readonly WorkspacePublication[];
  /** PUBLICATION_APPROVAL: publications wait for an admin before they run. */
  readonly approvalRequired?: boolean;
  /** CONNECTOR_APPROVAL: connectors wait for an admin before they send data. */
  readonly connectorApproval?: boolean;
  readonly members?: readonly Member[];
  readonly activity?: readonly Activity[];
  readonly folders?: readonly WorkspaceFolder[];
  /** The folder the diagrams tab shows, by id; absent shows every diagram. */
  readonly folder?: string;
  readonly invites?: readonly PendingInvite[];
  /** How many decision records the workspace's registries hold; the Decisions tab shows when it holds a registry. */
  readonly decisionCount?: number;
  readonly decisions?: DecisionsTabModel;
  /** How many tracked items the workspace's kinds hold; the Work tab shows when it holds a kind. */
  readonly workCount?: number;
  readonly work?: WorkTabModel;
  /** The scope the workspace belongs to, with its profile; absent when it belongs to the whole estate. */
  readonly scope?: WorkspaceScope;
  /** The program the workspace serves, with its profile; absent when it serves none. */
  readonly program?: WorkspaceScope;
  readonly now?: number;
}


function tabUrl(ws: AccessibleWorkspace, tab: WorkspaceTab): string {
  return `/w/${encodeURIComponent(ws.slug)}${tab === 'diagrams' ? '' : `?tab=${tab}`}`;
}

/** The folder chips over the list: every diagram, each folder, and (for authors) a new one. */
function folderBar(m: WorkspaceModel, all: number): string {
  const folders = m.folders ?? [];
  const author = m.workspace.role === 'author';
  if (!folders.length && !author) return '';
  const base = tabUrl(m.workspace, 'diagrams');
  const chip = (href: string, label: string, n: number, on: boolean): string => `<a class="chip" href="${href}"${on ? ' aria-pressed="true" aria-current="page"' : ''}>${label}<span class="n">${n}</span></a>`;
  const api = `/api/v1/workspaces/${encodeURIComponent(m.workspace.slug)}/folders`;
  const make = author ? `<details class="new-folder"><summary class="chip">${ico('plus', 13)}New folder</summary><form class="inline-form" data-api="${api}" data-next="folder"><input class="field" name="name" maxlength="80" placeholder="Folder name" aria-label="Folder name" required><button class="btn primary sm">Make it</button></form></details>` : '';
  const current = folders.find((f) => f.id === m.folder);
  const manage = author && current ? `<div class="folder-manage"><form class="inline-form" data-api="${api}/${encodeURIComponent(current.id)}" data-method="PATCH"><input class="field" name="name" maxlength="80" value="${escapeHtml(current.name)}" aria-label="Folder name" required><button class="btn sm">Rename</button></form><button class="btn ghost sm" type="button" data-delete="${api}/${encodeURIComponent(current.id)}" data-next="${base}">${ico('trash', 14)}Remove folder</button><span class="f-hint">Removing a folder keeps its diagrams in the workspace.</span></div>` : '';
  return `<div class="folders"><div class="folder-chips" role="group" aria-label="Folders">${chip(base, `${ico('grid', 13)}All diagrams`, all, !m.folder)}${folders.map((f) => chip(`${base}?folder=${encodeURIComponent(f.id)}`, `${ico('layers', 13)}${escapeHtml(f.name)}`, f.count, f.id === m.folder)).join('')}${make}</div>${manage}</div>`;
}

function diagrams(m: WorkspaceModel, mine: readonly HomeDocument[], now: number): string {
  const shown = m.folder ? mine.filter((d) => d.folderId === m.folder) : mine;
  const folder = m.folders?.find((f) => f.id === m.folder);
  const lib: LibraryOptions = {
    documents: shown,
    workspaces: new Map([[m.workspace.id, m.workspace]]),
    userId: m.user.id,
    admin: m.user.admin,
    sort: m.sort,
    layout: m.layout,
    href: (change) => {
      const p = new URLSearchParams();
      const sort = change.sort ?? m.sort;
      const layout = change.layout ?? m.layout;
      if (m.folder) p.set('folder', m.folder);
      if (sort !== 'recent') p.set('sort', sort);
      if (layout !== 'grid') p.set('layout', layout);
      const q = p.toString();
      return `${tabUrl(m.workspace, 'diagrams')}${q ? `?${q}` : ''}`;
    },
    empty: folder ? '<b>This folder is empty.</b> Move a diagram here from the menu on its card.' : m.workspace.role === 'author' ? '<b>No diagrams here yet.</b> Start one with New diagram, import a drawing, or let an agent save one.' : '<b>No diagrams here yet.</b> They appear when an author saves one.',
    now,
    ...(m.workspace.role === 'author' ? { folders: m.folders ?? [] } : {}),
  };
  return `${folderBar(m, mine.length)}<section class="lib" aria-labelledby="t-head"><div class="lib-head"><h2 id="t-head">${folder ? escapeHtml(folder.name) : plural(mine.length, 'diagram')}</h2>${libraryTools(lib)}</div>${libraryItems(lib)}</section>`;
}

function stat(label: string, value: string): string {
  return `<div class="stat"><span class="caps">${label}</span><b>${value}</b></div>`;
}

function connectors(m: WorkspaceModel, now: number): string {
  const list = m.sources ?? [];
  const intro = `<div class="tab-intro"><h2 id="t-head">Connectors</h2><p>Connectors keep this workspace's diagrams honest. Each one signs in as its own app, reads only what that app may read, and sends what really exists here. Only this workspace sees it. One with an interval runs in the hub's shared pool, and an author can run it now.${m.connectorApproval ? ' On this hub a new connector sends data once an admin approves it.' : ''}</p></div>`;
  if (!list.length) return `<section aria-labelledby="t-head">${intro}<p class="none-here"><b>No connectors in this workspace yet.</b> An author adds one through the API or by asking an agent: Azure Resource Graph, Kubernetes, Orrery, Cloudflare, any HTTP API, or a push endpoint for your own scripts.</p></section>`;
  const cards = list.map(({ source: s, bound, pending, next, runRefused }) => {
    const last = s.last_run;
    const blocked = connectorBlockedText(s, m.connectorApproval ?? false);
    const pill = s.approval === 'stopped' ? '<span class="pill bad">Stopped by an admin</span>' : blocked && s.enabled ? '<span class="pill warn">Waiting for an admin</span>' : !s.enabled ? '<span class="pill">Paused</span>' : pending === 'running' ? '<span class="pill info">Running</span>' : pending === 'queued' ? '<span class="pill info">Queued</span>' : !last ? '<span class="pill">Never run</span>' : last.status === 'failed' ? '<span class="pill bad">Failed</span>' : '<span class="pill ok">Fresh</span>';
    const lastAt = last ? when(new Date(last.at), now) : 'Never';
    const runs = s.every_minutes === null ? 'runs on a runner of its own' : `runs every ${plural(s.every_minutes, 'minute')} in the shared pool${next ? `, next in ${plural(Math.max(1, Math.round((next.getTime() - now) / 60_000)), 'minute')}` : ''}`;
    const run = m.workspace.role === 'author' && !runRefused ? `<button class="btn sm" type="button" data-run="/api/v1/workspaces/${encodeURIComponent(m.workspace.slug)}/connectors/${encodeURIComponent(s.id)}/run">Run now</button>` : '';
    return `<article class="src-card"><div class="src-top"><span class="src-badge fam-${familyFor(s.connector)}" aria-hidden="true">${escapeHtml(initials(s.connector).slice(0, 3))}</span><div class="src-name"><b>${escapeHtml(s.name)}</b><span>${escapeHtml(s.connector)} / ${escapeHtml(s.slug)}</span></div>${pill}</div>
<div class="stats">${stat('Boxes', String(last?.counts.entities ?? 0))}${stat('Arrows', String(last?.counts.relations ?? 0))}${stat('Diagrams', String(bound))}${stat('Last run', escapeHtml(lastAt))}</div>
<p class="src-runs">Signs in as the app <code>${escapeHtml(s.client_id)}</code> and ${runs}.</p>${run ? `<div class="src-acts">${run}</div>` : ''}${last?.status === 'failed' && last.error ? `<div class="banner bad">${ico('error')}<span>${escapeHtml(last.error)}</span></div>` : ''}</article>`;
  });
  return `<section aria-labelledby="t-head">${intro}<div class="src-grid">${cards.join('')}</div></section>`;
}

function triggerText(t: WorkspacePublication['publication']['trigger']): string {
  if (t.kind === 'on-save') return 'On every new version';
  if (t.kind === 'schedule') return `On a schedule: ${t.cron}`;
  return 'When asked';
}

function publications(m: WorkspaceModel, now: number): string {
  const list = m.publications ?? [];
  const intro = `<div class="tab-intro"><h2 id="t-head">Publications</h2><p>Send fresh pictures where people already read: a wiki page, a SharePoint library, a Teams channel, a folder or a repository.${m.approvalRequired ? ' On this hub a new publication runs once an admin approves it.' : ''}</p></div>`;
  if (!list.length) return `<section aria-labelledby="t-head">${intro}<p class="none-here"><b>Nothing is published from here yet.</b> An author sets one up through the API or by asking an agent.</p></section>`;
  const rows = list.map(({ publication: p, documentName }) => {
    const last = p.last_run;
    const blocked = blockedReason(p, m.approvalRequired ?? false);
    const pill = p.approval === 'stopped' ? '<span class="pill bad">Stopped by an admin</span>' : blocked ? '<span class="pill warn">Waiting for an admin</span>' : !p.enabled ? '<span class="pill">Paused</span>' : !last ? '<span class="pill">Not run yet</span>' : last.status === 'failed' ? `<span class="pill bad" title="${escapeHtml(last.error ?? '')}">Failed ${when(new Date(last.at), now)}</span>` : `<span class="pill ok">Published ${when(new Date(last.at), now)}</span>`;
    const run = m.workspace.role === 'author' && !blocked ? `<button class="btn sm" type="button" data-run="/api/v1/workspaces/${encodeURIComponent(m.workspace.slug)}/publications/${encodeURIComponent(p.id)}/run">Run</button>` : '';
    return `<div class="pub-row"><span class="src-badge fam-${familyFor(p.target)}" aria-hidden="true">${escapeHtml(initials(p.target).slice(0, 3))}</span><div class="pub-what"><b>${escapeHtml(p.name)}</b><span>${escapeHtml(documentName)} as ${escapeHtml(p.formats.join(', ').toUpperCase())} to ${escapeHtml(p.target)}</span></div><span class="pub-when">${escapeHtml(triggerText(p.trigger))}</span>${pill}${run}</div>`;
  });
  return `<section aria-labelledby="t-head">${intro}<div class="rows">${rows.join('')}</div></section>`;
}

const DELETE_RULE_TEXT: Record<DeleteRule, string> = { makers: 'The person who made it', authors: 'Anyone who can edit', owner: 'Only the owner' };

/** Who may delete diagrams here: a picker for the owner and org admins, the rule as words for everyone else. */
function deleteRuleBlock(m: WorkspaceModel): string {
  if (m.workspace.kind !== 'team') return '';
  const rule = deleteRule(m.workspace);
  const owner = isWorkspaceOwner({ userId: m.user.id, admin: m.user.admin }, m.workspace);
  const always = 'The owner and org admins always can. A delete cannot be undone.';
  const control = owner
    ? `<label class="sr-only" for="del-rule">Who can delete diagrams</label><select class="field" id="del-rule" data-setting="deleteDiagrams" data-api="/api/v1/workspaces/${encodeURIComponent(m.workspace.slug)}">${DELETE_RULES.map((r) => `<option value="${r}"${r === rule ? ' selected' : ''}>${DELETE_RULE_TEXT[r]}</option>`).join('')}</select>`
    : `<span class="pill">${DELETE_RULE_TEXT[rule]}</span>`;
  const who = owner ? '' : ' Only the owner and org admins change this.';
  return `<h3 class="sub-head">Who can delete diagrams</h3><div class="rows"><div class="mem-row"><span class="avatar" aria-hidden="true">${ico('trash', 14)}</span><div class="pub-what"><b>Deleting diagrams</b><span>${always}${who}</span></div>${control}</div></div>`;
}

function members(m: WorkspaceModel): string {
  const list = m.members ?? [];
  const slug = encodeURIComponent(m.workspace.slug);
  const intro = `<div class="tab-intro"><h2 id="t-head">Members</h2><p>Who can open this workspace and who can change it. Invite people by email; teams and the whole organization are granted through <code>POST /api/v1/workspaces/${escapeHtml(m.workspace.slug)}/grants</code>.</p></div>`;
  const invite = m.workspace.kind === 'team'
    ? `<form class="invite" data-api="/api/v1/workspaces/${slug}/invites"><label class="sr-only" for="inv-email">Email</label><input class="field" id="inv-email" name="email" type="email" placeholder="name@company.com" autocomplete="off" required><label class="sr-only" for="inv-role">Role</label><select class="field" id="inv-role" name="role"><option value="viewer">Can view</option><option value="author">Can edit</option></select><button class="btn primary">${ico('users', 15)}Invite</button></form><p class="f-hint">Someone who has signed in here before gets access at once. Anyone else gets it the first time they sign in with that address, so send them the link to this hub yourself.</p>`
    : '<p class="f-hint">This is a personal space. Make a team workspace to work on diagrams with other people.</p>';
  const rows = list.map((x) => {
    const face = x.kind === 'user' ? avatar(x.name) : `<span class="avatar fam-${familyFor(x.name)}" aria-hidden="true">${ico(x.kind === 'team' ? 'users' : 'layers', 14)}</span>`;
    const kind = x.kind === 'team' ? 'Team' : x.kind === 'org' ? 'Everyone in the organization' : '';
    const remove = x.grant && !(x.kind === 'user' && x.subject === m.user.id) ? `<button class="btn ghost sm icon" type="button" data-delete="/api/v1/workspaces/${slug}/grants/${encodeURIComponent(x.grant)}" aria-label="Remove ${escapeHtml(x.name)}" title="Remove">${ico('trash', 14)}</button>` : '';
    return `<div class="mem-row">${face}<div class="pub-what"><b>${escapeHtml(x.name)}</b><span>${escapeHtml(kind || x.detail)}</span></div><span class="pill ${x.role === 'author' ? 'info' : ''}">${x.role === 'author' ? 'Can edit' : 'Can view'}</span>${remove}</div>`;
  });
  const waiting = (m.invites ?? []).map((i) => `<div class="mem-row">${avatar(i.email)}<div class="pub-what"><b>${escapeHtml(i.email)}</b><span>Invited, not signed in yet</span></div><span class="pill">${i.role === 'author' ? 'Can edit' : 'Can view'}</span><button class="btn ghost sm" type="button" data-delete="/api/v1/workspaces/${slug}/invites/${encodeURIComponent(i.id)}">Withdraw</button></div>`);
  return `<section aria-labelledby="t-head">${intro}${invite}${rows.length ? `<div class="rows">${rows.join('')}</div>` : '<p class="none-here">Only you, for now.</p>'}${waiting.length ? `<h3 class="sub-head">Waiting to sign in</h3><div class="rows">${waiting.join('')}</div>` : ''}${deleteRuleBlock(m)}</section>`;
}

const SAID: Record<string, [string, string]> = {
  'document.save': ['saved a new version of', 'accent'],
  'document.delete': ['deleted', 'red'],
  'comment.create': ['commented on', 'teal'],
  'comment.update': ['edited a comment on', 'teal'],
  'comment.resolve': ['resolved a comment on', 'emerald'],
  'comment.reopen': ['reopened a comment on', 'teal'],
  'comment.delete': ['deleted a comment on', 'teal'],
  'publication.create': ['set up', 'violet'],
  'publication.update': ['changed', 'violet'],
  'publication.delete': ['removed a publication', 'violet'],
  'publication.run': ['published', 'violet'],
  'publication.run.queue': ['asked to publish', 'violet'],
  'publication.approve': ['approved', 'violet'],
  'publication.stop': ['stopped', 'violet'],
  'workspace.create': ['created the workspace', 'amber'],
  'workspace.update': ['changed the workspace settings', 'amber'],
  'workspace.export': ['exported the workspace', 'slate'],
  'workspace.import': ['imported into the workspace', 'amber'],
  'workspace.review': ['reviewed the workspace', 'slate'],
  'decision.create': ['wrote the decision', 'blue'],
  'decision.update': ['refined the decision', 'blue'],
  'decision.supersede': ['superseded the decision', 'blue'],
  'decision.import': ['imported the decision', 'blue'],
  'registry.create': ['made the decision registry', 'amber'],
  'registry.update': ['changed the decision registry', 'amber'],
  'registry.import': ['imported decision records into', 'amber'],
  'grant.set': ['changed who has access', 'pink'],
  'grant.remove': ["removed someone's access", 'pink'],
};

function activity(m: WorkspaceModel, now: number): string {
  const list = m.activity ?? [];
  const intro = '<div class="tab-intro"><h2 id="t-head">Activity</h2><p>Saves, comments, publications and access changes, newest first.</p></div>';
  if (!list.length) return `<section aria-labelledby="t-head">${intro}<p class="none-here">Nothing has happened here yet.</p></section>`;
  const items = list.map((a) => {
    const [verb, tone] = SAID[a.what] ?? [a.what.replace(/\./g, ' '), 'slate'];
    const dot = tone === 'accent' ? 'var(--accent)' : `var(--${tone}-stroke)`;
    return `<li><span class="dot" style="background:${dot}"></span><div><span><b>${escapeHtml(a.who)}</b> ${escapeHtml(verb)}${a.subject ? ` <b>${escapeHtml(a.subject)}</b>` : ''}</span><time datetime="${a.at.toISOString()}">${when(a.at, now)}</time></div></li>`;
  });
  return `<section aria-labelledby="t-head">${intro}<ol class="feed">${items.join('')}</ol></section>`;
}

/** Posts to a run route, and saves a workspace setting picked from a select, with the session's CSRF token; says what happened. */
const RUN_SCRIPT = `document.addEventListener('change',function(e){var s=e.target.closest('select[data-setting]');if(!s)return;var t=document.getElementById('toast'),m=document.querySelector('meta[name=csrf]'),h={'content-type':'application/json'},st={};if(m)h['x-csrf-token']=m.content;st[s.getAttribute('data-setting')]=s.value;s.disabled=true;
fetch(s.getAttribute('data-api'),{method:'PATCH',headers:h,credentials:'same-origin',body:JSON.stringify({settings:st})}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(x){t.querySelector('span').textContent=x.ok?'Saved.':(x.j.error||'That did not work.');t.hidden=false;setTimeout(function(){t.hidden=true},3000);if(!x.ok)location.reload()}).catch(function(){t.querySelector('span').textContent='The hub did not answer. Try again.';t.hidden=false}).finally(function(){s.disabled=false})});
document.addEventListener('click',function(e){var b=e.target.closest('[data-run]');if(!b||b.disabled)return;b.disabled=true;var t=document.getElementById('toast'),m=document.querySelector('meta[name=csrf]'),h={};if(m)h['x-csrf-token']=m.content;
fetch(b.getAttribute('data-run'),{method:'POST',headers:h,credentials:'same-origin'}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(x){t.querySelector('span').textContent=x.ok?'Queued. It runs in the background; refresh to see the result.':(x.j.error||'That did not work.');t.hidden=false;setTimeout(function(){t.hidden=true},4000)}).catch(function(){t.querySelector('span').textContent='The hub did not answer. Try again.';t.hidden=false}).finally(function(){b.disabled=false})});`;

/** How the page names each axis a scope reaches the workspace on (VAN-3017). */
const AXIS = { owner: ['Scope', 'Belongs to'], program: ['Program', 'Serves'] } as const;

/** One scope on its axis and its profile; a field the scope leaves empty shows the nearest ancestor's, marked. */
function scopeHtml(s: WorkspaceScope, axis: keyof typeof AXIS): string {
  const [label, verb] = AXIS[axis];
  const above = s.above.length ? ` in ${s.above.map((a) => escapeHtml(a.name)).join(', in ')}` : '';
  const fields = s.profile.map((f) => `<div><dt>${escapeHtml(fieldTitle(f.field))}</dt><dd>${escapeHtml(f.value)}${f.from ? `<span class="inherited">Inherited from ${escapeHtml(f.from)}</span>` : ''}</dd></div>`).join('');
  return `<section class="ws-scope" aria-label="${label}"><p>${verb} <b>${escapeHtml(s.name)}</b>, a ${escapeHtml(s.kind)}${above}</p>${fields ? `<dl class="ws-profile">${fields}</dl>` : ''}</section>`;
}

/** The owner's scope and the program's, side by side; a workspace with only an owner shows its one card as before. */
function scopesHtml(m: WorkspaceModel): string {
  const cards = [m.scope ? scopeHtml(m.scope, 'owner') : '', m.program ? scopeHtml(m.program, 'program') : ''].filter(Boolean);
  return cards.length > 1 ? `<div class="ws-scopes">${cards.join('')}</div>` : cards.join('');
}

export function workspaceHtml(m: WorkspaceModel): string {
  const now = m.now ?? Date.now();
  const ws = m.workspace;
  const mine = m.documents.filter((d) => d.workspaceId === ws.id);
  const name = spaceName(ws, m.user.id);
  const tabs: [WorkspaceTab, string, string][] = [
    ['diagrams', 'Diagrams', String(mine.length)],
    ...(m.decisionCount !== undefined ? [['decisions', 'Decisions', String(m.decisionCount)] as [WorkspaceTab, string, string]] : []),
    ...(m.workCount !== undefined ? [['work', 'Work', String(m.workCount)] as [WorkspaceTab, string, string]] : []),
    ['connectors', 'Connectors', m.sources ? String(m.sources.length) : ''],
    ['publications', 'Publications', m.publications ? String(m.publications.length) : ''],
    ...(ws.role === 'author' ? [['members', 'Members', m.members ? String(m.members.length) : ''] as [WorkspaceTab, string, string]] : []),
    ['activity', 'Activity', ''],
  ];
  const tabBar = `<nav class="tabs" aria-label="Workspace">${tabs.map(([id, label, n]) => `<a href="${tabUrl(ws, id)}"${m.tab === id ? ' aria-current="page"' : ''}>${label}${n ? `<span class="tally">${n}</span>` : ''}</a>`).join('')}</nav>`;
  const crumbs = m.visiting ? `<a href="/admin">Admin</a>${ico('right', 12)}` : `<a href="/">Home</a>${ico('right', 12)}`;
  const visit = m.visiting ? `<div class="banner"><span>You see this ${ws.kind === 'personal' ? 'personal space' : 'workspace'} as an org admin. It is not shared with you, so it stays out of your sidebar. Find it again in Admin, under Workspaces.</span></div>` : '';
  const head = `<header class="ws-head"><nav class="crumbs" aria-label="Breadcrumb">${crumbs}<span aria-current="page">${escapeHtml(name)}</span></nav>${visit}
<div class="ws-title"><span class="ws-mark fam-${familyFor(ws.slug)}" aria-hidden="true">${escapeHtml(initials(ws.name).slice(0, 1))}</span><div><h1>${escapeHtml(name)}</h1><div class="ws-meta"><span>${ws.kind === 'team' ? 'Team workspace' : 'Personal workspace'}</span><span class="pill ${ws.role === 'author' ? 'info' : ''}">${ws.role === 'author' ? 'You can edit' : 'You can view'}</span></div></div>
<div class="ws-acts"><a class="btn" href="/api/v1/workspaces/${encodeURIComponent(ws.slug)}/export" download>${ico('export')}Download all</a>${ws.role === 'author' ? `<a class="btn" href="/import/${encodeURIComponent(ws.slug)}">${ico('import')}Import</a><a class="btn primary" href="/new?in=${encodeURIComponent(ws.slug)}">${ico('plus')}New diagram</a>` : ''}</div></div>${scopesHtml(m)}${tabBar}</header>`;
  const body = m.tab === 'decisions' && m.decisions ? decisionsTab(ws, m.decisions) : m.tab === 'work' && m.work ? workTab(ws, m.work) : m.tab === 'connectors' ? connectors(m, now) : m.tab === 'publications' ? publications(m, now) : m.tab === 'members' && ws.role === 'author' ? members(m) : m.tab === 'activity' ? activity(m, now) : diagrams(m, mine, now);
  const toast = '<div class="toast toast-float" id="toast" role="status" hidden><span></span></div>';
  const { spaces, shared, starred } = frameWorkspaces(m.workspaces, m.documents, m.user.id);
  return appPage(
    { title: name, nonce: m.nonce, ...(m.csrf ? { csrf: m.csrf } : {}), user: m.user, workspaces: spaces, sharedCount: shared, starredCount: starred, place: m.visiting ? { kind: 'admin' } : { kind: 'workspace', slug: ws.slug }, agents: m.agents, body: `${head}${body}${toast}` },
    RUN_SCRIPT + LIBRARY_SCRIPT + (m.tab === 'work' ? BOARD_SCRIPT : ''),
  );
}

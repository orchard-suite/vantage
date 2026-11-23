/**
 * The admin console at /admin, for org admins only. Its front page is the
 * deployment as a map: every workspace a block sized by what it holds on
 * disk, colored by kind, with its owner on it. Under the map, every workspace
 * and every person ranked by bytes, then what comes into the hub through
 * connectors and what goes out through publications (approve or stop each),
 * then the rules the deployment set. A workspace opens its own page
 * (admin-workspace.ts), a person theirs (admin-person.ts). Every button calls
 * the admin API under the same checks as any client.
 */
import type { Config } from '../config.ts';
import { sumDisk, type AdminPerson, type AdminWorkspace, type FoundDiagram, type Footprint } from './admin-data.ts';
import type { AdminConnector, AdminPublication } from './admin-flows.ts';
import { escapeHtml } from './html.ts';
import { avatar } from './frame.ts';
import { plural, when } from './library.ts';
import { adminPage, bytes, diskBar, diskKey, treemap, type AdminFrame, type MapTile } from './admin-kit.ts';
import { flows } from './admin-flows.ts';

export type AdminPolicy = Pick<Config, 'TEAM_WORKSPACES' | 'PUBLICATION_APPROVAL' | 'CONNECTOR_APPROVAL' | 'GUEST_LINKS' | 'SIGN_IN_GROUPS' | 'AI_BASE_URL' | 'AI_MODEL'>;

export interface AdminHomeModel extends AdminFrame {
  readonly policy: AdminPolicy;
  readonly footprint: Footprint;
  readonly connectors: readonly AdminConnector[];
  readonly publications: readonly AdminPublication[];
  /** A search from the console's own box: what it found instead of the map. */
  readonly query?: string;
  readonly found?: readonly FoundDiagram[];
}

/** A workspace takes a block on the map once it holds at least this share of the deployment; smaller ones are only in the list. */
const MAP_SHARE = 0.01;

export const wsAdminHref = (slug: string): string => `/admin/w/${encodeURIComponent(slug)}`;
export const personHref = (id: string): string => `/admin/people/${encodeURIComponent(id)}`;

/** The look of a workspace on the map and in lists: its kind, or disabled. */
export function wsTone(w: Pick<AdminWorkspace, 'kind' | 'disabledAt'>): string {
  return w.disabledAt ? 'off' : w.kind;
}

export function purgeNote(w: Pick<AdminWorkspace, 'disabledAt' | 'purgeAfter'>): string {
  if (!w.disabledAt) return '';
  return `<span class="pill bad">Disabled${w.purgeAfter ? `, purges ${escapeHtml(w.purgeAfter.toISOString().slice(0, 10))}` : ''}</span>`;
}

/** The small marks a workspace carries: connectors in, publications out, and what waits. */
function marks(w: AdminWorkspace): string {
  return [w.connectors ? `<span class="pill">${w.connectors} in</span>` : '', w.publications ? `<span class="pill">${w.publications} out</span>` : '', w.waiting ? `<span class="pill warn">${w.waiting} waiting</span>` : ''].join('');
}

function workspaceTile(w: AdminWorkspace): MapTile {
  const owner = w.kind === 'personal' ? `Personal, ${w.owner ?? 'nobody'}` : (w.owner ?? 'No owner');
  return {
    href: wsAdminHref(w.slug),
    bytes: w.bytes,
    tone: wsTone(w),
    name: w.name,
    lines: [`<span class="a-num">${bytes(w.bytes)}</span> · ${plural(w.diagrams, 'diagram')}`, escapeHtml(owner)],
    tags: marks(w) + purgeNote(w),
    title: `${w.name}: ${bytes(w.bytes)}, ${plural(w.diagrams, 'diagram')}, ${owner}`,
  };
}

function deploymentMap(list: readonly AdminWorkspace[], all: number): string {
  const shown = list.filter((w) => all > 0 && w.bytes / all >= MAP_SHARE);
  const rest = list.length - shown.length;
  const empty = list.filter((w) => !w.bytes).length;
  const legend = `<p class="map-key"><span><i class="tone-team"></i>Team</span><span><i class="tone-personal"></i>Personal</span><span><i class="tone-off"></i>Disabled</span>${rest ? `<span>Only in the list below: ${[rest - empty ? `${plural(rest - empty, 'workspace')} under 1%` : '', empty ? `${plural(empty, 'empty workspace')}` : ''].filter(Boolean).join(' and ')}.</span>` : ''}</p>`;
  if (!shown.length) return `<p class="none-here"><b>Nothing on disk yet.</b> The map fills as people save diagrams.</p>`;
  return `${treemap(shown.map(workspaceTile), 'Workspaces sized by what they hold on disk')}${legend}`;
}

/** Workspaces ranked by bytes, each a link to its page. */
export function workspaceList(list: readonly AdminWorkspace[], now: number, opts: { readonly owner?: boolean } = {}): string {
  if (!list.length) return '<p class="none-line">None.</p>';
  const top = Math.max(...list.map((w) => w.bytes), 1);
  const head = `<div class="a-head ws-cols" aria-hidden="true"><span>Workspace</span><span>Disk</span><span>Diagrams</span><span>Views</span><span>People</span><span>Changed</span></div>`;
  const rows = list.map((w) => {
    const who = opts.owner === false ? '' : w.kind === 'personal' ? `Personal space of ${escapeHtml(w.owner ?? 'someone no longer here')}` : `Team, owned by ${escapeHtml(w.owner ?? 'nobody')}`;
    const sub = [who || (w.kind === 'personal' ? 'Personal' : 'Team'), w.grants ? plural(w.grants, 'grant') : 'not shared'].join(' · ');
    return `<li><a class="a-row ws-cols" href="${wsAdminHref(w.slug)}"><span class="l-name"><b><i class="a-dot tone-${wsTone(w)}" aria-hidden="true"></i>${escapeHtml(w.name)}</b><span class="l-sub">${sub}</span><span class="l-marks">${marks(w)}${purgeNote(w)}</span></span><span class="l-disk">${diskBar(w.disk, top)}<span class="a-num">${bytes(w.bytes)}</span></span><span class="a-num" data-k="diagrams">${w.diagrams}</span><span class="a-num" data-k="views">${w.views}</span><span class="a-num" data-k="people">${w.reach}</span><span class="l-when" data-k="changed">${w.changedAt ? when(w.changedAt, now) : 'Never'}</span></a></li>`;
  });
  return `<div class="a-table">${head}<ul class="a-rows">${rows.join('')}</ul></div>`;
}

function personPills(p: AdminPerson, granted: boolean): string {
  return [p.admin ? '<span class="pill info">Admin</span>' : '', granted && p.workspaceCreator && !p.admin ? '<span class="pill">Makes team workspaces</span>' : '', p.disabled ? '<span class="pill bad">Disabled</span>' : ''].join('');
}

/** People ranked by what they own on disk. */
export function peopleList(list: readonly AdminPerson[], granted: boolean): string {
  if (!list.length) return '<p class="none-line">Nobody has signed in yet.</p>';
  const top = Math.max(...list.map((p) => p.bytes), 1);
  const head = `<div class="a-head p-cols" aria-hidden="true"><span>Person</span><span>Owns on disk</span><span>Owns</span><span>Diagrams</span><span>Made</span><span>Also opens</span></div>`;
  const rows = [...list].sort((a, b) => Number(a.disabled) - Number(b.disabled) || b.bytes - a.bytes || a.name.localeCompare(b.name)).map(
    (p) =>
      `<li><a class="a-row p-cols" href="${personHref(p.id)}"><span class="l-name l-person">${avatar(p.name)}<span><b>${escapeHtml(p.name)}</b><span class="l-sub">${escapeHtml(p.email ?? '')}</span><span class="l-marks">${personPills(p, granted)}</span></span></span><span class="l-disk">${diskBar(p.disk, top)}<span class="a-num">${bytes(p.bytes)}</span></span><span class="a-num" data-k="owns">${p.owns}</span><span class="a-num" data-k="diagrams">${p.diagrams}</span><span class="a-num" data-k="made">${p.made}</span><span class="a-num" data-k="also opens">${p.memberOf}</span></a></li>`,
  );
  return `<div class="a-table">${head}<ul class="a-rows">${rows.join('')}</ul></div>`;
}

function rules(p: AdminPolicy): string {
  const rule = (label: string, value: string): string => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  return `<section class="adm-sec" aria-labelledby="s-rules"><h2 class="sec" id="s-rules">How this hub is set</h2><p class="sec-note">The deployment sets these in its settings, not here.</p><dl class="rules">${rule('Team workspaces', p.TEAM_WORKSPACES === 'everyone' ? 'Anyone signed in may make one' : 'Admins and the people you let')}${rule('Publications', p.PUBLICATION_APPROVAL ? 'Run once an admin approves' : 'Run without approval')}${rule('Connectors', p.CONNECTOR_APPROVAL ? 'Send once an admin approves' : 'Send without approval')}${rule('Guest links', p.GUEST_LINKS ? 'Allowed' : 'Off on this hub')}${rule('AI revisions from comments', p.AI_BASE_URL ? `On, with ${escapeHtml(p.AI_MODEL ?? 'the default model')}` : 'Off on this hub')}${rule('Who signs in', p.SIGN_IN_GROUPS.length ? escapeHtml(p.SIGN_IN_GROUPS.join(', ')) : 'Anyone the identity provider signs in')}</dl></section>`;
}

/** What needs an admin now: approvals, purges on the way, runs that failed. */
function attention(m: AdminHomeModel): string {
  const waitIn = m.policy.CONNECTOR_APPROVAL ? m.connectors.filter((c) => c.row.approval === 'pending' && !c.workspaceOff).length : 0;
  const waitOut = m.policy.PUBLICATION_APPROVAL ? m.publications.filter((p) => p.row.approval === 'pending' && !p.workspaceOff).length : 0;
  const purging = m.footprint.workspaces.filter((w) => w.disabledAt).length;
  const failed = m.connectors.filter((c) => c.row.last_run?.status === 'failed').length + m.publications.filter((p) => p.row.last_run?.status === 'failed').length;
  const items = [
    waitIn ? `<a class="pill warn" href="#f-in">${plural(waitIn, 'connector')} ${waitIn === 1 ? 'waits' : 'wait'} for approval</a>` : '',
    waitOut ? `<a class="pill warn" href="#f-out">${plural(waitOut, 'publication')} ${waitOut === 1 ? 'waits' : 'wait'} for approval</a>` : '',
    failed ? `<a class="pill bad" href="#f-in">${plural(failed, 'run')} failed last time</a>` : '',
    purging ? `<a class="pill bad" href="#s-ws">${plural(purging, 'workspace')} disabled, ${purging === 1 ? 'purges' : 'purge'} soon</a>` : '',
  ].filter(Boolean);
  return items.length ? `<p class="attn" aria-label="Needs you">${items.join('')}</p>` : '';
}

function searchBox(q: string): string {
  return `<form class="adm-find" method="get" action="/admin" role="search"><label class="sr-only" for="adm-q">Find a workspace, person, or diagram</label><input class="field" id="adm-q" name="q" type="search" placeholder="Find anything" value="${escapeHtml(q)}" autocomplete="off"><button class="btn sm">Find</button></form>`;
}

function results(m: AdminHomeModel, q: string, now: number): string {
  const needle = q.toLowerCase();
  const fp = m.footprint;
  const ws = fp.workspaces.filter((w) => w.name.toLowerCase().includes(needle) || w.slug.includes(needle));
  const people = fp.people.filter((p) => p.name.toLowerCase().includes(needle) || (p.email ?? '').toLowerCase().includes(needle));
  const found = m.found ?? [];
  const diagrams = found.length
    ? `<ul class="found">${found.map((d) => `<li><a class="link" href="/w/${encodeURIComponent(d.workspaceSlug)}/${encodeURIComponent(d.slug)}"><b>${escapeHtml(d.name)}</b></a><span>in <a class="link" href="${wsAdminHref(d.workspaceSlug)}">${escapeHtml(d.workspaceName)}</a>${d.maker ? `, made by ${escapeHtml(d.maker)}` : ''}, changed ${when(d.updatedAt, now).toLowerCase()}</span></li>`).join('')}</ul>`
    : '<p class="none-line">No diagram names hold those words.</p>';
  return `<header class="adm-head"><div><h1>Found for “${escapeHtml(q)}”</h1><p class="adm-sum"><a class="link" href="/admin">Back to the whole deployment</a></p></div>${searchBox(q)}</header>
<section class="adm-sec"><h2 class="sec">Workspaces <span class="tally">${ws.length}</span></h2>${workspaceList(ws, now)}</section>
<section class="adm-sec"><h2 class="sec">People <span class="tally">${people.length}</span></h2>${peopleList(people, m.policy.TEAM_WORKSPACES === 'granted')}</section>
<section class="adm-sec"><h2 class="sec">Diagrams <span class="tally">${found.length}</span></h2>${diagrams}</section>`;
}

export function adminHomeHtml(m: AdminHomeModel): string {
  const now = m.now ?? Date.now();
  if (m.query) return adminPage(m, 'Admin', [[`Find “${m.query}”`, '']], results(m, m.query, now));
  const fp = m.footprint;
  const all = fp.workspaces.reduce((s, w) => s + w.bytes, 0);
  const disk = sumDisk(fp.workspaces.map((w) => w.disk));
  const diagrams = fp.workspaces.reduce((s, w) => s + w.diagrams, 0);
  const active = fp.people.filter((p) => !p.disabled).length;
  const head = `<header class="adm-head"><div><h1>Your deployment</h1><p class="adm-sum"><b class="a-num">${bytes(all)}</b> on disk across ${plural(fp.workspaces.length, 'workspace')}, ${plural(diagrams, 'diagram')}, and ${plural(active, 'person', 'people')}.</p></div><div class="adm-tools">${searchBox('')}<a class="btn sm" href="/admin/revisions">AI spend</a></div></header>`;
  const bar = `<div class="adm-disk">${diskBar(disk, all, `${bytes(all)} on disk by kind`)}${diskKey(disk)}</div>`;
  const granted = m.policy.TEAM_WORKSPACES === 'granted';
  const body = `${head}${bar}${attention(m)}
<section class="adm-sec" aria-label="Map of the deployment">${deploymentMap(fp.workspaces, all)}</section>
<section class="adm-sec" aria-labelledby="s-ws"><h2 class="sec" id="s-ws">Workspaces <span class="tally">${fp.workspaces.length}</span></h2><p class="sec-note">Biggest first. People counts everyone who can open it. Your sidebar holds only what you own or were shared; every workspace is here.</p>${workspaceList(fp.workspaces, now)}</section>
<section class="adm-sec" aria-labelledby="s-people"><h2 class="sec" id="s-people">People <span class="tally">${fp.people.length}</span></h2><p class="sec-note">Everyone who has signed in. Owns counts their workspaces, Diagrams what those hold, Made what they made anywhere. Also opens counts other people's workspaces a grant lets them into. ${granted ? 'Only admins and the people you let make team workspaces.' : 'Anyone signed in may make team workspaces.'}</p>${peopleList(fp.people, granted)}</section>
${flows(m.connectors, m.publications, m.policy, now, true, { in: 'No connectors yet. They show up when an author adds one to a workspace.', out: 'No publications yet. They show up when an author sets one up.' })}
${rules(m.policy)}`;
  return adminPage(m, 'Admin', [], body);
}

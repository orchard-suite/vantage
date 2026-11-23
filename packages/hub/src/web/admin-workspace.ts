/**
 * One workspace in the admin console, at /admin/w/:slug: what it holds and
 * where the bytes go, its diagrams as a map sized by bytes, who can do what
 * in it, every diagram with its numbers (move or delete each), what comes in
 * through its connectors and goes out through its publications, its
 * settings, and its latest versions.
 */
import type { AdminDiagram, AdminGrant, AdminWorkspaceDetail } from './admin-data.ts';
import type { AdminConnector, AdminPublication, FlowPolicy } from './admin-flows.ts';
import type { DeleteRule } from '../authz.ts';
import { escapeHtml } from './html.ts';
import { avatar } from './frame.ts';
import { plural, when } from './library.ts';
import { act, adminPage, bytes, diskBar, diskKey, treemap, type AdminFrame } from './admin-kit.ts';
import { flows } from './admin-flows.ts';
import { personHref, purgeNote, wsTone } from './admin.ts';

export interface AdminWorkspaceModel extends AdminFrame {
  readonly policy: FlowPolicy & { readonly GUEST_LINKS: boolean };
  readonly detail: AdminWorkspaceDetail;
  /** Every byte in the deployment, for this workspace's share. */
  readonly deploymentBytes: number;
  readonly connectors: readonly AdminConnector[];
  readonly publications: readonly AdminPublication[];
  /** Workspaces a diagram may move to. */
  readonly targets: readonly { readonly slug: string; readonly name: string }[];
}

type Can = 'yes' | 'no' | 'own';
const CAPS = ['Open and comment', 'Edit diagrams', 'Share and make guest links', 'Connectors and publications', 'Delete diagrams', 'Set who deletes'] as const;

function abilities(role: 'owner' | 'author' | 'viewer', rule: DeleteRule): Can[] {
  if (role === 'owner') return ['yes', 'yes', 'yes', 'yes', 'yes', 'yes'];
  if (role === 'viewer') return ['yes', 'no', 'no', 'no', 'no', 'no'];
  return ['yes', 'yes', 'yes', 'yes', rule === 'authors' ? 'yes' : rule === 'makers' ? 'own' : 'no', 'no'];
}

const MARK: Record<Can, string> = { yes: '<span class="can yes">Yes</span>', no: '<span class="can no">No</span>', own: '<span class="can own">Their own</span>' };

function accessGrid(d: AdminWorkspaceDetail, ownerName: string | null, ownerId: string | null): string {
  const row = (who: string, sub: string, role: 'owner' | 'author' | 'viewer', href = ''): string =>
    `<tr><th scope="row"><span class="a-who">${avatar(who)}<span>${href ? `<a class="link" href="${escapeHtml(href)}">${escapeHtml(who)}</a>` : escapeHtml(who)}<span class="l-sub">${sub}</span></span></span></th>${abilities(role, d.deleteRule).map((c, i) => `<td data-k="${CAPS[i]}">${MARK[c]}</td>`).join('')}</tr>`;
  const grantRow = (g: AdminGrant): string => row(g.name, `${g.role === 'author' ? 'Author' : 'Viewer'} · ${g.kind === 'user' ? 'a person' : g.kind === 'team' ? `team, ${plural(g.people, 'person', 'people')}` : `everyone, ${plural(g.people, 'person', 'people')}`}`, g.role, g.kind === 'user' ? personHref(g.subjectId) : '');
  const owner = ownerName ? row(ownerName, 'Owner', 'owner', ownerId ? personHref(ownerId) : '') : '';
  const grants = d.grants.filter((g) => !(g.kind === 'user' && g.subjectId === ownerId));
  const rule = d.deleteRule === 'authors' ? 'Every author may delete any diagram.' : d.deleteRule === 'makers' ? 'An author may delete the diagrams they made.' : 'Only the owner deletes diagrams.';
  return `<div class="grid-wrap"><table class="access"><thead><tr><th scope="col">Who</th>${CAPS.map((c) => `<th scope="col">${c}</th>`).join('')}</tr></thead><tbody>${owner}${grants.map(grantRow).join('')}</tbody></table></div><p class="sec-note">${rule} Org admins may do everything in every workspace. Change grants on the workspace's <a class="link" href="/w/${encodeURIComponent(d.workspace.slug)}?tab=members">Members</a> page.</p>`;
}

function reach(d: AdminDiagram, people: number): string {
  return `${plural(people, 'person', 'people')}${d.guestLinks ? ` + ${plural(d.guestLinks, 'guest link')}` : ''}`;
}

function diagramTable(m: AdminWorkspaceModel, now: number): string {
  const { detail: dt } = m;
  if (!dt.diagrams.length) return '<p class="none-line">No diagrams yet.</p>';
  const top = Math.max(...dt.diagrams.map((d) => d.bytes), 1);
  const ws = dt.workspace;
  const head = `<div class="a-head d-cols" aria-hidden="true"><span>Diagram</span><span>Disk</span><span>Views</span><span>Score</span><span>Versions</span><span>Comments</span><span>Reaches</span><span>Changed</span><span></span></div>`;
  const rows = dt.diagrams.map((d) => {
    const doc = `/api/v1/documents/${encodeURIComponent(d.id)}`;
    const choices = m.targets.filter((t) => t.slug !== ws.slug).map((t) => `<option value="${escapeHtml(t.slug)}">${escapeHtml(t.name)}</option>`).join('');
    const manage = `<details class="row-menu"><summary class="btn sm">Manage</summary><div class="row-pop"><form class="admin-move" data-act="POST" data-url="${escapeHtml(`${doc}/move`)}"><label for="mv-${escapeHtml(d.id)}">Move to</label><select class="field" id="mv-${escapeHtml(d.id)}" name="workspace" required><option value="">Pick a workspace</option>${choices}</select><button class="btn sm">Move</button></form>${act('Delete', 'DELETE', doc, undefined, 'ghost', `Delete ${d.name} from ${ws.name}? Its versions, comments, guest links, and publications go with it.`)}</div></details>`;
    const extras = [d.recordings ? plural(d.recordings, 'voice walkthrough') : '', d.publications ? plural(d.publications, 'publication') : '', d.stars ? plural(d.stars, 'star') : ''].filter(Boolean).join(' · ');
    return `<li class="drow d-cols"><span class="l-name"><b><a class="link" href="/w/${encodeURIComponent(ws.slug)}/${encodeURIComponent(d.slug)}">${escapeHtml(d.name)}</a></b><span class="l-sub">${d.maker ? `Made by ${escapeHtml(d.maker)}` : 'Maker unknown'}${extras ? ` · ${extras}` : ''}</span></span><span class="l-disk">${diskBar(d.disk, top)}<span class="a-num">${bytes(d.bytes)}</span></span><span class="a-num" data-k="views">${d.views}</span><span class="a-num" data-k="score">${d.score ?? '–'}</span><span class="a-num" data-k="versions">${d.versions}</span><span class="a-num" data-k="comments">${d.openComments ? `${d.comments}, ${d.openComments === d.comments ? 'all' : d.openComments} open` : d.comments}</span><span data-k="reaches">${reach(d, ws.reach)}</span><span class="l-when" data-k="changed">${when(d.updatedAt, now)}</span>${manage}</li>`;
  });
  return `<div class="a-table">${head}<ul class="a-rows">${rows.join('')}</ul></div>`;
}

function settingsList(m: AdminWorkspaceModel): string {
  const s = m.detail.workspace.settings;
  const keep = typeof s['retentionVersions'] === 'number' ? `Keeps the last ${s['retentionVersions']} versions of each diagram` : 'Keeps versions as the hub does by default';
  const links = !m.policy.GUEST_LINKS ? 'Off on this hub' : s['guestLinks'] === false ? 'Off in this workspace' : 'Allowed';
  const rule = { authors: 'Every author', makers: 'The person who made it', owner: 'Only the owner' }[m.detail.deleteRule];
  return `<dl class="rules"><div><dt>Who deletes a diagram</dt><dd>${rule}, and the owner</dd></div><div><dt>Guest links</dt><dd>${links}</dd></div><div><dt>History</dt><dd>${keep}</dd></div></dl>`;
}

function recent(m: AdminWorkspaceModel, now: number): string {
  const r = m.detail.recent;
  if (!r.length) return '<p class="none-line">No versions yet.</p>';
  const ws = encodeURIComponent(m.detail.workspace.slug);
  return `<ol class="recent">${r.map((v) => `<li><span class="l-when">${when(v.at, now)}</span><span><a class="link" href="/w/${ws}/${encodeURIComponent(v.documentSlug)}">${escapeHtml(v.document)}</a>${v.message ? `: ${escapeHtml(v.message)}` : ''}</span><span class="l-sub">${escapeHtml(v.author ?? 'someone no longer here')}, ${escapeHtml(v.surface)}</span></li>`).join('')}</ol>`;
}

export function adminWorkspaceHtml(m: AdminWorkspaceModel): string {
  const now = m.now ?? Date.now();
  const { workspace: w } = m.detail;
  const api = `/api/v1/admin/workspaces/${encodeURIComponent(w.slug)}`;
  const share = m.deploymentBytes ? Math.round((w.bytes / m.deploymentBytes) * 100) : 0;
  const owner = w.kind === 'personal' ? `Personal space of ${w.owner ?? 'someone no longer here'}` : w.owner ? `Team workspace, owned by ${w.owner}` : 'Team workspace with no owner';
  const tools = [
    w.disabledAt ? '' : `<a class="btn sm" href="/w/${encodeURIComponent(w.slug)}">Open</a><a class="btn sm" href="/w/${encodeURIComponent(w.slug)}?tab=members">Members</a>`,
    w.disabledAt ? act('Enable', 'POST', `${api}/enable`, undefined, 'primary') : act('Disable', 'POST', `${api}/disable`, undefined, 'ghost', `Disable ${w.name}? Nobody can open it, and it is purged after the grace period unless you enable it again.`),
  ].join('');
  const head = `<header class="adm-head"><div><h1><i class="a-dot tone-${wsTone(w)}" aria-hidden="true"></i>${escapeHtml(w.name)} ${purgeNote(w)}</h1><p class="adm-meta">${escapeHtml(owner)} · made ${w.createdAt.toISOString().slice(0, 10)} · ${w.changedAt ? `changed ${when(w.changedAt, now).toLowerCase()}` : 'nothing saved yet'}</p></div><div class="adm-tools">${tools}</div></header>`;
  const sum = `<p class="adm-sum">Holds <b class="a-num">${bytes(w.bytes)}</b>${share ? `, ${share}% of the deployment,` : ''} in ${plural(w.diagrams, 'diagram')} with ${plural(w.views, 'view')} and ${plural(w.versions, 'version')}. ${plural(w.reach, 'person', 'people')} can open it through ${plural(w.grants, 'grant')}.</p>`;
  const disk = `<div class="adm-disk">${diskBar(w.disk, w.bytes, `${bytes(w.bytes)} on disk by kind`)}${diskKey(w.disk)}</div>`;
  const ws = encodeURIComponent(w.slug);
  const tiles = m.detail.diagrams.map((d) => ({ href: `/w/${ws}/${encodeURIComponent(d.slug)}`, bytes: d.bytes, tone: 'doc', name: d.name, lines: [`<span class="a-num">${bytes(d.bytes)}</span> · ${plural(d.views, 'view')}`, plural(d.versions, 'version')], title: `${d.name}: ${bytes(d.bytes)}, ${plural(d.views, 'view')}, ${plural(d.versions, 'version')}` }));
  const map = tiles.length > 1 ? `<section class="adm-sec" aria-label="Diagrams sized by what they hold">${treemap(tiles, 'Diagrams sized by what they hold on disk', 16, 6)}</section>` : '';
  const body = `${head}${sum}${disk}${map}
<section class="adm-sec" aria-labelledby="s-access"><h2 class="sec" id="s-access">Who can do what</h2>${accessGrid(m.detail, w.owner, w.ownerId)}</section>
<section class="adm-sec" aria-labelledby="s-diagrams"><h2 class="sec" id="s-diagrams">Diagrams <span class="tally">${m.detail.diagrams.length}</span></h2><p class="sec-note">Biggest first. Disk counts every version kept and every picture drawn from them. Reaches is everyone who can open the workspace, plus live guest links.</p>${diagramTable(m, now)}</section>
${flows(m.connectors, m.publications, m.policy, now, false, { in: 'No connectors bring data into this workspace.', out: 'Nothing in this workspace is published out of the hub.' })}
<section class="adm-sec" aria-labelledby="s-set"><h2 class="sec" id="s-set">Settings</h2>${settingsList(m)}</section>
<section class="adm-sec" aria-labelledby="s-recent"><h2 class="sec" id="s-recent">Latest versions</h2>${recent(m, now)}</section>`;
  return adminPage(m, `${w.name} · Admin`, [[w.name, '']], body);
}

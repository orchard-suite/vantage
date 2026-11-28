/**
 * One person in the admin console, at /admin/people/:id: what they own and
 * what it holds, every other workspace they can open with the role and the
 * grant that lets them in, and their rights on the hub (admin, team
 * workspaces, disabled), which an admin changes here.
 */
import type { AdminMembership, AdminPerson, AdminWorkspace } from './admin-data.ts';
import { escapeHtml } from './html.ts';
import { avatar } from './frame.ts';
import { plural } from './library.ts';
import { act, adminPage, bytes, diskBar, diskKey, type AdminFrame } from './admin-kit.ts';
import { workspaceList, wsAdminHref, wsTone } from './admin.ts';
import { dayOf } from '../day.ts';

export interface AdminPersonModel extends AdminFrame {
  readonly granted: boolean;
  readonly person: AdminPerson;
  readonly owned: readonly AdminWorkspace[];
  readonly memberships: readonly AdminMembership[];
}

function memberList(list: readonly AdminMembership[]): string {
  if (!list.length) return '<p class="none-line">No workspace beyond their own.</p>';
  return `<ul class="a-rows a-table">${list
    .map(
      (m) =>
        `<li><a class="a-row m-cols" href="${wsAdminHref(m.workspace.slug)}"><span class="l-name"><b><i class="a-dot tone-${wsTone(m.workspace)}" aria-hidden="true"></i>${escapeHtml(m.workspace.name)}</b><span class="l-sub">${m.workspace.kind === 'personal' ? `Personal space of ${escapeHtml(m.workspace.owner ?? 'someone no longer here')}` : `Owned by ${escapeHtml(m.workspace.owner ?? 'nobody')}`}</span></span><span><span class="pill${m.role === 'author' ? ' info' : ''}">${m.role === 'author' ? 'Author' : 'Viewer'}</span></span><span class="l-sub">through ${escapeHtml(m.via)}</span><span class="a-num">${plural(m.workspace.diagrams, 'diagram')}</span></a></li>`,
    )
    .join('')}</ul>`;
}

export function adminPersonHtml(m: AdminPersonModel): string {
  const now = m.now ?? Date.now();
  const p = m.person;
  const self = p.id === m.user.id;
  const url = `/api/v1/admin/users/${encodeURIComponent(p.id)}`;
  const tools = self
    ? '<span class="pill">You</span>'
    : [
        m.granted && !p.admin ? act(p.workspaceCreator ? 'Stop team workspaces' : 'Let make team workspaces', 'PATCH', url, { workspaceCreator: !p.workspaceCreator }) : '',
        act(p.admin ? 'Remove admin' : 'Make admin', 'PATCH', url, { admin: !p.admin }, '', p.admin ? '' : `Make ${p.name} an org admin? They can open and change every workspace.`),
        act(p.disabled ? 'Enable' : 'Disable', 'PATCH', url, { disabled: !p.disabled }, p.disabled ? 'primary' : 'ghost', p.disabled ? '' : `Disable ${p.name}? Their tokens and guest links stop working, and their personal space passes to you.`),
      ].join('');
  const pills = [p.admin ? '<span class="pill info">Org admin</span>' : '', m.granted && p.workspaceCreator && !p.admin ? '<span class="pill">Makes team workspaces</span>' : '', p.disabled ? '<span class="pill bad">Disabled</span>' : ''].join('');
  const head = `<header class="adm-head"><div class="adm-person">${avatar(p.name, 'big')}<div><h1>${escapeHtml(p.name)} ${pills}</h1><p class="adm-meta">${escapeHtml(p.email ?? 'No email')} · first signed in ${dayOf(p.createdAt)}</p></div></div><div class="adm-tools">${tools}</div></header>`;
  const sum = `<p class="adm-sum">Owns ${plural(p.owns, 'workspace')} holding <b class="a-num">${bytes(p.bytes)}</b> and ${plural(p.diagrams, 'diagram')}. Made ${plural(p.made, 'diagram')} anywhere. Can open ${plural(p.memberOf, 'other workspace')}.</p>`;
  const disk = p.bytes ? `<div class="adm-disk">${diskBar(p.disk, p.bytes, `${bytes(p.bytes)} on disk by kind`)}${diskKey(p.disk)}</div>` : '';
  const body = `${head}${sum}${disk}
<section class="adm-sec" aria-labelledby="s-owns"><h2 class="sec" id="s-owns">Owns <span class="tally">${m.owned.length}</span></h2>${workspaceList(m.owned, now, { owner: false })}</section>
<section class="adm-sec" aria-labelledby="s-member"><h2 class="sec" id="s-member">Can also open <span class="tally">${m.memberships.length}</span></h2><p class="sec-note">Workspaces they do not own, with the best role a grant gives them and the grant it comes from.</p>${memberList(m.memberships)}</section>`;
  return adminPage(m, `${p.name} · Admin`, [[p.name, '']], body);
}

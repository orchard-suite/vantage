/**
 * The signed in frame every app page sits in: a sidebar with the library
 * (home, starred, shared, and where the reader was mentioned), the admin
 * page for admins, the reader's workspaces, how to connect an agent to this
 * hub, and the reader's own menu at its foot (their account and tokens, the
 * look they picked, sign out, and the release the hub runs); people who may
 * make team workspaces get the form for one there; a top bar with search;
 * then the page. On a phone the sidebar is a drawer the top bar's menu
 * button opens.
 */
import { escapeHtml, page } from './html.ts';
import { LOCKUP } from './look.ts';
import { ico } from './icons.ts';
import { HUB_VERSION } from '../version.ts';
import { READER_THEMES, type ReaderTheme } from '../theme.ts';
import type { AgentSetup } from '../agents.ts';
import { agentBox } from './agent-box.ts';

export interface FrameWorkspace {
  readonly slug: string;
  readonly name: string;
  readonly count: number;
}

export type FramePlace = { readonly kind: 'home' } | { readonly kind: 'shared' } | { readonly kind: 'starred' } | { readonly kind: 'mentions' } | { readonly kind: 'workspace'; readonly slug: string } | { readonly kind: 'admin' } | { readonly kind: 'account' } | { readonly kind: 'other' };

export interface FrameOptions {
  readonly title: string;
  readonly nonce: string;
  /** The session's CSRF token, for every script on the page that writes through the API. */
  readonly csrf?: string;
  /** Admins also get the Admin link in the sidebar; people who may make team workspaces get the form for one. */
  readonly user: { readonly name: string; readonly email?: string; readonly signOut: boolean; readonly admin?: boolean; readonly makesWorkspaces?: boolean; readonly theme?: ReaderTheme };
  readonly workspaces: readonly FrameWorkspace[];
  readonly sharedCount: number;
  /** Diagrams the reader starred; the Starred link shows when there is at least one, or while it is open. */
  readonly starredCount?: number;
  readonly place: FramePlace;
  /** How a reader connects an agent to this hub. */
  readonly agents: AgentSetup;
  readonly query?: string;
  /** Where Import in the top bar goes: the reader's own space, when they may write there. */
  readonly importHref?: string;
  /** Where New diagram in the top bar goes; absent when the reader can write nowhere. */
  readonly newHref?: string;
  readonly body: string;
}

/** Families a name may wear: everything but red, which reads as an error in chrome. */
const WEARABLE = ['amber', 'violet', 'emerald', 'teal', 'blue', 'pink', 'slate'] as const;

/** A stable family for a name, so a person or a workspace keeps its color everywhere. */
export function familyFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return WEARABLE[h % WEARABLE.length]!;
}

/** Up to two initials: "Ada Example" is AE, "local-developer" is LD. */
export function initials(name: string): string {
  const words = name.split(/[\s._@-]+/).filter(Boolean);
  const letters = (words.length > 1 ? [words[0]!, words[1]!] : [name]).map((w) => w[0] ?? '');
  return (words.length > 1 ? letters.join('') : name.slice(0, 2)).toUpperCase();
}

export function avatar(name: string, extra = ''): string {
  return `<span class="avatar fam-${familyFor(name)}${extra ? ` ${extra}` : ''}" title="${escapeHtml(name)}">${escapeHtml(initials(name))}</span>`;
}

const cur = (on: boolean): string => (on ? ' aria-current="page"' : '');

const THEME_LABEL: Record<ReaderTheme, string> = { system: 'Auto', light: 'Light', dark: 'Dark' };
const THEME_ICON = { system: 'monitor', light: 'sun', dark: 'moon' } as const;

/** Auto, Light, Dark: the look the reader picked, for every hub page and every diagram they open. */
function themePick(theme: ReaderTheme): string {
  const buttons = READER_THEMES.map((t) => `<button type="button" data-theme-pick="${t}" aria-pressed="${t === theme}" title="${t === 'system' ? 'Follow your system setting' : `Always ${t}`}">${ico(THEME_ICON[t], 14)}${THEME_LABEL[t]}</button>`).join('');
  return `<div class="seg theme-pick" role="group" aria-label="Look">${buttons}</div>`;
}

/** The reader at the sidebar's foot; everything about them opens above it: their account and tokens, the look, sign out, and the release. */
function meMenu(o: FrameOptions): string {
  const u = o.user;
  const out = u.signOut ? `<div role="separator"></div><a role="menuitem" href="/auth/logout">${ico('out', 15)}Sign out</a>` : '';
  return `<details class="me-menu"><summary class="me" aria-label="${escapeHtml(u.name)}: your account, look, and sign out">${avatar(u.name)}<span class="who"><b>${escapeHtml(u.name)}</b>${u.email ? `<span>${escapeHtml(u.email)}</span>` : ''}</span>${ico('updown', 14)}</summary>
<div class="menu me-pop" role="menu" aria-label="You"><a role="menuitem" href="/account"${cur(o.place.kind === 'account')}>${ico('user', 15)}Account and tokens</a><div role="separator"></div><div class="me-look" role="group" aria-label="Look"><span class="caps">Look</span>${themePick(u.theme ?? 'system')}</div>${out}<p class="release" title="The release this hub runs">Vantage ${escapeHtml(HUB_VERSION)}</p></div></details>`;
}

function sidebar(o: FrameOptions): string {
  const spaces = o.workspaces
    .map((w) => `<a href="/w/${encodeURIComponent(w.slug)}"${cur(o.place.kind === 'workspace' && o.place.slug === w.slug)}><span class="ws-tile fam-${familyFor(w.slug)}" aria-hidden="true">${escapeHtml(initials(w.name).slice(0, 1))}</span><span class="label">${escapeHtml(w.name)}</span><span class="n">${w.count}</span></a>`)
    .join('');
  const make = o.user.makesWorkspaces
    ? `<details class="new-ws"><summary>${ico('plus', 15)}<span class="label">New team workspace</span></summary><form data-new-workspace><label class="sr-only" for="new-ws-name">Workspace name</label><input class="field" id="new-ws-name" name="name" maxlength="200" placeholder="Workspace name" autocomplete="off" required><p class="f-hint">You own it. Invite people next.</p><p class="f-hint bad" role="alert" hidden></p><button class="btn primary sm">Make it</button></form></details>`
    : '';
  return `<aside class="side" id="side" aria-label="Main">
<div class="side-top"><a class="brand" href="/">${LOCKUP}</a><button class="btn ghost sm icon side-close" type="button" data-nav="close" aria-label="Close the menu">${ico('close', 15)}</button></div>
<nav class="nav" aria-label="Library"><a href="/"${cur(o.place.kind === 'home')}>${ico('home')}<span class="label">Home</span></a><a href="/?show=starred"${cur(o.place.kind === 'starred')}>${ico('star')}<span class="label">Starred</span><span class="n" data-starred-count>${o.starredCount ?? 0}</span></a><a href="/?show=shared"${cur(o.place.kind === 'shared')}>${ico('users')}<span class="label">Shared with you</span><span class="n">${o.sharedCount}</span></a><a href="/?show=mentions"${cur(o.place.kind === 'mentions')}>${ico('at')}<span class="label">Mentions</span></a>${o.user.admin ? `<a href="/admin"${cur(o.place.kind === 'admin')}>${ico('layers')}<span class="label">Admin</span></a>` : ''}</nav>
${spaces || make ? `<div class="side-sec"><span class="caps">Workspaces</span>${spaces ? `<nav class="nav" aria-label="Workspaces">${spaces}</nav>` : ''}${make}</div>` : ''}
${agentBox(o.agents)}
${meMenu(o)}
</aside>`;
}

/** The reader's menu closes on a click outside it and on Escape; focus search on "/", copy buttons that say they copied, the new team workspace form, and the phone drawer: the menu button, the scrim, and Escape. */
const FRAME_SCRIPT = `document.addEventListener('click',function(e){var m=document.querySelector('details.me-menu[open]');if(m&&!m.contains(e.target))m.open=false});
document.addEventListener('keydown',function(e){var m=document.querySelector('details.me-menu[open]');if(e.key==='Escape'&&m){m.open=false;m.querySelector('summary').focus()}});
document.addEventListener('keydown',function(e){if(e.key!=='/'||e.metaKey||e.ctrlKey||e.altKey)return;var t=e.target;if(t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))return;var q=document.querySelector('.bar input[name=q]');if(q){e.preventDefault();q.focus();q.select()}});
document.addEventListener('click',function(e){var b=e.target.closest('[data-copy]');if(!b||!navigator.clipboard)return;navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){var l=b.getAttribute('aria-label');b.setAttribute('aria-label','Copied');b.classList.add('soft');setTimeout(function(){b.setAttribute('aria-label',l);b.classList.remove('soft')},1600)})});
document.addEventListener('submit',function(e){var f=e.target.closest('form[data-new-workspace]');if(!f)return;e.preventDefault();var go=f.querySelector('button'),say=f.querySelector('[role=alert]'),m=document.querySelector('meta[name=csrf]'),h={'content-type':'application/json'};if(m)h['x-csrf-token']=m.content;go.disabled=true;say.hidden=true;
fetch('/api/v1/workspaces',{method:'POST',headers:h,credentials:'same-origin',body:JSON.stringify({name:f.querySelector('input[name=name]').value.trim()})}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'That did not work.');location.href='/w/'+encodeURIComponent(j.slug)+'?tab=members'})}).catch(function(x){say.textContent=x.message;say.hidden=false;go.disabled=false})});
(function(){var app=document.querySelector('.app'),open=document.querySelector('.bar [data-nav=open]');if(!app||!open)return;function set(on){app.classList.toggle('nav-open',on);open.setAttribute('aria-expanded',String(on));if(on){var c=app.querySelector('.side [aria-current]')||app.querySelector('.side a');if(c)c.focus()}else open.focus()}
document.addEventListener('click',function(e){var t=e.target.closest('[data-nav]');if(t)set(t.getAttribute('data-nav')==='open')});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&app.classList.contains('nav-open'))set(false)})})();
document.addEventListener('click',function(e){var b=e.target.closest('[data-theme-pick]');if(!b)return;var t=b.getAttribute('data-theme-pick'),r=document.documentElement,was=r.getAttribute('data-theme'),m=document.querySelector('meta[name=csrf]'),h={'content-type':'application/json'};if(m)h['x-csrf-token']=m.content;
function show(v){if(v==='light'||v==='dark')r.setAttribute('data-theme',v);else r.removeAttribute('data-theme');document.querySelectorAll('[data-theme-pick]').forEach(function(x){x.setAttribute('aria-pressed',String(x.getAttribute('data-theme-pick')===(v||'system')))})}
show(t);fetch('/api/v1/me/theme',{method:'PUT',headers:h,credentials:'same-origin',body:JSON.stringify({theme:t})}).then(function(r){if(!r.ok)throw 0}).catch(function(){show(was)})});`;

export function appPage(o: FrameOptions, script = ''): string {
  const bar = `<header class="bar"><button class="btn ghost icon menu-btn" type="button" data-nav="open" aria-controls="side" aria-expanded="false" aria-label="Open the menu">${ico('menu', 18)}</button><a class="brand bar-brand" href="/">${LOCKUP}</a><form role="search" method="get" action="/"><label class="well">${ico('search')}<span class="sr-only">Search diagrams</span><input name="q" type="search" placeholder="Search names, facts, questions" value="${escapeHtml(o.query ?? '')}" autocomplete="off"><kbd>/</kbd></label></form><div class="tools">${o.importHref ? `<a class="btn sm" href="${escapeHtml(o.importHref)}">${ico('import', 15)}<span class="label">Import</span></a>` : ''}<a class="btn ghost sm" href="/api">${ico('book', 15)}<span class="label">API</span></a>${o.newHref ? `<a class="btn primary sm" href="${escapeHtml(o.newHref)}">${ico('plus', 15)}<span class="label">New diagram</span></a>` : ''}</div></header>`;
  const theme = o.user.theme === 'light' || o.user.theme === 'dark' ? o.user.theme : undefined;
  return page(o.title, `<div class="app">${sidebar(o)}<div class="scrim" data-nav="close" aria-hidden="true"></div><div class="app-main">${o.csrf ? `<meta name="csrf" content="${escapeHtml(o.csrf)}">` : ''}${bar}<main class="wrap" id="main">${o.body}</main></div></div>`, o.nonce, FRAME_SCRIPT + script, theme);
}

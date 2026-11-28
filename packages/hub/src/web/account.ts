/**
 * The reader's account page at /account, opened from their menu at the foot
 * of the sidebar: who the hub knows them as, the apps they connected by
 * signing in (disconnect one), the tokens that let an agent or a script act
 * as them (make one, see it once, revoke it), and the ID
 * their sign-in service gave them, for an admin who asks.
 */
import type { AccessibleWorkspace } from '../authz.ts';
import type { AgentSetup } from '../agents.ts';
import type { TokenRow } from '../auth/tokens.ts';
import type { GrantRow } from '../auth/oauth.ts';
import type { HomeDocument } from './home-data.ts';
import { avatar, appPage } from './frame.ts';
import { frameWorkspaces, type HomeUser } from './home.ts';
import { escapeHtml } from './html.ts';
import { ico } from './icons.ts';
import { dayOf } from '../day.ts';

export interface AccountModel {
  readonly nonce: string;
  readonly csrf?: string;
  readonly user: HomeUser;
  /** The ID the sign-in service gave the reader. */
  readonly subject: string;
  readonly workspaces: readonly AccessibleWorkspace[];
  readonly documents: readonly HomeDocument[];
  readonly agents: AgentSetup;
  /** The reader's own tokens, newest first; revoked ones are left out. */
  readonly tokens: readonly TokenRow[];
  /** Apps the reader connected by signing in through the hub. */
  readonly connections: readonly GrantRow[];
  readonly now?: number;
}


function tokenRow(t: TokenRow, now: number): string {
  const expired = t.expires_at !== null && t.expires_at.getTime() < now;
  const ends = t.expires_at ? `${expired ? 'Ended' : 'Ends'} ${dayOf(t.expires_at)}` : 'Never ends';
  const used = t.last_used_at ? `Last used ${dayOf(t.last_used_at)}` : 'Never used';
  const kind = t.kind === 'automation' ? '<span class="pill">Automation</span>' : '';
  return `<li data-token="${escapeHtml(t.id)}"><span class="tk-name">${ico('key', 15)}<b>${escapeHtml(t.name)}</b>${kind}${expired ? '<span class="pill warn">Ended</span>' : ''}</span><span class="tk-when">Made ${dayOf(t.created_at)} · ${used} · ${ends}</span><button class="btn ghost sm" type="button" data-revoke="${escapeHtml(t.id)}">Revoke</button></li>`;
}

function connectionRow(g: GrantRow): string {
  const used = g.last_used_at ? `Last signed in ${dayOf(g.last_used_at)}` : 'Not used yet';
  return `<li><span class="tk-name">${ico('link', 15)}<b>${escapeHtml(g.client_name)}</b></span><span class="tk-when">Connected ${dayOf(g.created_at)} · ${used}</span><button class="btn ghost sm" type="button" data-revoke="${escapeHtml(g.id)}" data-what="connections">Disconnect</button></li>`;
}

/** Makes a token and shows it once; revokes one after a second click. Both go through the API with the session. */
const SCRIPT = `(function(){var m=document.querySelector('meta[name=csrf]'),h={'content-type':'application/json'};if(m)h['x-csrf-token']=m.content;
var f=document.querySelector('form[data-make-token]');if(f)f.addEventListener('submit',function(e){e.preventDefault();var go=f.querySelector('button'),say=f.querySelector('[role=alert]'),days=Number(f.querySelector('select').value),b={name:f.querySelector('input[name=name]').value.trim(),kind:'personal'};if(days)b.expiresInDays=days;go.disabled=true;say.hidden=true;
fetch('/api/v1/tokens',{method:'POST',headers:h,credentials:'same-origin',body:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'That did not work.');var o=document.getElementById('tk-new');o.querySelector('code').textContent=j.token;o.querySelector('[data-copy]').setAttribute('data-copy',j.token);o.hidden=false;var li=document.createElement('li'),nm=document.createElement('span'),w=document.createElement('span'),x=document.createElement('b');nm.className='tk-name';x.textContent=j.name;nm.appendChild(x);w.className='tk-when';w.textContent='Made just now · Never used';li.appendChild(nm);li.appendChild(w);document.querySelector('.tk-list').prepend(li);f.reset();go.disabled=false;var n=document.getElementById('tk-none');if(n)n.hidden=true})}).catch(function(x){say.textContent=x.message;say.hidden=false;go.disabled=false})});
document.addEventListener('click',function(e){var b=e.target.closest('[data-revoke]');if(!b)return;if(!b.classList.contains('bad')){b.classList.add('bad');b.textContent=b.textContent==='Disconnect'?'Disconnect it':'Revoke it';return}b.disabled=true;
fetch('/api/v1/'+(b.getAttribute('data-what')||'tokens')+'/'+encodeURIComponent(b.getAttribute('data-revoke')),{method:'DELETE',headers:h,credentials:'same-origin'}).then(function(r){if(!r.ok)throw 0;b.closest('li').remove()}).catch(function(){b.disabled=false;b.textContent='Try again'})})})();`;

export function accountHtml(m: AccountModel): string {
  const now = m.now ?? Date.now();
  const live = m.tokens.filter((t) => t.revoked_at === null && t.grant_id === null);
  const apps = m.connections.length
    ? `<section class="acct-sec" aria-labelledby="ca-h"><header><h2 id="ca-h">Connected apps</h2><p>Apps you let in by signing in from them, such as Claude. Each acts as you until you disconnect it.</p></header><ul class="tk-list">${m.connections.map(connectionRow).join('')}</ul></section>`
    : '';
  const list = live.length ? live.map((t) => tokenRow(t, now)).join('') : '';
  const body = `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${ico('right', 12)}<span aria-current="page">Account</span></nav>
<header class="acct-head">${avatar(m.user.name, 'lg')}<div><h1>${escapeHtml(m.user.name)}</h1>${m.user.email ? `<p>${escapeHtml(m.user.email)}</p>` : ''}</div></header>
${apps}
<section class="acct-sec" aria-labelledby="tk-h"><header><h2 id="tk-h">Tokens</h2><p>A token lets an agent or a script act as you on this hub. Claude Code asks for one when you add the Vantage plugin. Anyone who holds it can do what you can, so keep it like a password.</p></header>
<form class="tk-make" data-make-token><label class="sr-only" for="tk-name">Token name</label><input class="field" id="tk-name" name="name" maxlength="100" placeholder="What it is for, like Claude Code on my laptop" autocomplete="off" required><label class="sr-only" for="tk-days">How long it lasts</label><select class="field" id="tk-days"><option value="90">90 days</option><option value="365">1 year</option><option value="30">30 days</option><option value="0">Never ends</option></select><button class="btn primary sm">${ico('plus', 15)}Make a token</button><p class="f-hint bad" role="alert" hidden></p></form>
<div class="tk-new" id="tk-new" role="status" hidden><b>${ico('check', 15)}Your new token. Copy it now: this is the only time it shows.</b><div class="url"><code></code><button class="btn ghost sm icon" type="button" data-copy="" aria-label="Copy the token">${ico('copy', 14)}</button></div></div>
<ul class="tk-list">${list}</ul>${live.length ? '' : '<p class="f-hint" id="tk-none">No tokens yet.</p>'}</section>
<section class="acct-sec" aria-labelledby="sub-h"><header><h2 id="sub-h">Sign-in ID</h2><p>The ID your sign-in service gave you. You will not need it day to day. An admin may ask for it to find your account.</p></header><div class="url"><code>${escapeHtml(m.subject)}</code><button class="btn ghost sm icon" type="button" data-copy="${escapeHtml(m.subject)}" aria-label="Copy your sign-in ID">${ico('copy', 14)}</button></div></section>`;
  const { spaces, shared, starred } = frameWorkspaces(m.workspaces, m.documents, m.user.id);
  return appPage({ title: 'Account', nonce: m.nonce, ...(m.csrf ? { csrf: m.csrf } : {}), user: m.user, workspaces: spaces, sharedCount: shared, starredCount: starred, place: { kind: 'account' }, agents: m.agents, body }, SCRIPT);
}

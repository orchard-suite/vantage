/**
 * A list of diagrams as picture cards or rows, with its sort and layout
 * switches. The home page and the workspace page both show one.
 */
import { mayDeleteDocument, type AccessibleWorkspace } from '../authz.ts';
import type { HomeDocument } from './home-data.ts';
import { escapeHtml, updatedLabel } from './html.ts';
import { avatar } from './frame.ts';
import { MARK } from './look.ts';
import { ico } from './icons.ts';
import { clockOf } from '../day.ts';

export type Sort = 'recent' | 'name';
export type Layout = 'grid' | 'list';

export const isMine = (w: AccessibleWorkspace, userId: string): boolean => w.kind === 'personal' && w.owner_user_id === userId;
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "3h ago" for a card; the exact time rides in the title. */
export function when(d: Date, now: number): string {
  return updatedLabel(d, now).replace(/^Updated /, '').replace(/^just now$/, 'Just now');
}

/** Your own space is "Your space"; everyone else's keeps its name. */
export function spaceName(w: AccessibleWorkspace, userId: string): string {
  return isMine(w, userId) ? 'Your space' : w.name;
}

/** What a card says about its state: still drawing, out of step with its sources, or live from them. */
export function statusPill(d: HomeDocument): string {
  if (!d.rendered) return '<span class="pill info busy">Rendering</span>';
  if (d.drift) return `<span class="pill warn" title="Boxes that no longer match what the sources found">${d.drift} drifted</span>`;
  if (d.sources.length) return `<span class="pill ok" title="${escapeHtml(d.sources.join(', '))}">Live from ${escapeHtml(d.sources[0]!)}${d.sources.length > 1 ? ` +${d.sources.length - 1}` : ''}</span>`;
  return '';
}

function docUrl(w: AccessibleWorkspace, d: HomeDocument): string {
  return `/w/${encodeURIComponent(w.slug)}/${encodeURIComponent(d.slug)}`;
}

/** The star toggle; the script below flips it through the API. */
function starButton(d: HomeDocument): string {
  return `<button class="star-btn" type="button" data-star="${escapeHtml(d.id)}" aria-pressed="${d.starred}" aria-label="${d.starred ? 'Remove the star from' : 'Star'} ${escapeHtml(d.name)}" title="${d.starred ? 'Starred' : 'Star'}">${ico('star', 15)}</button>`;
}

/** The card's menu: move to a folder (authors, on a workspace page) and delete (as the workspace's rule lets), with a second step to confirm. */
function moreMenu(d: HomeDocument, folders: readonly LibraryFolder[] | undefined, deletable: boolean): string {
  if (!folders && !deletable) return '';
  const id = escapeHtml(d.id);
  const name = escapeHtml(d.name);
  let move = '';
  if (folders) {
    const items = folders.map((f) => `<button type="button" role="menuitem" data-move="${id}" data-folder="${escapeHtml(f.id)}"${f.id === d.folderId ? ' aria-current="true"' : ''}>${ico('layers', 14)}<span>${escapeHtml(f.name)}</span>${f.id === d.folderId ? `<span class="k">${ico('check', 13)}</span>` : ''}</button>`).join('');
    const out = d.folderId ? `<div role="separator"></div><button type="button" role="menuitem" data-move="${id}" data-folder="">Take out of the folder</button>` : '';
    const none = folders.length ? '' : '<p class="group f-hint">No folders yet. Make one above the list.</p>';
    move = `<div class="group caps">Move to</div>${none}${items}${out}`;
  }
  const del = deletable
    ? `${move ? '<div role="separator"></div>' : ''}<button type="button" role="menuitem" class="bad" data-ask-delete>${ico('trash', 14)}<span>Delete diagram</span></button><div class="del-ask" hidden><p>Delete <b>${name}</b> with its history, comments, and links? You cannot undo this.</p><div class="del-acts"><button class="btn ghost sm" type="button" data-ask-cancel>Keep it</button><button class="btn danger sm" type="button" data-delete="/api/v1/documents/${encodeURIComponent(d.id)}">Delete</button></div></div>`
    : '';
  return `<details class="card-more"><summary class="btn ghost sm icon" aria-label="More for ${name}" title="More">${ico('more', 15)}</summary><div class="menu" role="menu">${move}${del}</div></details>`;
}

function deletable(w: AccessibleWorkspace, d: HomeDocument, o: LibraryOptions): boolean {
  return mayDeleteDocument({ userId: o.userId, admin: o.admin }, w, d.createdBy);
}

function card(w: AccessibleWorkspace, d: HomeDocument, userId: string, now: number, o: LibraryOptions): string {
  const url = docUrl(w, d);
  const thumb = d.hasThumb ? `<img src="${url}/thumb.svg" alt="" loading="lazy" decoding="async">` : MARK;
  const views = d.views ? ` / ${plural(d.views, 'view')}` : '';
  return `<li class="doc-card"><a class="cover" href="${url}" aria-label="Open ${escapeHtml(d.name)}"></a>
<div class="thumb${d.hasThumb ? '' : ' none'}">${thumb}${statusPill(d)}</div><div class="card-acts">${moreMenu(d, o.folders, deletable(w, d, o))}${starButton(d)}</div>
<div class="body"><span class="name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</span><span class="meta">${escapeHtml(spaceName(w, userId))}${views}</span><div class="foot">${d.author ? avatar(d.author) : ''}<span class="when" title="${clockOf(d.updatedAt)}">${when(d.updatedAt, now)}</span></div></div></li>`;
}

function row(w: AccessibleWorkspace, d: HomeDocument, userId: string, now: number, o: LibraryOptions): string {
  const url = docUrl(w, d);
  return `<div class="lrow-wrap"><a class="lrow" href="${url}"><span class="nm"><span class="mini">${d.hasThumb ? `<img src="${url}/thumb.svg" alt="" loading="lazy">` : ''}</span><span>${escapeHtml(d.name)}</span></span><span class="sub hide-s">${escapeHtml(spaceName(w, userId))}</span><span class="num hide-s">${d.views || ''}</span><span class="hide-s">${statusPill(d)}</span><span class="num" title="${clockOf(d.updatedAt)}">${when(d.updatedAt, now)}</span></a>${moreMenu(d, o.folders, deletable(w, d, o))}${starButton(d)}</div>`;
}

export interface LibraryFolder {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

export interface LibraryOptions {
  readonly documents: readonly HomeDocument[];
  readonly workspaces: ReadonlyMap<string, AccessibleWorkspace>;
  readonly userId: string;
  /** The reader is an org admin, who may delete any diagram they can edit. */
  readonly admin: boolean;
  readonly sort: Sort;
  readonly layout: Layout;
  /** The page's own url with these switches changed. */
  readonly href: (change: Partial<{ sort: Sort; layout: Layout }>) => string;
  /** Said when there is nothing to list. */
  readonly empty: string;
  readonly now: number;
  /** The workspace's folders, when the reader may move cards into them. */
  readonly folders?: readonly LibraryFolder[];
}

/** The sort and layout switches, as links. */
export function libraryTools(o: LibraryOptions): string {
  const seg = (label: string, to: string, on: boolean, aria = ''): string => `<a href="${escapeHtml(to)}"${on ? ' aria-current="page"' : ''}${aria ? ` aria-label="${aria}"` : ''}>${label}</a>`;
  return `<div class="tools"><div class="seg" role="group" aria-label="Sort">${seg(`${ico('clock', 14)}Recent`, o.href({ sort: 'recent' }), o.sort === 'recent')}${seg(`${ico('sort', 14)}Name`, o.href({ sort: 'name' }), o.sort === 'name')}</div><div class="seg" role="group" aria-label="Layout">${seg(ico('grid', 14), o.href({ layout: 'grid' }), o.layout === 'grid', 'Cards')}${seg(ico('list', 14), o.href({ layout: 'list' }), o.layout === 'list', 'List')}</div></div>`;
}

/** The cards or rows themselves, sorted as asked. */
export function libraryItems(o: LibraryOptions): string {
  const docs = o.sort === 'name' ? [...o.documents].sort((a, b) => a.name.localeCompare(b.name)) : o.documents;
  if (!docs.length) return `<p class="none-here">${o.empty}</p>`;
  if (o.layout === 'list') {
    return `<div class="rows"><div class="lrow head" aria-hidden="true"><span>Name</span><span class="hide-s">Workspace</span><span class="hide-s">Views</span><span class="hide-s">Status</span><span>Updated</span></div>${docs.map((d) => row(o.workspaces.get(d.workspaceId)!, d, o.userId, o.now, o)).join('')}</div>`;
  }
  return `<ul class="cards">${docs.map((d) => card(o.workspaces.get(d.workspaceId)!, d, o.userId, o.now, o)).join('')}</ul>`;
}

/**
 * Stars, folder moves, and deletes through the API with the page's CSRF
 * token. A star flips in place; a move or a delete reloads, since the card
 * may leave the list shown. A delete asks once more inside the menu.
 */
export const LIBRARY_SCRIPT = `(function(){var m=document.querySelector('meta[name=csrf]');function call(method,url,body){var h={};if(m)h['x-csrf-token']=m.content;if(body)h['content-type']='application/json';return fetch(url,{method:method,headers:h,credentials:'same-origin',body:body?JSON.stringify(body):undefined}).then(function(r){if(!r.ok)return r.json().then(function(j){throw new Error(j.error||'That did not work.')});return r})}
function say(t){var x=document.getElementById('toast');if(!x)return;x.querySelector('span').textContent=t;x.hidden=false;setTimeout(function(){x.hidden=true},3500)}
document.addEventListener('click',function(e){var s=e.target.closest('[data-star]');if(s){e.preventDefault();var on=s.getAttribute('aria-pressed')!=='true';s.setAttribute('aria-pressed',String(on));call(on?'PUT':'DELETE','/api/v1/documents/'+encodeURIComponent(s.getAttribute('data-star'))+'/star').then(function(){s.title=on?'Starred':'Star';var c=document.querySelector('[data-starred-count]');if(c)c.textContent=String(Math.max(0,Number(c.textContent)+(on?1:-1)))}).catch(function(x){s.setAttribute('aria-pressed',String(!on));say(x.message)});return}
var mv=e.target.closest('[data-move]');if(mv){e.preventDefault();var f=mv.getAttribute('data-folder');call('PUT','/api/v1/documents/'+encodeURIComponent(mv.getAttribute('data-move'))+'/folder',{folderId:f||null}).then(function(){location.reload()}).catch(function(x){say(x.message)})}});
document.addEventListener('submit',function(e){var f=e.target.closest('form[data-api]');if(!f)return;e.preventDefault();var b={};[].forEach.call(f.elements,function(el){if(el.name)b[el.name]=el.value});var go=f.querySelector('button[type=submit],button:not([type])');if(go)go.disabled=true;
call(f.getAttribute('data-method')||'POST',f.getAttribute('data-api'),b).then(function(r){return r.status===204?{}:r.json()}).then(function(j){var next=f.getAttribute('data-next');if(next==='folder'&&j.id){location.href=location.pathname+'?folder='+encodeURIComponent(j.id)}else if(next){location.href=next}else{location.reload()}}).catch(function(x){say(x.message);if(go)go.disabled=false})});
document.addEventListener('click',function(e){var a=e.target.closest('[data-ask-delete]');if(a){e.preventDefault();var q=a.nextElementSibling;a.hidden=true;q.hidden=false;q.querySelector('[data-delete]').focus();return}var k=e.target.closest('[data-ask-cancel]');if(k){e.preventDefault();var w=k.closest('.del-ask');w.hidden=true;w.previousElementSibling.hidden=false;w.previousElementSibling.focus()}});
document.addEventListener('click',function(e){var d=e.target.closest('[data-delete]');if(!d)return;e.preventDefault();d.disabled=true;call('DELETE',d.getAttribute('data-delete')).then(function(){var n=d.getAttribute('data-next');if(n)location.href=n;else location.reload()}).catch(function(x){say(x.message);d.disabled=false})});
document.addEventListener('click',function(e){[].forEach.call(document.querySelectorAll('details.card-more[open]'),function(x){if(x.contains(e.target))return;x.open=false;var q=x.querySelector('.del-ask');if(q){q.hidden=true;q.previousElementSibling.hidden=false}})})})();`;

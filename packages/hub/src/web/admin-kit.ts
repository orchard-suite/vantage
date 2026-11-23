/**
 * The parts every admin console page shares: the page frame with its
 * breadcrumb, bytes as a person reads them, the disk bar and its key, the
 * treemap that draws workspaces and diagrams by what they hold, and the
 * buttons and script that call the admin API with the session's CSRF token.
 */
import type { AccessibleWorkspace } from '../authz.ts';
import type { AgentSetup } from '../agents.ts';
import type { HomeDocument } from './home-data.ts';
import { DISK_PARTS, type Disk, type DiskPart } from './admin-data.ts';
import { escapeHtml } from './html.ts';
import { appPage } from './frame.ts';
import { frameWorkspaces, type HomeUser } from './home.ts';
import { squarify } from './treemap.ts';

/** What every admin page needs to draw its frame. */
export interface AdminFrame {
  readonly nonce: string;
  readonly csrf?: string;
  readonly user: HomeUser;
  readonly workspaces: readonly AccessibleWorkspace[];
  readonly documents: readonly HomeDocument[];
  readonly agents: AgentSetup;
  readonly now?: number;
}

export const PART_LABEL: Record<DiskPart, string> = {
  renders: 'Rendered pictures',
  history: 'Versions',
  observed: 'Connector data',
  audio: 'Voice walkthroughs',
  icons: 'Icons',
};

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** A bar of bytes by kind; `of` sets the scale so bars in one list compare. */
export function diskBar(d: Partial<Disk>, of: number, label = ''): string {
  const parts = DISK_PARTS.filter((k) => (d[k] ?? 0) > 0)
    .map((k) => `<i class="dk-${k}" style="width:${(((d[k] ?? 0) / Math.max(of, 1)) * 100).toFixed(2)}%"></i>`)
    .join('');
  return `<span class="disk"${label ? ` role="img" aria-label="${escapeHtml(label)}"` : ' aria-hidden="true"'}>${parts}</span>`;
}

/** The key under a disk bar: each kind it holds with its bytes. */
export function diskKey(d: Partial<Disk>): string {
  const parts = DISK_PARTS.filter((k) => (d[k] ?? 0) > 0);
  if (!parts.length) return '<p class="disk-key">Nothing on disk yet.</p>';
  return `<p class="disk-key">${parts.map((k) => `<span><i class="dk-${k}"></i>${PART_LABEL[k]} <b>${bytes(d[k] ?? 0)}</b></span>`).join('')}</p>`;
}

/** A button that sends one admin API call, after the reader says yes to `confirm` when it has one; the script reloads the page when it worked. */
export function act(label: string, method: string, url: string, body?: Record<string, unknown>, tone = '', confirm = ''): string {
  return `<button class="btn sm${tone ? ` ${tone}` : ''}" type="button" data-act="${method}" data-url="${escapeHtml(url)}"${body ? ` data-body="${escapeHtml(JSON.stringify(body))}"` : ''}${confirm ? ` data-confirm="${escapeHtml(confirm)}"` : ''}>${label}</button>`;
}

/** One tile of a map: its link, its look, and the lines it shows while they fit. */
export interface MapTile {
  readonly href: string;
  readonly bytes: number;
  readonly tone: string;
  readonly name: string;
  readonly lines: readonly string[];
  readonly tags?: string;
  readonly title: string;
}

/**
 * A treemap of tiles sized by bytes, in a frame of the given proportions.
 * The script hides a tile's lines from the bottom up while they do not fit,
 * so a small tile shows only its color and says its name on hover. Every tile
 * is also a row in a list beside the map, so none is reached only here.
 */
export function treemap(tiles: readonly MapTile[], label: string, width = 16, height = 7): string {
  const sum = tiles.reduce((s, t) => s + t.bytes, 0);
  const draw = (w: number, h: number, cls: string, least: number): string => {
    const cells = squarify(tiles.filter((t) => t.bytes >= sum * least), (t) => t.bytes, w, h).map(({ item: t, x, y, w: tw, h: th }) => {
      const style = `left:${x.toFixed(3)}%;top:${y.toFixed(3)}%;width:${tw.toFixed(3)}%;height:${th.toFixed(3)}%`;
      return `<a class="a-tile ${t.tone}" href="${escapeHtml(t.href)}" style="${style}" title="${escapeHtml(t.title)}"><b class="t-name">${escapeHtml(t.name)}</b>${t.lines.map((l) => `<span class="t-line">${l}</span>`).join('')}${t.tags ? `<span class="t-tags">${t.tags}</span>` : ''}</a>`;
    });
    return `<div class="a-map ${cls}" role="img" aria-label="${escapeHtml(label)}" style="aspect-ratio:${w}/${h}">${cells.join('')}</div>`;
  };
  // A phone gets its own layout in a taller frame, so tiles keep their proportions, and leaves out what is too small to name there.
  return draw(width, height, 'map-wide', 0) + draw(4, 5, 'map-tall', 0.05);
}

/**
 * Sends one admin API call from a button (its data-body, after its data-confirm) or a form (its fields: an empty number is null, a
 * checkbox is true or false, and a field named user fills :user in the address), then reloads. Fits each map tile's text to its tile.
 */
const ADMIN_SCRIPT = `function send(b,url,method,body){b.disabled=true;var m=document.querySelector('meta[name=csrf]'),h={'content-type':'application/json'};if(m)h['x-csrf-token']=m.content;var t=document.getElementById('toast');
fetch(url,{method:method,headers:h,credentials:'same-origin',body:body}).then(function(r){if(r.ok){location.reload();return}return r.json().then(function(j){throw new Error(j.error||'That did not work.')})}).catch(function(x){t.querySelector('span').textContent=x.message||'The hub did not answer. Try again.';t.hidden=false;setTimeout(function(){t.hidden=true},4000);b.disabled=false})}
document.addEventListener('click',function(e){var b=e.target.closest('button[data-act]');if(!b||b.disabled)return;var c=b.getAttribute('data-confirm');if(c&&!confirm(c))return;send(b,b.getAttribute('data-url'),b.getAttribute('data-act'),b.getAttribute('data-body')||undefined)});
document.addEventListener('submit',function(e){var f=e.target.closest('form[data-act]');if(!f)return;e.preventDefault();var o={},url=f.getAttribute('data-url');Array.prototype.forEach.call(f.elements,function(el){if(!el.name)return;if(el.name==='user'){url=url.replace(':user',encodeURIComponent(el.value));return}o[el.name]=el.type==='checkbox'?el.checked:el.type==='number'?(el.value===''?null:Number(el.value)):el.value});send(f.querySelector('button:not([type=button])')||f,url,f.getAttribute('data-act'),JSON.stringify(o))});
function fit(){document.querySelectorAll('.a-tile').forEach(function(t){if(!t.offsetParent)return;var kids=Array.prototype.slice.call(t.children);kids.forEach(function(k){k.hidden=false});var over=function(){return t.scrollHeight>t.clientHeight+1||t.scrollWidth>t.clientWidth+1};for(var i=kids.length-1;i>=0&&over();i--)kids[i].hidden=true;t.classList.toggle('a-bare',kids.every(function(k){return k.hidden}))})}
fit();var ft;addEventListener('resize',function(){clearTimeout(ft);ft=setTimeout(fit,80)});if(document.fonts)document.fonts.ready.then(fit);`;

/** The page frame: breadcrumb from Admin down, then the body, then the toast the script fills. */
export function adminPage(f: AdminFrame, title: string, crumbs: readonly (readonly [string, string])[], body: string): string {
  const trail = [['Admin', '/admin'] as const, ...crumbs];
  const nav = `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${trail.map(([label, href], i) => (i === trail.length - 1 ? `<span aria-current="page">${escapeHtml(label)}</span>` : `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`)).join('')}</nav>`;
  const toast = '<div class="toast toast-float" id="toast" role="status" hidden><span></span></div>';
  const { spaces, shared, starred } = frameWorkspaces(f.workspaces, f.documents, f.user.id);
  return appPage(
    { title, nonce: f.nonce, ...(f.csrf ? { csrf: f.csrf } : {}), user: { ...f.user, admin: true }, workspaces: spaces, sharedCount: shared, starredCount: starred, place: { kind: 'admin' }, agents: f.agents, body: `<div class="adm">${nav}${body}</div>${toast}` },
    ADMIN_SCRIPT,
  );
}

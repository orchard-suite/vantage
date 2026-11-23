/**
 * The kit page at /kit: every part of the interface kit on one page, in
 * the reader's theme, so a change to packages/render/src/kit.ts can be
 * checked by eye and by screenshot. It mirrors the Components board of the
 * design canvas. The switches, segments, chips and tabs work; nothing is
 * saved.
 */
import { page } from './html.ts';
import { MARK } from './look.ts';
import { ico } from './icons.ts';

function panel(id: string, title: string, hint: string, body: string, wide = false): string {
  return `<section class="k-panel${wide ? ' k-wide' : ''}" aria-labelledby="k-${id}"><div class="k-ph"><h2 id="k-${id}">${title}</h2>${hint ? `<span class="f-hint">${hint}</span>` : ''}</div>${body}</section>`;
}

const FAMILIES = ['slate', 'blue', 'violet', 'emerald', 'amber', 'red', 'teal', 'pink'];

const BUTTONS = `<div class="k-line"><button class="btn primary" type="button">Share</button><button class="btn" type="button">Export</button><button class="btn soft" type="button">Walk through</button><button class="btn ghost" type="button">Cancel</button><button class="btn danger" type="button">Delete diagram</button></div>
<div class="k-line"><button class="btn primary" type="button">${ico('plus')}New diagram</button><button class="btn" type="button">${ico('import')}Import</button><button class="btn icon" type="button" aria-label="More">${ico('more')}</button><button class="btn ghost icon" type="button" aria-label="Zoom in">${ico('plus')}</button><span class="split"><button class="btn primary" type="button">New diagram</button><button class="btn primary" type="button" aria-label="More ways to start">${ico('chevron', 12)}</button></span></div>
<div class="k-line"><button class="btn primary sm" type="button">Small</button><button class="btn primary" type="button">Default</button><button class="btn primary lg" type="button">Large</button><button class="btn primary" type="button" aria-busy="true"><span class="spinner" aria-hidden="true"></span>Saving</button><button class="btn" type="button" disabled>Disabled</button></div>`;

const FIELDS = `<div class="k-two">
<div class="f-row"><label class="f-label" for="k-f1">Diagram name</label><input id="k-f1" class="field" placeholder="Coffee shop ordering"><span class="f-hint">Shown in the hub and on exports</span></div>
<div class="f-row"><label class="f-label" for="k-f2">View id</label><input id="k-f2" class="field mono" value="requests"><span class="f-hint">Lowercase, used in links</span></div>
<div class="f-row"><label class="f-label" for="k-f3">Passcode</label><input id="k-f3" class="field" value="abc" aria-invalid="true" aria-describedby="k-f3e"><span id="k-f3e" class="f-error">${ico('error', 13)}Use at least 6 characters</span></div>
<div class="f-row"><label class="f-label" for="k-f4">Workspace</label><select id="k-f4" class="field"><option>Platform Engineering</option><option>Your space</option></select></div>
</div>
<label class="well">${ico('search')}<span class="sr-only">Search</span><input type="search" placeholder="Search diagrams, boxes, facts and questions"><kbd>Ctrl K</kbd></label>
<div class="f-row"><label class="f-label" for="k-f5">Steer</label><textarea id="k-f5" class="field" rows="2" placeholder="Put the stores on the right and keep Stripe next to the worker"></textarea></div>`;

const sw = (id: string, label: string, note: string, on: boolean): string =>
  `<div class="k-row"><span class="k-col"><span id="${id}" class="k-strong">${label}</span><span class="f-hint">${note}</span></span><button type="button" role="switch" class="switch" aria-checked="${on}" aria-labelledby="${id}"></button></div>`;

const CHOICES = `<div class="k-two">
<fieldset class="k-set"><legend class="caps">Checkbox</legend><label class="choice"><input type="checkbox" class="check" checked>Include legend</label><label class="choice"><input type="checkbox" class="check">Show resolved comments</label><label class="choice"><input type="checkbox" class="check" data-mixed>Select all, 3 of 6</label></fieldset>
<fieldset class="k-set"><legend class="caps">Radio</legend><label class="choice"><input type="radio" name="k-r" class="radio" checked>Let Vantage lay it out</label><label class="choice"><input type="radio" name="k-r" class="radio">Keep where things are</label></fieldset>
</div>
<div>${sw('k-s1', 'Live reload', 'Redraw when the file is saved', true)}${sw('k-s2', 'Tell me about drift', 'A note when a source finds changes', false)}</div>
<div class="k-line"><div class="seg" role="group" aria-label="Theme"><button type="button" aria-pressed="true">Light</button><button type="button" aria-pressed="false">Dark</button><button type="button" aria-pressed="false">Match system</button></div>
<div class="k-detail" role="group" aria-label="Detail"><span class="caps">Detail</span><span class="steps"><button type="button" class="on" aria-label="Names only"></button><button type="button" class="on" aria-label="Names and subtitles"></button><button type="button" aria-label="Everything"></button></span></div></div>
<div class="k-line"><button type="button" class="chip fam-blue" aria-pressed="true"><span class="dot"></span>Apps</button><button type="button" class="chip fam-emerald" aria-pressed="false"><span class="dot"></span>Data</button><button type="button" class="chip fam-teal" aria-pressed="false"><span class="dot"></span>Edge</button><button type="button" class="chip fam-violet" aria-pressed="true"><span class="dot"></span>Outside</button></div>`;

const STATUS = `<div class="k-line"><span class="pill ok">Clean render</span><span class="pill warn">2 drifted</span><span class="pill bad">1 broken ref</span><span class="pill info busy">Rendering</span><span class="pill">Draft</span></div>
<div class="k-line"><span class="count">3</span><span class="tally">12 views</span><span class="more">+3 more</span><kbd>/</kbd><kbd>P</kbd><kbd>Ctrl K</kbd><span class="id">sub-shop-prod</span></div>
<div class="f-row"><span class="caps">Families, for meaning a legend can teach</span><div class="k-line">${FAMILIES.map((f) => `<span class="swatch fam-${f}">${f[0]!.toUpperCase()}${f.slice(1)}</span>`).join('')}</div></div>
<div class="k-line"><span class="avatars"><span class="avatar here fam-amber">JS</span><span class="avatar here fam-teal">MK</span><span class="avatar fam-violet">DR</span><span class="avatar">+3</span></span><span class="f-hint">A ring means here right now</span></div>`;

const NAV = `<div class="tabs" role="tablist" aria-label="Example tabs"><button type="button" role="tab" aria-selected="true">Diagrams</button><button type="button" role="tab" aria-selected="false">Sources</button><button type="button" role="tab" aria-selected="false">Publications</button><button type="button" role="tab" aria-selected="false">Members</button></div>
<div class="k-two"><nav class="nav k-box" aria-label="Example sidebar"><a href="#" aria-current="page">${ico('home')}Home</a><a href="#">${ico('clock')}Recent</a><a href="#">${ico('star')}Starred<span class="n">2</span></a></nav>
<div class="k-col k-gap"><nav class="crumbs" aria-label="Breadcrumb example"><a href="#">Home</a>${ico('right', 12)}<a href="#">Platform</a>${ico('right', 12)}<span aria-current="page">Beacon</span></nav>
<div class="k-line"><button class="btn sm ghost icon" type="button" aria-label="Previous page">${ico('left', 14)}</button><span class="mono k-muted">3 of 4</span><button class="btn sm ghost icon" type="button" aria-label="Next page">${ico('right', 14)}</button></div>
<a class="link" href="#">A link in running text</a></div></div>`;

const OVERLAYS = `<div class="k-line k-top"><div class="menu" role="menu" aria-label="Diagram actions"><button type="button" role="menuitem">${ico('play', 15)}Present<span class="k">P</span></button><button type="button" role="menuitem">${ico('export', 15)}Export<span class="k">Ctrl E</span></button><button type="button" role="menuitem">${ico('copy', 15)}Duplicate</button><button type="button" role="menuitem">${ico('code', 15)}Open the YAML</button><div role="separator"></div><button type="button" role="menuitem" class="bad">${ico('trash', 15)}Move to trash</button></div>
<div class="k-col k-gap k-grow"><span class="k-line"><button class="btn icon" type="button" aria-label="Fit to screen" aria-describedby="k-tt">${ico('fit')}</button><span id="k-tt" role="tooltip" class="tip">Fit to screen <span class="k">0</span></span></span>
<div class="toast" role="status"><span class="k-ok">${ico('check')}</span><span class="k-fill">Link copied</span><button type="button">Undo</button></div>
<div class="banner warn" role="status">${ico('warn')}<span>This picture is 2 days behind Azure. <a href="#">Run the source</a></span></div>
<div class="banner ok">${ico('check')}<span>Matches Azure Resource Graph as of 2h ago.</span></div></div></div>`;

const CARDS = `<div class="k-two"><article class="doc-card"><a class="cover" href="#" aria-label="Open Shop Architecture"></a><div class="thumb"><svg viewBox="0 0 240 150" aria-hidden="true"><rect x="72" y="22" width="152" height="110" rx="9" fill="var(--panel)" stroke="var(--line2)"/><rect x="14" y="63" width="42" height="24" rx="6" fill="var(--slate-fill)" stroke="var(--slate-stroke)"/><rect x="88" y="48" width="50" height="22" rx="6" fill="var(--blue-fill)" stroke="var(--blue-stroke)"/><rect x="88" y="90" width="50" height="22" rx="6" fill="var(--blue-fill)" stroke="var(--blue-stroke)"/><rect x="162" y="48" width="48" height="22" rx="6" fill="var(--emerald-fill)" stroke="var(--emerald-stroke)"/><rect x="162" y="90" width="48" height="22" rx="6" fill="var(--amber-fill)" stroke="var(--amber-stroke)"/><path d="M56 75H72V59H88M72 75V101H88M138 59H162M138 101H162" fill="none" stroke="var(--ink2)"/></svg></div><div class="acts"><button class="btn sm icon" type="button" aria-label="Star Shop Architecture">${ico('star', 14)}</button></div><div class="body"><span class="name">Shop Architecture</span><span class="meta">Your space / 10 views</span><span class="when">2h ago</span></div></article>
<div class="doc-card" aria-hidden="true"><div class="thumb skeleton" style="border-radius:0"></div><div class="body"><div class="skeleton" style="height:10px;width:70%"></div><div class="skeleton" style="height:8px;width:45%"></div></div></div></div>
<div class="empty-state"><span class="shapes" aria-hidden="true"><i></i><i></i><i></i></span><div><div class="title">Nothing here yet.</div><p>Your first diagram is one file away.</p></div><button class="btn primary k-push" type="button">Start a diagram</button></div>`;

const PROGRESS = `<div class="f-row"><div class="k-split"><span>Rendering 9 views</span><span class="mono k-muted">6 of 9</span></div><div class="progress" role="progressbar" aria-valuenow="66" aria-valuemin="0" aria-valuemax="100" aria-label="Rendering"><i style="width:66%"></i></div></div>
<div class="f-row"><div class="k-split"><span>Layout score</span><span class="mono k-okt">96</span></div><div class="progress ok" role="progressbar" aria-valuenow="96" aria-valuemin="0" aria-valuemax="100" aria-label="Layout score"><i style="width:96%"></i></div></div>
<div class="k-line k-accent"><span class="spinner" aria-hidden="true"></span><span class="f-hint">Rendering; this page refreshes when the picture is ready</span></div>`;

const PALETTE = `<div class="menu k-palette" role="dialog" aria-label="Command palette"><label class="k-pal-in">${ico('search', 17)}<span class="sr-only">Command</span><input value="orders"><kbd>Esc</kbd></label>
<div class="k-pal-list"><div class="caps group">Boxes</div><a role="menuitem" href="#" class="k-hit"><span class="k-dotbox fam-blue"></span><span class="k-col"><span class="k-strong"><mark>Orders</mark> API</span><span class="f-hint">Shop Architecture / Application Tier</span></span><span class="k">Enter</span></a><a role="menuitem" href="#" class="k-hit"><span class="k-dotbox fam-emerald"></span><span class="k-col"><span class="k-strong"><mark>Orders</mark> DB</span><span class="f-hint">Shop Architecture / Data Tier</span></span></a>
<div class="caps group">Actions</div><a role="menuitem" href="#">${ico('import', 15)}Import a drawing<span class="k">Ctrl I</span></a><a role="menuitem" href="#">${ico('moon', 15)}Switch to dark theme<span class="k">Shift D</span></a></div></div>`;

const PAGE_CSS = `<style>
.k-page{max-width:1280px;margin:0 auto;padding:48px 40px 72px;display:flex;flex-direction:column;gap:28px}
.k-head{display:flex;align-items:flex-end;gap:24px;flex-wrap:wrap}
.k-head h1{margin:8px 0 8px;font:700 40px/44px var(--display);letter-spacing:-.02em}
.k-head p{margin:0;font:500 18px/26px var(--display);color:var(--ink2);max-width:620px}
.k-chips{margin-left:auto;display:flex;gap:8px}.k-chips span{width:28px;height:28px;border-radius:8px;border:1px solid var(--line2)}
.k-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(560px,100%),1fr));gap:20px}
.k-panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;display:flex;flex-direction:column;gap:16px;min-width:0}
.k-wide{grid-column:1/-1}
.k-ph{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.k-ph h2{margin:0;font-size:15px;font-weight:600;letter-spacing:var(--tight)}
.k-line{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.k-top{align-items:flex-start;gap:20px}
.k-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.k-set{border:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}.k-set legend{padding:0 0 8px}
.k-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--line)}
.k-col{display:flex;flex-direction:column;min-width:0}.k-gap{gap:14px}.k-grow{flex:1;min-width:220px}.k-push{margin-left:auto}.k-fill{flex:1}
.k-strong{font-size:13px;font-weight:500}.k-muted{color:var(--muted);font-size:12px;font-weight:600}.k-okt{color:var(--ok-ink);font-size:12px;font-weight:600}
.k-split{display:flex;justify-content:space-between;font-size:12.5px}.k-accent{color:var(--accent)}.k-ok{color:var(--emerald-stroke);display:flex}
.k-detail{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 10px;border-radius:8px;border:1px solid var(--line);background:var(--raise)}
.k-box{padding:8px;border-radius:10px;background:var(--panel);border:1px solid var(--line)}
.k-palette{max-width:640px;width:100%;margin:0 auto;padding:0;border-radius:14px;overflow:hidden}
.k-pal-in{display:flex;align-items:center;gap:10px;height:52px;padding:0 16px;border-bottom:1px solid var(--line);color:var(--muted)}
.k-pal-in input{flex:1;border:none;background:none;outline:none;font:400 15px var(--font);color:var(--ink)}
.k-pal-list{padding:8px}.k-pal-list .k-hit{height:44px}
.k-pal-list mark{background:var(--warn-bg);color:var(--warn-ink);border-radius:3px;padding:0 1px}
.k-dotbox{width:26px;height:26px;flex:none;border-radius:7px;background:var(--f-fill);border:1.25px solid var(--f-stroke)}
@media (max-width:700px){.k-page{padding:28px 16px 48px}.k-two{grid-template-columns:1fr}.k-head h1{font-size:30px;line-height:34px}}
</style>`;

/** Flips the demo controls so they can be tried; the CSP lets it run by nonce. */
const DEMO_SCRIPT = `document.querySelectorAll('[data-mixed]').forEach(function(c){c.indeterminate=true});
document.addEventListener('click',function(e){var t=e.target.closest('button');if(!t)return;
if(t.getAttribute('role')==='switch'){t.setAttribute('aria-checked',t.getAttribute('aria-checked')==='true'?'false':'true');return}
if(t.parentElement&&t.parentElement.classList.contains('seg')){t.parentElement.querySelectorAll('button').forEach(function(b){b.setAttribute('aria-pressed',b===t?'true':'false')});return}
if(t.classList.contains('chip')){t.setAttribute('aria-pressed',t.getAttribute('aria-pressed')==='true'?'false':'true');return}
if(t.getAttribute('role')==='tab'){t.parentElement.querySelectorAll('[role=tab]').forEach(function(b){b.setAttribute('aria-selected',b===t?'true':'false')});return}
if(t.parentElement&&t.parentElement.classList.contains('steps')){var bs=Array.prototype.slice.call(t.parentElement.children),i=bs.indexOf(t);bs.forEach(function(b,j){b.classList.toggle('on',j<=i)})}});`;

export function kitHtml(nonce: string): string {
  const body = `${PAGE_CSS}<main class="k-page">
<header class="k-head"><div><span class="caps">Vantage interface kit</span><h1>The parts every screen is built from</h1><p>Calm paper, a friendly pen, one bright blue for the thing that matters right now.</p></div>
<div class="k-chips" aria-hidden="true">${MARK}<span style="background:var(--bg)"></span><span style="background:var(--panel)"></span><span style="background:var(--ink)"></span><span style="background:var(--accent)"></span><span style="background:var(--accent-soft)"></span></div></header>
<div class="k-grid">
${panel('btn', 'Buttons', 'One primary per surface', BUTTONS)}
${panel('in', 'Fields', 'Sunken at rest, raised on focus', FIELDS)}
${panel('ch', 'Choices', 'These ones work', CHOICES)}
${panel('st', 'Status and identity', 'Always a word with the color', STATUS)}
${panel('nav', 'Navigation', '', NAV)}
${panel('menu', 'Menus and overlays', '', OVERLAYS)}
${panel('pal', 'Command palette', 'Ctrl K from anywhere: jump, act, or search inside every diagram', PALETTE, true)}
${panel('card', 'Cards and empty states', '', CARDS)}
${panel('prog', 'Progress', '', PROGRESS)}
</div></main>`;
  return page('Interface kit', body, nonce, DEMO_SCRIPT);
}

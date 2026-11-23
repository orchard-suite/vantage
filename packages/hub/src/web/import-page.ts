/**
 * The import page at /w/:workspace/import: drop or choose a draw.io,
 * Visio (or Lucidchart's VSDX export) or Ilograph file, read the import
 * report, then import. The page posts the bytes to the drawings API twice:
 * once to preview, once to save, so nothing is kept until the reader says.
 */
import type { AccessibleWorkspace } from '../authz.ts';
import type { AgentSetup } from '../agents.ts';
import type { HomeDocument } from './home-data.ts';
import { escapeHtml } from './html.ts';
import { appPage } from './frame.ts';
import { frameWorkspaces, type HomeUser } from './home.ts';
import { ico } from './icons.ts';
import { spaceName } from './library.ts';

export interface ImportPageModel {
  readonly nonce: string;
  readonly csrf?: string;
  readonly user: HomeUser;
  readonly workspace: AccessibleWorkspace;
  readonly workspaces: readonly AccessibleWorkspace[];
  readonly documents: readonly HomeDocument[];
  readonly agents: AgentSetup;
}

const FORMATS: readonly [string, string, string, string][] = [
  ['.drawio', 'draw.io', 'Pages, containers, styles', 'amber'],
  ['.vsdx', 'Visio', 'Also Lucidchart exports', 'blue'],
  ['.yaml', 'Ilograph', 'Resources and perspectives', 'pink'],
  ['.mmd', 'Mermaid', 'Also blocks in Markdown', 'emerald'],
  ['.puml', 'PlantUML', 'Components and sequences', 'teal'],
];

/** Builds the report with textContent only: names in a drawing are someone else's words. */
const SCRIPT = `(function(){
var api=document.getElementById('imp').getAttribute('data-api'),csrf=document.querySelector('meta[name=csrf]');
var input=document.getElementById('imp-file'),drop=document.getElementById('imp-drop'),out=document.getElementById('imp-report'),err=document.getElementById('imp-error'),go=document.getElementById('imp-go'),again=document.getElementById('imp-again'),steps=document.querySelectorAll('.imp-steps li');
var file=null,layout='keep',over={};
var TYPES=['service','api','web','mobile','database','cache','storage','search','queue','topic','function','worker','job','gateway','loadbalancer','cdn','dns','firewall','tunnel','identity','secret','monitoring','pipeline','repo','registry','model','vm','external','users','actor','cloud','network','subnet','cluster','resourcegroup','subscription','file'];
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function step(i){steps.forEach(function(s,j){s.setAttribute('data-state',j<i?'done':j===i?'now':'todo');if(j===i)s.setAttribute('aria-current','step');else s.removeAttribute('aria-current')})}
function fail(m){err.replaceChildren();var b=el('div','banner bad');b.append(el('span',null,m));err.append(b);go.disabled=true}
function send(preview){var h={'content-type':'application/octet-stream'};if(csrf)h['x-csrf-token']=csrf.content;var q='?filename='+encodeURIComponent(file.name)+(preview?'&preview=true':'&layout='+layout+(Object.keys(over).length?'&types='+encodeURIComponent(JSON.stringify(over)):''));return fetch(api+q,{method:'POST',headers:h,body:file,credentials:'same-origin'}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'That did not work.');return j})})}
function stat(n,l){var d=el('div','imp-stat');d.append(el('b',null,String(n)),el('span',null,l));return d}
function render(r){out.replaceChildren();var head=el('div','imp-file');head.append(el('b','mono',r.filename),el('span',null,({vsdx:'Visio or Lucidchart',drawio:'draw.io',ilograph:'Ilograph',mermaid:'Mermaid',plantuml:'PlantUML',markdown:'Markdown'}[r.format]||r.format)+', '+r.pages.length+(r.pages.length===1?' page':' pages')));out.append(head);
var s=el('div','imp-stats');s.append(stat(r.counts.nodes,'boxes'),stat(r.counts.relations,'arrows'),stat(r.counts.containers,'containers'),stat(r.pages.length,r.pages.length===1?'view':'views'));out.append(s);
var pv=el('div','imp-sec');pv.append(el('div','caps','Pages become views'));var ul=el('ul','imp-pages');r.pages.forEach(function(p){var li=el('li');li.append(el('span','mono',p.name),el('span','imp-arrow','to'),el('b',null,p.view));ul.append(li)});pv.append(ul);out.append(pv);
var notes=[].concat(r.errors.map(function(m){return['bad',m]}),r.warnings.slice(0,6).map(function(m){return['warn',m]}));if(r.counts.dropped)notes.push(['warn',r.counts.dropped+(r.counts.dropped===1?' shape was left out: it had':' shapes were left out: they had')+' no text, or nothing to attach to.']);if(r.pictures&&r.pictures.missed&&r.pictures.missed.length)notes.push(['warn',r.pictures.missed.length===1?'1 icon had no match and is drawn as a plain box.':r.pictures.missed.length+' icons had no match and are drawn as plain boxes.']);
notes.forEach(function(n){var b=el('div','banner '+n[0]);b.append(el('span',null,n[1]));out.append(b)});
if(r.format==='drawio'||r.format==='vsdx'){var ls=el('div','imp-sec');ls.append(el('div','caps','Layout'));var lo=el('div','imp-layout');lo.setAttribute('role','radiogroup');lo.setAttribute('aria-label','Layout');[['keep','Keep where things are','Boxes stay pinned to the original drawing. Good for a first look.'],['auto','Let Vantage lay it out','Flow by meaning, labels get their own room, arrows route around boxes.']].forEach(function(o){var lab=el('label','imp-opt');var i=el('input');i.type='radio';i.name='imp-layout';i.value=o[0];i.checked=layout===o[0];i.addEventListener('change',function(){layout=o[0]});var t=el('span');t.append(el('b',null,o[1]),el('span',null,o[2]));lab.append(i,t);lo.append(lab)});ls.append(lo);out.append(ls)}
if(r.typed&&r.typed.length){var ts=el('div','imp-sec');var th=el('div','imp-sec-head');th.append(el('span','caps','Types we guessed'),el('span','f-hint','Change any that look wrong'));ts.append(th);var ul2=el('ul','imp-types');r.typed.slice(0,40).forEach(function(g){var li=el('li');li.append(el('span','nm',g.name));var sel=el('select','field');sel.setAttribute('aria-label','Type of '+g.name);var none=el('option',null,'No type');none.value='';sel.append(none);TYPES.concat(TYPES.indexOf(g.type)<0?[g.type]:[]).forEach(function(t){var o=el('option',null,t);o.value=t;if(t===g.type)o.selected=true;sel.append(o)});sel.addEventListener('change',function(){if(sel.value===g.type)delete over[g.id];else over[g.id]=sel.value});li.append(sel);ul2.append(li)});ts.append(ul2);if(r.typed.length>40)ts.append(el('p','f-hint','And '+(r.typed.length-40)+' more, each set from its label.'));out.append(ts)}
go.textContent=r.errors.length?'Import anyway':'Import '+r.pages.length+(r.pages.length===1?' view':' views');go.disabled=false}
function pick(f){if(!f)return;file=f;over={};layout='keep';err.replaceChildren();out.replaceChildren(el('p','f-hint','Reading '+f.name));drop.hidden=true;again.hidden=false;step(1);go.disabled=true;send(true).then(function(j){render(j.report)}).catch(function(e){out.replaceChildren();fail(e.message)})}
input.addEventListener('change',function(){pick(input.files&&input.files[0])});
['dragenter','dragover'].forEach(function(t){drop.addEventListener(t,function(e){e.preventDefault();drop.classList.add('over')})});
['dragleave','drop'].forEach(function(t){drop.addEventListener(t,function(e){e.preventDefault();drop.classList.remove('over')})});
drop.addEventListener('drop',function(e){pick(e.dataTransfer&&e.dataTransfer.files[0])});
again.addEventListener('click',function(){file=null;input.value='';out.replaceChildren();err.replaceChildren();drop.hidden=false;again.hidden=true;go.disabled=true;go.textContent='Import';step(0)});
go.addEventListener('click',function(){if(!file)return;go.disabled=true;go.textContent='Importing';send(false).then(function(j){step(2);location.href=j.url}).catch(function(e){fail(e.message);go.textContent='Import'})});
step(0)})();`;

export function importHtml(m: ImportPageModel): string {
  const ws = m.workspace;
  const name = spaceName(ws, m.user.id);
  const api = `/api/v1/workspaces/${encodeURIComponent(ws.slug)}/drawings`;
  const formats = FORMATS.map(([ext, label, note, fam]) => `<div class="imp-fmt"><span class="imp-ext fam-${fam}">${ext}</span><span><b>${label}</b><span>${note}</span></span></div>`).join('');
  const body = `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${ico('right', 12)}<a href="/w/${encodeURIComponent(ws.slug)}">${escapeHtml(name)}</a>${ico('right', 12)}<span aria-current="page">Import</span></nav>
<section class="imp dialog" id="imp" data-api="${escapeHtml(api)}" aria-labelledby="imp-title">
<header><div class="imp-words"><h1 id="imp-title">Import a drawing</h1><p>Bring a drawing in from another tool. Its boxes and arrows come with it, and each page becomes a view in ${escapeHtml(name)}.</p></div></header>
<ol class="imp-steps" aria-label="Steps"><li><i>1</i>Choose a file</li><li><i>2</i>Review</li><li><i>3</i>Done</li></ol>
<div class="imp-body">
<label class="imp-drop" id="imp-drop"><input type="file" id="imp-file" class="sr-only" accept=".drawio,.xml,.vsdx,.yaml,.yml,.ilograph,.mmd,.mermaid,.puml,.plantuml,.pu,.iuml,.md"><span class="shapes" aria-hidden="true"><i></i><i></i><i></i></span><b>Drop a file here, or <u>choose one</u></b><span class="f-hint">Up to 25 MB. Nothing is saved until you import.</span></label>
<div class="imp-formats" aria-label="What we can read">${formats}</div>
<div id="imp-report" class="imp-report" aria-live="polite"></div>
<div id="imp-error" role="alert"></div>
</div>
<footer><span class="f-hint">Anything can change later, in the YAML or by steering the layout.</span><button class="btn ghost" type="button" id="imp-again" hidden>Choose another</button><a class="btn" href="/w/${encodeURIComponent(ws.slug)}">Cancel</a><button class="btn primary" type="button" id="imp-go" disabled>Import</button></footer>
</section>`;
  const { spaces, shared, starred } = frameWorkspaces(m.workspaces, m.documents, m.user.id);
  return appPage({ title: `Import into ${name}`, nonce: m.nonce, ...(m.csrf ? { csrf: m.csrf } : {}), user: m.user, workspaces: spaces, sharedCount: shared, starredCount: starred, place: { kind: 'workspace', slug: ws.slug }, agents: m.agents, body }, SCRIPT);
}

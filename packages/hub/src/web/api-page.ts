/**
 * The API page at /api: every route of the REST API, grouped and readable,
 * built from the same registry that writes /api/v1/openapi.json. It reads
 * like a reference, not a console: nothing on it sends a request. The raw
 * document's address sits at the top, ready to copy for an agent.
 */
import type { AccessibleWorkspace } from '../authz.ts';
import type { AgentSetup } from '../agents.ts';
import type { RouteDoc } from '../api/openapi.ts';
import type { HomeDocument } from './home-data.ts';
import { escapeHtml } from './html.ts';
import { appPage } from './frame.ts';
import { frameWorkspaces, type HomeUser } from './home.ts';
import { ico } from './icons.ts';

export interface ApiPageModel {
  readonly nonce: string;
  readonly csrf?: string;
  readonly user: HomeUser;
  readonly workspaces: readonly AccessibleWorkspace[];
  readonly documents: readonly HomeDocument[];
  readonly agents: AgentSetup;
  /** The hub's public address; the base URL and the document's address hang off it. */
  readonly publicUrl: string;
  readonly version: string;
  readonly routes: readonly RouteDoc[];
}

type Role = NonNullable<RouteDoc['auth']>;

/** What each role means to a reader, and the family its pill wears. */
const ROLES: Record<Role, { readonly label: string; readonly hint: string; readonly fam: string }> = {
  none: { label: 'Open', hint: 'No sign in needed', fam: 'slate' },
  user: { label: 'Signed in', hint: 'Anyone signed in to this hub', fam: 'slate' },
  viewer: { label: 'Viewer', hint: 'Can see the workspace', fam: 'blue' },
  author: { label: 'Author', hint: 'Can change the workspace', fam: 'emerald' },
  admin: { label: 'Admin', hint: 'Runs this hub', fam: 'amber' },
  source: { label: 'Connector', hint: "A connector's own client credentials", fam: 'violet' },
  pool: { label: 'Connector pool', hint: "The shared runner pool's own app, with the pool role", fam: 'violet' },
};

const METHODS: Record<RouteDoc['method'], string> = { get: 'blue', post: 'emerald', put: 'amber', patch: 'violet', delete: 'red' };

/** Groups in reading order: the everyday work first, running the hub last. Tags not listed follow, by name. */
const GROUPS: readonly (readonly [tag: string, title: string, blurb: string])[] = [
  ['auth', 'You', 'Who the caller is and what they may do.'],
  ['workspaces', 'Workspaces', 'The spaces diagrams live in, who may use them, and what they report.'],
  ['documents', 'Diagrams', 'Create, read, save, and delete diagrams, and preview YAML without saving it.'],
  ['versions', 'Versions', 'Every save is a version: history, diffs, and restoring an older one.'],
  ['artifacts', 'Pictures', 'The SVG, PNG, and HTML drawn from each version.'],
  ['export', 'Export', 'Download a diagram as a picture, a PDF, or a file another tool opens.'],
  ['steer', 'Steering', 'Nudge the layout of a view, the way the viewer does.'],
  ['comments', 'Comments', 'Talk about a view or a box, mention the people who should see it, and resolve it when done.'],
  ['reactions', 'Reactions', 'Thumbs up, looks wrong, and questions on boxes, for review sessions.'],
  ['recordings', 'Voice walkthroughs', 'Audio an author recorded over a walkthrough or a path, with the moment each step was shown.'],
  ['guest-links', 'Sharing', 'Links that let someone without an account see a diagram.'],
  ['library', 'Library', 'Folders and stars that keep a workspace tidy.'],
  ['search', 'Search', 'Find diagrams by what is written in them.'],
  ['icons', 'Icons', 'Pictures a workspace adds for its own boxes.'],
  ['transfer', 'Import and export', 'Bring drawings in from other tools, or take a whole workspace out.'],
  ['connectors', 'Connectors', 'Sources of truth that keep diagrams in step with what really runs.'],
  ['mappings', 'Mappings', 'How what a connector sees turns into boxes on a diagram.'],
  ['push', 'Connector push', 'What a connector calls to send what it observed.'],
  ['pool', 'Connector pool', 'What the shared runner pool calls to lease the connector runs the hub queued.'],
  ['drift', 'Drift', 'Where a diagram and its sources disagree.'],
  ['publications', 'Publications', 'Send diagrams on to the places people already read, every time they change.'],
  ['secrets', 'Secrets', 'Credentials connectors and publications use, kept by name.'],
  ['tokens', 'Tokens', 'Personal and automation tokens for calling this API.'],
  ['audit', 'Audit', 'Who changed what, and when.'],
  ['admin', 'Admin', 'Users, teams, approvals, and retention for the whole hub.'],
  ['meta', 'About the API', 'The machine readable description of everything on this page.'],
];

interface Group {
  readonly tag: string;
  readonly title: string;
  readonly blurb: string;
  readonly routes: readonly RouteDoc[];
}

/** The routes by group, in reading order; inside a group, by path and then method. */
export function apiGroups(routes: readonly RouteDoc[]): Group[] {
  const known = new Map(GROUPS.map(([tag, title, blurb], i) => [tag, { title, blurb, i }]));
  const order = Object.keys(METHODS);
  const byTag = new Map<string, RouteDoc[]>();
  for (const r of routes) byTag.set(r.tag, [...(byTag.get(r.tag) ?? []), r]);
  return [...byTag.entries()]
    .map(([tag, rs]) => {
      const k = known.get(tag);
      return {
        tag,
        title: k?.title ?? tag.charAt(0).toUpperCase() + tag.slice(1).replace(/-/g, ' '),
        blurb: k?.blurb ?? '',
        rank: k?.i ?? GROUPS.length,
        routes: [...rs].sort((a, b) => a.path.localeCompare(b.path) || order.indexOf(a.method) - order.indexOf(b.method)),
      };
    })
    .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title))
    .map(({ rank: _rank, ...g }) => g);
}

/** A path with its parameters picked out: /workspaces/:workspace reads /workspaces/{workspace}. */
function pathHtml(path: string): string {
  return path
    .split('/')
    .map((seg) => (seg.startsWith(':') ? `<span class="api-var">{${escapeHtml(seg.slice(1))}}</span>` : escapeHtml(seg)))
    .join('/<wbr>');
}

function anchor(r: RouteDoc): string {
  return `${r.method}-${r.path.replace(/[:/]+/g, '-').replace(/^-|-$/g, '')}`;
}

function fields(title: string, rows: readonly (readonly [string, string])[]): string {
  if (!rows.length) return '';
  return `<div class="api-fields"><span class="caps">${title}</span><dl>${rows.map(([k, v]) => `<dt><code>${escapeHtml(k)}</code></dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl></div>`;
}

function opHtml(r: RouteDoc): string {
  const role = ROLES[r.auth ?? 'user'];
  const responses = Object.entries(r.responses ?? { '200': 'ok' });
  const words = [r.method, r.path, r.summary, role.label, ...(r.params ?? []), ...(r.query ?? []), ...Object.keys(r.body ?? {})].join(' ').toLowerCase();
  const detail = [
    fields('Path', (r.params ?? []).map((p) => [p, 'Required'] as const)),
    fields('Query', (r.query ?? []).map((q) => [q, 'Optional'] as const)),
    fields('Body (JSON)', Object.entries(r.body ?? {})),
    fields('Answers', responses),
  ].join('');
  return `<details class="api-op" id="${escapeHtml(anchor(r))}" data-words="${escapeHtml(words)}"><summary><span class="api-m fam-${METHODS[r.method]}">${r.method.toUpperCase()}</span><code class="api-path">${pathHtml(r.path)}</code><span class="pill api-role fam-${role.fam}" title="${escapeHtml(role.hint)}">${role.label}</span><span class="api-sum">${escapeHtml(r.summary)}</span>${ico('chevron', 14)}</summary><div class="api-detail">${detail}<p class="f-hint">${escapeHtml(role.hint)}.</p></div></details>`;
}

function copyRow(label: string, value: string, extra = ''): string {
  return `<div class="api-url"><span class="caps">${label}</span><div class="url"><code title="${escapeHtml(value)}">${escapeHtml(value)}</code><button class="btn ghost sm icon" type="button" data-copy="${escapeHtml(value)}" aria-label="Copy the ${label.toLowerCase()}">${ico('copy', 14)}</button>${extra}</div></div>`;
}

/** Narrows the list as the reader types: by method, path, words, or role. Empty groups fold away. */
const SCRIPT = `(function(){var q=document.getElementById('api-q'),none=document.getElementById('api-none');if(!q)return;
function run(){var t=q.value.trim().toLowerCase().split(/\\s+/).filter(Boolean),any=false;
document.querySelectorAll('.api-group').forEach(function(g){var n=0;g.querySelectorAll('.api-op').forEach(function(o){var w=o.getAttribute('data-words'),hit=t.every(function(x){return w.indexOf(x)>=0});o.hidden=!hit;if(hit)n++});g.hidden=!n;if(n)any=true;var l=document.querySelector('.api-toc a[href="#'+g.id+'"]');if(l){l.hidden=!n;l.querySelector('.n').textContent=n}});none.hidden=any}
q.addEventListener('input',run);
function open(){var h=location.hash.slice(1),el=h&&document.getElementById(h);if(el&&el.tagName==='DETAILS')el.open=true}window.addEventListener('hashchange',open);open()})();`;

export function apiHtml(m: ApiPageModel): string {
  const base = `${m.publicUrl}/api/v1`;
  const doc = `${base}/openapi.json`;
  const groups = apiGroups(m.routes);
  const toc = groups.map((g) => `<a href="#api-${escapeHtml(g.tag)}"><span class="label">${escapeHtml(g.title)}</span><span class="n">${g.routes.length}</span></a>`).join('');
  const sections = groups
    .map((g) => `<section class="api-group" id="api-${escapeHtml(g.tag)}" aria-labelledby="api-${escapeHtml(g.tag)}-h"><header><h2 id="api-${escapeHtml(g.tag)}-h">${escapeHtml(g.title)}</h2>${g.blurb ? `<p>${escapeHtml(g.blurb)}</p>` : ''}</header><div class="api-ops">${g.routes.map(opHtml).join('')}</div></section>`)
    .join('');
  const body = `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${ico('right', 12)}<span aria-current="page">API</span></nav>
<header class="api-head"><div class="api-words"><h1>The Vantage API</h1><p>Everything you can do in the hub, a script or an agent can do over HTTP. This page lists every endpoint in plain words. It only describes them; nothing here sends a request.</p><span class="api-ver mono">API version ${escapeHtml(m.version)} · ${m.routes.length} endpoints</span></div>
<div class="api-links">${copyRow('Base URL', base)}${copyRow('OpenAPI document', doc, `<a class="btn sm" href="/api/v1/openapi.json" target="_blank" rel="noopener">${ico('code', 14)}Raw JSON</a>`)}</div></header>
<div class="api-facts">
<div><b>${ico('users')}Signing in</b><p>Send a token as <code>Authorization: Bearer &lt;token&gt;</code>. Make one with <a href="#post-tokens">POST /tokens</a>. In the browser, your session works too.</p></div>
<div><b>${ico('layers')}Roles</b><p>Each endpoint says who may call it. A viewer can see a workspace. An author can change it. An admin runs the hub.</p></div>
<div><b>${ico('code')}For an agent</b><p>Hand your agent the OpenAPI document above. It holds this whole page in a form a program reads.</p></div>
</div>
<div class="api-body"><nav class="api-toc" aria-label="Groups"><label class="well">${ico('search')}<span class="sr-only">Filter endpoints</span><input id="api-q" type="search" placeholder="Filter endpoints" autocomplete="off"></label><div class="nav">${toc}</div></nav>
<div class="api-groups">${sections}<p class="none-here" id="api-none" hidden><b>No endpoint matches.</b> Try fewer words.</p></div></div>`;
  const { spaces, shared, starred } = frameWorkspaces(m.workspaces, m.documents, m.user.id);
  return appPage({ title: 'API', nonce: m.nonce, ...(m.csrf ? { csrf: m.csrf } : {}), user: m.user, workspaces: spaces, sharedCount: shared, starredCount: starred, place: { kind: 'other' }, agents: m.agents, body }, SCRIPT);
}

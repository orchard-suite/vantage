/**
 * The home page: every diagram the reader may open, as picture cards or a
 * list, or only what others shared, sorted by change or name, and search
 * over all of it; and the comments that mention the reader. A first run shows how to get the first diagram in. One
 * workspace on its own is the workspace page (workspace.ts).
 */
import type { ReaderTheme } from '../theme.ts';
import type { AgentSetup } from '../agents.ts';
import type { AccessibleWorkspace } from '../authz.ts';
import type { HomeDocument } from './home-data.ts';
import { escapeHtml, snippetHtml } from './html.ts';
import { appPage, type FramePlace, type FrameWorkspace } from './frame.ts';
import { ico } from './icons.ts';
import { starters } from './starters.ts';
import { mentionsSection } from './mentions-page.ts';
import type { MentionItem } from '../mentions.ts';
import { LIBRARY_SCRIPT, isMine, libraryItems, libraryTools, plural, spaceName, type Layout, type LibraryOptions, type Sort } from './library.ts';

export interface ShellResult {
  readonly workspaceSlug: string;
  readonly documentSlug: string;
  /** Where the hit opens when it is not a diagram, such as a decision record. */
  readonly href?: string;
  readonly name: string;
  readonly headline: string;
}

export interface HomeUser {
  readonly id: string;
  readonly name: string;
  /** Shown under their name in the sidebar's menu. */
  readonly email?: string;
  readonly signOut: boolean;
  readonly admin?: boolean;
  /** May make team workspaces: the sidebar offers the form. */
  readonly makesWorkspaces?: boolean;
  /** The look they picked; every page they open wears it. */
  readonly theme?: ReaderTheme;
}

export interface HomeModel {
  readonly nonce: string;
  readonly csrf?: string;
  readonly user: HomeUser;
  readonly workspaces: readonly AccessibleWorkspace[];
  readonly documents: readonly HomeDocument[];
  readonly place: FramePlace;
  readonly sort: Sort;
  readonly layout: Layout;
  readonly agents: AgentSetup;
  readonly query?: string;
  readonly results?: readonly ShellResult[];
  readonly now?: number;
  /** On the Mentions page: the comments that name the reader. */
  readonly mentions?: readonly MentionItem[];
  /** Narrow the library to one workspace (its slug) or one last author (their name). */
  readonly filter?: { readonly in?: string; readonly by?: string };
}

/** The sidebar's workspaces with their diagram counts, your own space first; and how many diagrams others shared. */
export function frameWorkspaces(workspaces: readonly AccessibleWorkspace[], documents: readonly HomeDocument[], userId: string): { spaces: FrameWorkspace[]; shared: number; starred: number } {
  const byId = new Map(workspaces.map((w) => [w.id, w]));
  const counts = new Map<string, number>();
  let shared = 0;
  let starred = 0;
  for (const d of documents) {
    const w = byId.get(d.workspaceId);
    if (!w) continue;
    if (d.starred) starred++;
    counts.set(w.id, (counts.get(w.id) ?? 0) + 1);
    if (!isMine(w, userId)) shared++;
  }
  const spaces = [...workspaces]
    .sort((a, b) => Number(isMine(b, userId)) - Number(isMine(a, userId)) || a.name.localeCompare(b.name))
    .map((w) => ({ slug: w.slug, name: spaceName(w, userId), count: counts.get(w.id) ?? 0 }));
  return { spaces, shared, starred };
}

function greeting(m: HomeModel, docs: readonly HomeDocument[], now: number): string {
  const first = m.user.name.includes(' ') ? m.user.name.split(' ')[0]! : '';
  const recent = docs.filter((d) => now - d.updatedAt.getTime() < 86_400_000).length;
  const spaces = new Set(docs.map((d) => d.workspaceId)).size;
  const line = `${plural(docs.length, 'diagram')} in ${plural(spaces, 'workspace')}${recent ? `. ${recent} changed in the last day.` : '.'}`;
  return `<section class="hello"><h1>${first ? `Welcome back, ${escapeHtml(first)}` : 'Welcome back'}</h1><p>${line}</p></section>`;
}

/** The ways a diagram gets in, for a reader with a space they can write to. */
function starts(own: AccessibleWorkspace): string {
  const ws = encodeURIComponent(own.slug);
  const tile = (href: string, art: string, title: string, note: string): string => `<a class="tile" href="${href}"><div class="art${art.startsWith('<span class="ln"') ? ' code' : ''}" aria-hidden="true">${art}</div><div class="words"><b>${title}</b><span>${note}</span></div></a>`;
  return `<section class="starts" aria-labelledby="starts"><div class="lib-head"><h2 id="starts">Start something</h2></div><div class="starts-grid">
${tile(`/new?in=${ws}`, `<span class="dash">${ico('plus', 16)}</span>`, 'Blank diagram', 'Start a file and write a few boxes')}
${tile(`/new?in=${ws}`, '<span class="ln"><span class="k">nodes</span>:</span><span class="ln">&#160;&#160;- name: <span class="v">Coffee shop app</span></span><span class="ln">&#160;&#160;&#160;&#160;type: <span class="t">web</span><span class="caret"></span></span>', 'Write YAML', 'Type what exists, Vantage lays it out')}
${tile(`/import/${ws}`, '<span class="ext fam-amber">.drawio</span><span class="ext fam-blue">.vsdx</span><span class="ext fam-pink">.yaml</span>', 'Import a drawing', 'draw.io, Visio, Lucidchart, Mermaid, PlantUML')}
${tile(`/w/${ws}?tab=sources`, `<span class="node fam-blue">ARG</span><span class="wire"></span><span class="node fam-emerald">K8s</span>`, 'From a live source', 'Azure, Kubernetes, Backstage')}
${tile('#examples', '<span class="s fam-red" style="left:18px;top:16px;width:44px;height:30px"></span><span class="s fam-amber" style="left:74px;top:40px;width:44px;height:30px"></span><span class="s fam-blue" style="left:130px;top:18px;width:22px;height:22px;border-radius:var(--r-pill)"></span>', 'Try an example', 'A small shop, a cloud migration')}
</div></section>`;
}

/** The examples as cards with their first view; choosing one opens it in the new diagram page. */
function examples(own: AccessibleWorkspace): string {
  const list = starters().filter((s) => s.id !== 'blank');
  if (!list.length) return '';
  const cards = list.map((s) => `<li><a class="tile ex-card" href="/new?in=${encodeURIComponent(own.slug)}&amp;from=${encodeURIComponent(s.id)}"><div class="art"><img src="/starters/${encodeURIComponent(s.id)}.svg" alt="" loading="lazy" decoding="async"></div><div class="words"><b>${escapeHtml(s.title)}</b><span>${escapeHtml(s.blurb)}</span><span class="views">${plural(s.views, 'view')}</span></div></a></li>`).join('');
  return `<section class="examples" id="examples" aria-labelledby="ex"><div class="lib-head"><h2 id="ex">Start from an example</h2><span>Each one is a real file you can copy and change</span></div><ul class="ex-grid">${cards}</ul></section>`;
}

/** Workspace and owner pickers that narrow the library; plain GET, sent on change. */
function filters(m: HomeModel, docs: readonly HomeDocument[], byId: ReadonlyMap<string, AccessibleWorkspace>): string {
  const f = m.filter ?? {};
  const spaces = [...new Set(docs.map((d) => d.workspaceId))].map((id) => byId.get(id)!).sort((a, b) => spaceName(a, m.user.id).localeCompare(spaceName(b, m.user.id)));
  const owners = [...new Set(docs.map((d) => d.author).filter((a): a is string => Boolean(a)))].sort((a, b) => a.localeCompare(b));
  if (spaces.length < 2 && owners.length < 2) return '';
  const opt = (v: string, label: string, on: boolean): string => `<option value="${escapeHtml(v)}"${on ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const keep = [m.sort !== 'recent' ? `<input type="hidden" name="sort" value="${m.sort}">` : '', m.layout !== 'grid' ? `<input type="hidden" name="layout" value="${m.layout}">` : ''].join('');
  const ws = spaces.length > 1 ? `<select class="field${f.in ? ' on' : ''}" name="in" aria-label="Workspace">${opt('', 'Any workspace', !f.in)}${spaces.map((w) => opt(w.slug, spaceName(w, m.user.id), f.in === w.slug)).join('')}</select>` : '';
  const by = owners.length > 1 ? `<select class="field${f.by ? ' on' : ''}" name="by" aria-label="Last changed by">${opt('', 'Anyone', !f.by)}${owners.map((o) => opt(o, o, f.by === o)).join('')}</select>` : '';
  return `<form class="filters" method="get" action="/" data-auto>${keep}${ws}${by}<noscript><button class="btn sm">Apply</button></noscript></form>`;
}

const FILTER_SCRIPT = `document.addEventListener('change',function(e){var f=e.target.closest&&e.target.closest('form[data-auto]');if(!f)return;[].forEach.call(f.querySelectorAll('select'),function(s){if(!s.value)s.disabled=true});f.submit()});`;

function firstRun(m: HomeModel, own: AccessibleWorkspace | undefined): string {
  return `<section class="first plus" aria-labelledby="first"><div class="copy"><h1 id="first">Nothing here yet.</h1><p>Your first diagram is one file away. Write a few lines, drop in a drawing, or let an agent do it.</p>
<span class="f-hint">Or let an agent draw it:</span><ol>${m.agents.ways.length ? `<li>Pick your assistant under Let an agent draw it, in the sidebar, and set it up once.</li>` : `<li>Copy this hub's MCP address from the sidebar.</li><li>Add it to your agent.</li>`}<li>Ask it to draw your system. The picture shows up here.</li></ol>
<div class="acts">${own ? `<a class="btn primary lg" href="/new?in=${encodeURIComponent(own.slug)}">${ico('plus')}Start a diagram</a><a class="btn lg" href="/import/${encodeURIComponent(own.slug)}">${ico('import')}Import a drawing</a>` : ''}${m.agents.ways.length ? '' : `<button class="btn${own ? '' : ' primary'} lg" type="button" data-copy="${escapeHtml(m.agents.mcpUrl)}" aria-label="Copy the MCP address">${ico('copy')}Copy the MCP address</button>`}<a class="btn lg" href="/api">Use the API</a></div></div>
<div class="art" aria-hidden="true"><i></i><i></i><i></i></div></section>`;
}

function search(m: HomeModel): string {
  const r = m.results ?? [];
  const head = `<div class="lib-head"><h2 id="results">${r.length ? plural(r.length, 'result') : 'No results'} for “${escapeHtml(m.query ?? '')}”</h2><div class="tools"><a class="link" href="/">Clear search</a></div></div>`;
  const list = r.length
    ? `<ul class="results">${r.map((x) => `<li><a href="${escapeHtml(x.href ?? `/w/${encodeURIComponent(x.workspaceSlug)}/${encodeURIComponent(x.documentSlug)}`)}"><span class="name">${escapeHtml(x.name)}</span><span class="where">${escapeHtml(x.workspaceSlug)}</span><span class="snip">${snippetHtml(x.headline)}</span></a></li>`).join('')}</ul>`
    : '<p class="none-here">Nothing matched. Search looks at names, subtitles, facts, questions, view titles, and decision records.</p>';
  return `<section class="lib" aria-labelledby="results">${head}${list}</section>`;
}

export function homeHtml(m: HomeModel): string {
  const now = m.now ?? Date.now();
  const byId = new Map(m.workspaces.map((w) => [w.id, w]));
  const all = m.documents.filter((d) => byId.has(d.workspaceId));
  const sharedOnly = m.place.kind === 'shared';
  const starredOnly = m.place.kind === 'starred';
  const narrowList = sharedOnly || starredOnly;
  const { spaces, shared, starred } = frameWorkspaces(m.workspaces, all, m.user.id);
  const writable = m.workspaces.filter((w) => w.role === 'author');
  const own = writable.find((w) => isMine(w, m.user.id)) ?? writable[0];
  const f = m.filter ?? {};

  let body: string;
  let title = 'Vantage';
  if (m.query !== undefined) {
    body = search(m);
    title = `Search: ${m.query}`;
  } else if (m.place.kind === 'mentions') {
    body = mentionsSection(m.mentions ?? [], now);
    title = 'Mentions';
  } else if (!all.length) {
    body = `${firstRun(m, own)}${own ? examples(own) : ''}`;
  } else {
    const href = (change: Partial<{ sort: Sort; layout: Layout }>): string => {
      const p = new URLSearchParams();
      if (narrowList) p.set('show', m.place.kind);
      const sort = change.sort ?? m.sort;
      const layout = change.layout ?? m.layout;
      if (sort !== 'recent') p.set('sort', sort);
      if (layout !== 'grid') p.set('layout', layout);
      if (!narrowList && f.in) p.set('in', f.in);
      if (!narrowList && f.by) p.set('by', f.by);
      const q = p.toString();
      return q ? `/?${q}` : '/';
    };
    const base = sharedOnly ? all.filter((d) => !isMine(byId.get(d.workspaceId)!, m.user.id)) : starredOnly ? all.filter((d) => d.starred) : all;
    const narrowed = narrowList ? base : base.filter((d) => (!f.in || byId.get(d.workspaceId)!.slug === f.in) && (!f.by || d.author === f.by));
    const lib: LibraryOptions = {
      documents: narrowed,
      workspaces: byId,
      userId: m.user.id,
      admin: m.user.admin ?? false,
      sort: m.sort,
      layout: m.layout,
      href,
      empty: sharedOnly ? '<b>Nothing shared with you yet.</b> Diagrams in team workspaces you can open show up here.' : starredOnly ? '<b>No stars yet.</b> Star a diagram from its card and it stays here, one click from home.' : f.in || f.by ? '<b>Nothing matches these filters.</b> <a class="link" href="/">Show everything</a>' : '<b>No diagrams here yet.</b> An agent saves one over MCP, or a script through the API.',
      now,
    };
    const heading = sharedOnly ? 'Shared with you' : starredOnly ? 'Starred' : m.sort === 'name' ? 'All diagrams' : 'Recent';
    if (narrowList) title = heading;
    const narrow = narrowList ? '' : filters(m, base, byId);
    const lead = narrowList ? '' : `${greeting(m, all, now)}${own ? starts(own) : ''}`;
    const tail = narrowList || !own ? '' : examples(own);
    body = `${lead}<section class="lib" aria-labelledby="lib"><div class="lib-head"><h2 id="lib">${heading}</h2>${narrow}${libraryTools(lib)}</div>${libraryItems(lib)}</section>${tail}`;
  }
  const toast = '<div class="toast toast-float" id="toast" role="status" hidden><span></span></div>';
  body = `${body}${toast}`;
  return appPage(
    { title, nonce: m.nonce, ...(m.csrf ? { csrf: m.csrf } : {}), user: m.user, workspaces: spaces, sharedCount: shared, starredCount: starred, place: m.place, agents: m.agents, ...(m.query !== undefined ? { query: m.query } : {}), ...(own ? { importHref: `/import/${encodeURIComponent(own.slug)}`, newHref: `/new?in=${encodeURIComponent(own.slug)}` } : {}), body },
    FILTER_SCRIPT + LIBRARY_SCRIPT,
  );
}

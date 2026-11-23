/**
 * Decision records in the browser: the Decisions tab of a workspace (each
 * registry it holds, filtered by category, status, and words) and the
 * page of one record. Record bodies are Markdown rendered with raw HTML
 * shown as text; a citation in a body becomes a link to its record. A
 * record's page ends with what cites it, grouped by document.
 */
import { renderDoc } from '@vantage/render';
import type { AccessibleWorkspace } from '../authz.ts';
import { escapeHtml } from './html.ts';
import { ico } from './icons.ts';
import { recordUrl } from '../decisions/read.ts';
import type { Backlinks } from '../decisions/backlinks.ts';
import { alignmentText } from '../decisions/text.ts';
import { STATUSES, STATUS_LABEL, type Decision, type DecisionStatus, type DecisionStub, type Registry } from '../decisions/types.ts';

export interface DecisionFilter {
  readonly registry?: string | undefined;
  readonly category?: number | undefined;
  readonly status?: DecisionStatus | undefined;
  readonly q?: string | undefined;
}

export interface DecisionsTabModel {
  readonly registries: readonly Registry[];
  /** The registry shown; absent when the workspace holds none. */
  readonly current?: Registry;
  /** Every record of the current registry, for the counts on the filters. */
  readonly all: readonly Decision[];
  /** The records the filter keeps. */
  readonly shown: readonly Decision[];
  readonly filter: DecisionFilter;
}

const PILL: Record<DecisionStatus, string> = { proposed: 'warn', accepted: 'ok', deprecated: '', superseded: '' };

export function statusPill(s: DecisionStatus): string {
  return `<span class="pill ${PILL[s]}">${STATUS_LABEL[s]}</span>`;
}

function tabHref(ws: AccessibleWorkspace, f: DecisionFilter): string {
  const p = new URLSearchParams({ tab: 'decisions' });
  if (f.registry) p.set('registry', f.registry);
  if (f.category !== undefined) p.set('category', String(f.category));
  if (f.status) p.set('status', f.status);
  if (f.q) p.set('q', f.q);
  return `/w/${encodeURIComponent(ws.slug)}?${p.toString()}`;
}

export function decisionsTab(ws: AccessibleWorkspace, m: DecisionsTabModel): string {
  const intro = `<div class="tab-intro"><h2 id="t-head">Decisions</h2><p>The architecture decisions behind this workspace's diagrams, one record per decision. A record that governs a box shows on that box in the viewer. Agents read and write them through the hub's MCP tools.</p></div>`;
  const cur = m.current;
  if (!cur) return `<section aria-labelledby="t-head">${intro}<p class="none-here"><b>No decision registry here yet.</b> An author makes one with <code>vantage_registries</code> or <code>POST /api/v1/workspaces/${escapeHtml(ws.slug)}/registries</code>.</p></section>`;
  const f = { ...m.filter, registry: cur.prefix };
  const chip = (href: string, label: string, n: number | undefined, on: boolean): string => `<a class="chip" href="${escapeHtml(href)}"${on ? ' aria-pressed="true"' : ''}>${label}${n !== undefined ? `<span class="n">${n}</span>` : ''}</a>`;
  const registries = m.registries.length > 1 ? `<div class="reg-filters" role="group" aria-label="Registries">${m.registries.map((r) => chip(tabHref(ws, { registry: r.prefix }), `${ico('book', 13)}${escapeHtml(r.prefix)} ${escapeHtml(r.name)}`, undefined, r.prefix === cur.prefix)).join('')}</div>` : '';
  const cats = cur.categories.map((c) => chip(tabHref(ws, { ...f, category: f.category === c.digit ? undefined : c.digit }), `${c.digit} ${escapeHtml(c.name)}`, m.all.filter((d) => d.category === c.digit).length, f.category === c.digit));
  const statuses = STATUSES.map((s) => chip(tabHref(ws, { ...f, status: f.status === s ? undefined : s }), STATUS_LABEL[s], m.all.filter((d) => d.status === s).length, f.status === s));
  const all = chip(tabHref(ws, { registry: cur.prefix }), 'All', m.all.length, f.category === undefined && !f.status && !f.q);
  const search = `<form class="reg-search" method="get" action="/w/${encodeURIComponent(ws.slug)}"><input type="hidden" name="tab" value="decisions"><input type="hidden" name="registry" value="${escapeHtml(cur.prefix)}"><label class="sr-only" for="dec-q">Search records</label><input class="field" id="dec-q" name="q" type="search" placeholder="Search ${escapeHtml(cur.prefix)} records" value="${escapeHtml(f.q ?? '')}"><button class="btn sm">Search</button></form>`;
  const bar = `<div class="reg-bar">${registries}<div class="reg-filters" role="group" aria-label="Filter by category">${all}${cats.join('')}</div><div class="reg-filters" role="group" aria-label="Filter by status">${statuses.join('')}</div>${search}</div>`;
  const rows = m.shown.map((d) => {
    const sub = d.status === 'superseded' && d.supersededBy ? `${escapeHtml(d.categoryName)} · superseded by ${escapeHtml(d.supersededBy.ref)}` : `${escapeHtml(d.categoryName)}${d.deciders.length ? ` · ${escapeHtml(d.deciders.join(', '))}` : ''}`;
    return `<a class="dec-row${d.status === 'superseded' || d.status === 'deprecated' ? ' gone' : ''}" href="${escapeHtml(recordUrl(ws.slug, d.ref))}"><span class="ref">${escapeHtml(d.ref)}</span><span class="t"><b>${escapeHtml(d.title)}</b><span>${sub}</span></span>${statusPill(d.status)}<time datetime="${escapeHtml(d.updatedOn)}" title="Last updated">${escapeHtml(d.updatedOn)}</time></a>`;
  });
  const list = rows.length ? `<div class="rows">${rows.join('')}</div>` : `<p class="none-here">${m.all.length ? 'No record matches this filter.' : `<b>${escapeHtml(cur.prefix)} has no records yet.</b> Agents write one with <code>vantage_write</code> to <code>${escapeHtml(cur.prefix)}</code>, or bring a repository's records in with <code>vantage_decision_import</code>.`}</p>`;
  return `<section aria-labelledby="t-head">${intro}${bar}${list}</section>`;
}

/** Where each citation in a body points: its record's link and title, by the citation as written. */
export type Citations = ReadonlyMap<string, { readonly url: string; readonly title: string }>;

/** Markdown to HTML, with each citation a link to its record, or plain text when it names nothing the reader may open. */
export function bodyHtml(id: string, markdown: string, cites: Citations): string {
  if (!markdown.trim()) return '<p class="none">None recorded.</p>';
  return renderDoc(id, markdown).html.replace(/<a class="v-decision" data-decision="([^"]*)">([\s\S]*?)<\/a>/g, (_m, ref: string, words: string) => {
    const raw = ref.replace(/&amp;/g, '&');
    const hit = cites.get(raw);
    const text = words || ref;
    return hit ? `<a href="${escapeHtml(hit.url)}" title="${escapeHtml(hit.title)}">${text}</a>` : `<span>${text}</span>`;
  });
}

/** The citations written in a record's Markdown, so the page can resolve them first. */
export function citationsIn(d: Decision): string[] {
  const out = new Set<string>();
  for (const md of [d.context, d.decision, d.consequences, ...d.alternatives.map((a) => a.rejected)]) for (const c of renderDoc('x', md).decisions) out.add(c);
  return [...out];
}

function stubLink(ws: string, s: DecisionStub): string {
  return `<a href="${escapeHtml(recordUrl(ws, s.ref))}">${escapeHtml(s.ref)} ${escapeHtml(s.title)}</a>`;
}

/** Cited by: each document with links to the boxes and pages that cite the record, then each record. */
export function citedByHtml(b: Backlinks): string {
  const docs = b.documents.map((d) => {
    const places = d.places.map((x) => `<a href="${escapeHtml(x.url)}">${x.kind === 'box' ? 'box' : 'page'} <code>${escapeHtml(x.id)}</code></a>${x.citedAs !== b.ref ? ` <span class="caps">as ${escapeHtml(x.citedAs)}</span>` : ''}`);
    return `<li><a href="${escapeHtml(d.url)}">${escapeHtml(d.documentName)}</a> <span class="caps">${escapeHtml(d.workspace)}</span>: ${places.join(', ')}</li>`;
  });
  const records = b.records.map((r) => `<li><a href="${escapeHtml(r.url)}">${escapeHtml(r.ref)} ${escapeHtml(r.title)}</a>: ${escapeHtml(r.places.map((x) => (x === 'related' ? 'Related' : 'text')).join(', '))}</li>`);
  const hidden = b.hidden ? `<li class="none">${b.hidden} more in places you cannot open.</li>` : '';
  const items = [...docs, ...records].join('') + hidden;
  return `<h2>Cited by</h2>${items ? `<ul class="dec-links">${items}</ul>` : '<p class="none">Nothing cites this record yet. Cite it from a box\'s <code>decisions</code> list or a page, so readers find it.</p>'}`;
}

/** The page body of one record; the route wraps it in the app frame. */
export function decisionBody(d: Decision, ws: AccessibleWorkspace, wsName: string, cites: Citations, cited: Backlinks): string {
  const crumbs = `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${ico('right', 12)}<a href="/w/${encodeURIComponent(ws.slug)}">${escapeHtml(wsName)}</a>${ico('right', 12)}<a href="${escapeHtml(tabHref(ws, { registry: d.registry }))}">${escapeHtml(d.registry)} decisions</a>${ico('right', 12)}<span aria-current="page">${escapeHtml(d.ref)}</span></nav>`;
  const head = `<header class="dec-head">${crumbs}<span class="ref">${escapeHtml(d.ref)}</span><h1>${escapeHtml(d.title)}</h1><div class="ws-meta">${statusPill(d.status)}<span>${escapeHtml(`${d.category} ${d.categoryName}`)}</span></div></header>`;
  const banner =
    d.status === 'superseded' && d.supersededBy
      ? `<div class="banner warn">${ico('error')}<span>Superseded by ${stubLink(ws.slug, d.supersededBy)}. This record keeps the reasons it had.</span></div>`
      : d.status === 'deprecated'
        ? `<div class="banner"><span>Deprecated: this decision no longer applies.</span></div>`
        : '';
  const cell = (label: string, value: string): string => `<div><span class="caps">${label}</span><b>${value}</b></div>`;
  const meta = [
    cell('Decision date', escapeHtml(d.decidedOn ?? 'Not recorded')),
    cell('Last updated', escapeHtml(d.updatedOn)),
    cell('Decision makers', escapeHtml(d.deciders.join(', ') || 'Not recorded')),
    ...(d.supersedes ? [cell('Supersedes', stubLink(ws.slug, d.supersedes))] : []),
    ...(d.alignment ? [cell('Standard', escapeHtml(alignmentText(d.alignment)))] : []),
    cell('Cite as', `<code>${escapeHtml(d.ref)}</code> · <code>${escapeHtml(d.machineRef)}</code>`),
    ...(d.aliases.length ? [cell('Formerly', d.aliases.map((a) => `<code>${escapeHtml(a)}</code>`).join(' · '))] : []),
  ];
  const alts = d.alternatives.length ? d.alternatives.map((a) => `<div class="dec-alt"><h3>${escapeHtml(a.option)}</h3>${bodyHtml(`${d.id}-alt`, a.rejected, cites)}</div>`).join('') : '<p class="none">None recorded.</p>';
  const related = d.related.length ? `<h2>Related</h2><ul class="dec-links">${d.related.map((r) => `<li>${stubLink(ws.slug, r)}</li>`).join('')}</ul>` : '';
  const governs = d.governs.length
    ? `<h2>Governs</h2><ul class="dec-links">${d.governs.map((g) => `<li><a href="/w/${encodeURIComponent(g.workspace)}/${encodeURIComponent(g.document)}${g.view ? `#${encodeURIComponent(g.view)}` : ''}">${escapeHtml(g.documentName)}</a>: ${g.box ? `box <code>${escapeHtml(g.box)}</code>` : `view <code>${escapeHtml(g.view ?? '')}</code>`}</li>`).join('')}</ul>`
    : '';
  const body = `<article class="dec-body"><h2>Context</h2>${bodyHtml(`${d.id}-c`, d.context, cites)}<h2>Decision</h2>${bodyHtml(`${d.id}-d`, d.decision, cites)}<h2>Consequences</h2>${bodyHtml(`${d.id}-q`, d.consequences, cites)}<h2>Alternatives considered</h2>${alts}${related}${governs}${citedByHtml(cited)}</article>`;
  return `<div class="dec-page">${head}${banner}<div class="dec-meta">${meta.join('')}</div>${body}</div>`;
}

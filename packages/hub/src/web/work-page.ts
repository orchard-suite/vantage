/**
 * Tracked work in the browser: the Work tab of a workspace (its kinds,
 * filtered by state, with live counts) and the page of one item. The page
 * offers only the moves the gate opens to the reader, and every button
 * calls the same verbs the API and the agents call, with a key the page
 * makes so a double click lands once.
 */
import type { AccessibleWorkspace } from '../authz.ts';
import { escapeHtml } from './html.ts';
import { ico } from './icons.ts';
import { bodyHtml } from './decisions-page.ts';
import type { KindRow } from '../tracking/kinds.ts';
import type { Card, Row } from '../tracking/read.ts';
import type { MoveOption } from '../tracking/gate.ts';

/** How the tab shows the same items: a list, a board by horizon, or a timeline by promised date. */
export type WorkLook = 'list' | 'board' | 'timeline';

export interface WorkTabModel {
  readonly kinds: readonly KindRow[];
  readonly current?: KindRow;
  readonly counts: Readonly<Record<string, number>>;
  readonly rows: readonly Row[];
  readonly total: number;
  readonly state?: string | undefined;
  readonly look: WorkLook;
}

/** A kind with a horizon label reads as a roadmap: a board by horizon, and a timeline when it has a date label. */
export function looksOf(k: KindRow): WorkLook[] {
  const labels = k.definition.labels;
  const out: WorkLook[] = ['list'];
  if (labels.some((l) => l.name === 'horizon' && l.type === 'choice')) out.push('board');
  if (labels.some((l) => l.type === 'date')) out.push('timeline');
  return out;
}

const PILL: Record<Row['class'], string> = { 'not-started': '', 'in-progress': 'warn', done: 'ok', parked: '' };

export const itemUrl = (ws: string, key: string): string => `/w/${encodeURIComponent(ws)}/work/${encodeURIComponent(key)}`;

function tabHref(ws: AccessibleWorkspace, kind: string | undefined, state?: string, look?: WorkLook): string {
  const p = new URLSearchParams({ tab: 'work' });
  if (kind) p.set('kind', kind);
  if (state) p.set('state', state);
  if (look && look !== 'list') p.set('look', look);
  return `/w/${encodeURIComponent(ws.slug)}?${p.toString()}`;
}

function rowLink(ws: AccessibleWorkspace, r: Row, stateText: ReadonlyMap<string, string>): string {
  const sub = [r.holders.length ? `held by ${r.holders.join(', ')}` : 'nobody holds it', ...Object.entries(r.labels).filter(([k]) => k !== 'horizon').map(([k, v]) => `${k} ${v}`), ...(r.proofAt ? [`proof ${r.proofAt}`] : [])].join(' · ');
  return `<a class="dec-row" href="${escapeHtml(itemUrl(ws.slug, r.key))}"><span class="ref">${escapeHtml(r.key)}</span><span class="t"><b>${escapeHtml(r.title)}</b><span>${escapeHtml(sub)}</span></span><span class="pill ${PILL[r.class]}">${escapeHtml(stateText.get(r.state) ?? r.state)}</span><time datetime="${escapeHtml(r.updated)}" title="Last changed">${escapeHtml(r.updated)}</time></a>`;
}

/** The board: one column per horizon, and one for items with none. */
function board(ws: AccessibleWorkspace, k: KindRow, rows: readonly Row[], stateText: ReadonlyMap<string, string>): string {
  const horizons = [...(k.definition.labels.find((l) => l.name === 'horizon')?.choices ?? []), ''];
  const cols = horizons.map((h) => {
    const mine = rows.filter((r) => (r.labels['horizon'] ?? '') === h);
    if (!h && !mine.length) return '';
    const cards = mine.map((r) => `<a class="work-card" href="${escapeHtml(itemUrl(ws.slug, r.key))}"><span class="ref">${escapeHtml(r.key)}</span><b>${escapeHtml(r.title)}</b><span class="pill ${PILL[r.class]}">${escapeHtml(stateText.get(r.state) ?? r.state)}</span><span class="sub">${escapeHtml([r.holders.join(', ') || 'nobody owes it', r.proofAt ? `proof ${r.proofAt}` : 'no proof yet'].join(' · '))}</span></a>`);
    return `<section class="work-col" aria-label="${escapeHtml(h || 'No horizon')}"><h3>${escapeHtml(h ? h[0]!.toUpperCase() + h.slice(1) : 'No horizon')}<span class="n">${mine.length}</span></h3>${cards.join('') || '<p class="none">Nothing here.</p>'}</section>`;
  });
  return `<div class="work-board">${cols.join('')}</div>`;
}

/** The timeline: items with a date, in date order, each placed along the span from the first date to the last. */
function timeline(ws: AccessibleWorkspace, k: KindRow, rows: readonly Row[], stateText: ReadonlyMap<string, string>): string {
  const dateLabel = k.definition.labels.find((l) => l.type === 'date')!.name;
  const dated = rows.filter((r) => typeof r.labels[dateLabel] === 'string').sort((a, b) => String(a.labels[dateLabel]).localeCompare(String(b.labels[dateLabel])));
  const undated = rows.length - dated.length;
  if (!dated.length) return `<p class="none-here">No item has a ${escapeHtml(dateLabel)} date yet. A date is set only for a real promise.</p>`;
  const t = (r: Row): number => Date.parse(String(r.labels[dateLabel]));
  const first = t(dated[0]!), last = t(dated[dated.length - 1]!);
  const span = Math.max(1, last - first);
  const lines = dated.map((r) => `<a class="work-tl" href="${escapeHtml(itemUrl(ws.slug, r.key))}" style="--at:${(((t(r) - first) / span) * 100).toFixed(1)}%"><time>${escapeHtml(String(r.labels[dateLabel]))}</time><span class="ref">${escapeHtml(r.key)}</span><b>${escapeHtml(r.title)}</b><span class="pill ${PILL[r.class]}">${escapeHtml(stateText.get(r.state) ?? r.state)}</span></a>`);
  return `<div class="work-timeline">${lines.join('')}</div>${undated ? `<p class="none-here">${undated} item${undated === 1 ? ' has' : 's have'} no ${escapeHtml(dateLabel)} date.</p>` : ''}`;
}

export function workTab(ws: AccessibleWorkspace, m: WorkTabModel): string {
  const intro = `<div class="tab-intro"><h2 id="t-head">Work</h2><p>The work this workspace tracks. Each kind follows its lifecycle: the hub refuses any move the picture does not draw. Agents take and move items through the hub's tools; a business tool calls the same verbs over the API.</p></div>`;
  const cur = m.current;
  if (!cur) return `<section aria-labelledby="t-head">${intro}<p class="none-here"><b>No kind of work here yet.</b> A kind is a diagram with a <code>kind</code> block; save one with <code>base: work-item</code> to start from the hub's own lifecycle.</p></section>`;
  const chip = (href: string, label: string, n: number | undefined, on: boolean): string => `<a class="chip" href="${escapeHtml(href)}"${on ? ' aria-pressed="true"' : ''}>${label}${n !== undefined ? `<span class="n">${n}</span>` : ''}</a>`;
  const kinds = m.kinds.length > 1 ? `<div class="reg-filters" role="group" aria-label="Kinds">${m.kinds.map((k) => chip(tabHref(ws, k.prefix), `${escapeHtml(k.prefix)} ${escapeHtml(k.name)}`, undefined, k.id === cur.id)).join('')}</div>` : '';
  const all = Object.values(m.counts).reduce((s, x) => s + x, 0);
  const states = cur.definition.states.map((s) => chip(tabHref(ws, cur.prefix, m.state === s.id ? undefined : s.id), escapeHtml(s.text), m.counts[s.id] ?? 0, m.state === s.id));
  const looks = looksOf(cur);
  const lookNames: Record<WorkLook, string> = { list: 'List', board: 'Board', timeline: 'Timeline' };
  const lookBar = looks.length > 1 ? `<div class="reg-filters" role="group" aria-label="Show as">${looks.map((l) => chip(tabHref(ws, cur.prefix, m.state, l), lookNames[l], undefined, m.look === l)).join('')}</div>` : '';
  const bar = `<div class="reg-bar">${kinds}<div class="reg-filters" role="group" aria-label="Filter by state">${chip(tabHref(ws, cur.prefix, undefined, m.look), 'All', all, !m.state)}${states.join('')}</div>${lookBar}</div>`;
  const stateText = new Map(cur.definition.states.map((s) => [s.id, s.text]));
  const more = m.total > m.rows.length ? `<p class="none-here">${m.total - m.rows.length} more; pick a state to narrow the list.</p>` : '';
  if (!m.rows.length) return `<section aria-labelledby="t-head">${intro}${bar}<p class="none-here">${all ? 'No item is in this state.' : `<b>${escapeHtml(cur.prefix)} has no items yet.</b> Agents make one with <code>vantage_write</code> to <code>${escapeHtml(cur.prefix)}</code>.`}</p></section>`;
  const body = m.look === 'board' && looks.includes('board') ? board(ws, cur, m.rows, stateText) : m.look === 'timeline' && looks.includes('timeline') ? timeline(ws, cur, m.rows, stateText) : `<div class="rows">${m.rows.map((r) => rowLink(ws, r, stateText)).join('')}</div>`;
  return `<section aria-labelledby="t-head">${intro}${bar}${body}${more}</section>`;
}

export interface ItemPageModel {
  readonly card: Card;
  readonly body: string;
  readonly moves: readonly MoveOption[];
  readonly notes: readonly string[];
  readonly history: readonly string[];
  readonly links: readonly string[];
  readonly files: readonly { id: string; name: string; size: number }[];
  /** Whether the reader writes the workspace: notes and holds are theirs to make. */
  readonly author: boolean;
  readonly held: boolean;
  /** Where the kind's lifecycle is drawn; absent for one that follows the hub's shipped lifecycle. */
  readonly lifecycleUrl?: string | undefined;
}

/** The page body of one item; the route wraps it in the app frame. */
export function itemBody(ws: AccessibleWorkspace | undefined, wsName: string, m: ItemPageModel): string {
  const c = m.card;
  const api = `/api/v1/items/${encodeURIComponent(c.key)}`;
  const crumbs = ws
    ? `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${ico('right', 12)}<a href="/w/${encodeURIComponent(ws.slug)}">${escapeHtml(wsName)}</a>${ico('right', 12)}<a href="${escapeHtml(tabHref(ws, c.kind))}">${escapeHtml(c.kind)} work</a>${ico('right', 12)}<span aria-current="page">${escapeHtml(c.key)}</span></nav>`
    : '';
  const head = `<header class="dec-head">${crumbs}<span class="ref">${escapeHtml(c.key)}</span><h1>${escapeHtml(c.title)}</h1><div class="ws-meta"><span class="pill ${PILL[c.class]}">${escapeHtml(c.stateText)}</span><span>since ${escapeHtml(c.since)}</span>${m.lifecycleUrl ? `<a href="${escapeHtml(m.lifecycleUrl)}">How ${escapeHtml(c.kindName)} moves</a>` : `<span>follows the hub's work item lifecycle</span>`}</div></header>`;
  const cell = (label: string, value: string): string => `<div><span class="caps">${label}</span><b>${value}</b></div>`;
  const meta = [
    cell('Asked by', escapeHtml(c.asker ?? 'Nobody')),
    cell('Held by', escapeHtml(c.holders.join(', ') || 'Nobody')),
    ...Object.entries(c.labels).map(([k, v]) => cell(escapeHtml(k), escapeHtml(String(v)))),
    ...(c.parent ? [cell('Part of', escapeHtml(c.parent))] : []),
    ...(c.ref ? [cell("Owner's key", `<code>${escapeHtml(c.ref)}</code>`)] : []),
    ...(c.revision ? [cell('Revision', `<code>${escapeHtml(c.revision)}</code>`)] : []),
  ];
  const moveButtons = m.moves.map((o) => {
    const needsNote = o.needs.includes('note');
    return `<form class="work-move" data-api="${escapeHtml(api)}/move" data-to="${escapeHtml(o.to)}">${needsNote ? `<input class="field" name="note" maxlength="4000" placeholder="Why: ${escapeHtml(o.label)}" aria-label="Note for ${escapeHtml(o.label)}" required>` : ''}<button class="btn sm${o.to === 'done' ? ' primary' : ''}">${escapeHtml(o.label)} → ${escapeHtml(o.toText)}</button></form>`;
  });
  const holdBtn = m.author ? `<button class="btn ghost sm" type="button" data-work="${escapeHtml(api)}/${m.held ? 'release' : 'hold'}">${m.held ? 'Let go of it' : 'Hold it'}</button>` : '';
  const actions = `<div class="work-actions" aria-label="Moves open to you">${moveButtons.join('') || '<span class="none">No move is open to you from here.</span>'}${holdBtn}<p class="work-error" role="alert" hidden></p></div>`;
  const noteForm = m.author ? `<form class="work-note" data-api="${escapeHtml(api)}/notes"><label class="sr-only" for="work-note">Add a note</label><textarea class="field" id="work-note" name="text" rows="3" maxlength="4000" placeholder="Add a note" required></textarea><button class="btn sm">Add note</button></form>` : '';
  const list = (items: readonly string[], none: string): string => (items.length ? `<ul class="dec-links">${items.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : `<p class="none">${none}</p>`);
  const notes = m.notes.length ? m.notes.map((n) => `<div class="dec-alt">${bodyHtml(`${c.key}-n`, n, new Map())}</div>`).join('') : '<p class="none">No notes yet.</p>';
  const files = m.files.length ? `<ul class="dec-links">${m.files.map((f) => `<li><a href="${escapeHtml(api)}/files/${encodeURIComponent(f.id)}">${escapeHtml(f.name)}</a> <span class="caps">${f.size.toLocaleString('en-US')} bytes</span></li>`).join('')}</ul>` : '<p class="none">No files.</p>';
  const body = c.hasBody ? `<section class="work-body" aria-label="The work">${m.body.trim() ? bodyHtml(`${c.key}-b`, m.body, new Map()) : '<p class="none">No description yet.</p>'}</section>` : '';
  return `<div class="dec-page">${head}${actions}<div class="dec-meta">${meta.join('')}</div><article class="dec-body">${body}<h2>Notes</h2>${noteForm}${notes}<h2>Links</h2>${list(m.links, 'No links.')}<h2>Files</h2>${files}<h2>History</h2>${list(m.history, 'Nothing yet.')}</article></div>`;
}

/** The page's one script: each move, hold, and note calls the API with one key per control until it fails, so a double click lands once, then shows the item as it stands. */
export const WORK_SCRIPT = `
(() => {
  const csrf = document.querySelector('meta[name=csrf]')?.content ?? '';
  const err = document.querySelector('.work-error');
  const keys = new WeakMap();
  const call = async (el, url, body) => {
    if (!keys.has(el)) keys.set(el, crypto.randomUUID());
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, 'idempotency-key': keys.get(el) }, body: JSON.stringify(body) });
    if (res.ok) return location.reload();
    keys.delete(el);
    const j = await res.json().catch(() => ({}));
    if (err) { err.textContent = j.message || j.error || 'That did not land; try again.'; err.hidden = false; }
  };
  for (const f of document.querySelectorAll('form.work-move')) f.addEventListener('submit', (e) => { e.preventDefault(); const note = f.querySelector('[name=note]')?.value; call(f, f.dataset.api, { to: f.dataset.to, ...(note ? { note } : {}) }); });
  for (const f of document.querySelectorAll('form.work-note')) f.addEventListener('submit', (e) => { e.preventDefault(); call(f, f.dataset.api, { text: f.querySelector('[name=text]').value }); });
  for (const b of document.querySelectorAll('button[data-work]')) b.addEventListener('click', () => call(b, b.dataset.work, { person: 'me' }));
})();
`;

export const WORK_CSS = `
.work-board{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;align-items:start}
.work-col{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--line);border-radius:var(--r-l);background:var(--sunken)}
.work-col h3{display:flex;justify-content:space-between;margin:0 2px 2px;font-size:13px;font-weight:600}
.work-col h3 .n{font:500 var(--fs-xs) var(--mono);color:var(--faint)}
.work-card{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-m);background:var(--panel);color:inherit;text-decoration:none}
.work-card:hover{border-color:var(--line2)}
.work-card .ref{font:600 var(--fs-xs) var(--mono);color:var(--muted)}
.work-card b{font-weight:600;font-size:13.5px}
.work-card .pill{align-self:flex-start}
.work-card .sub{font-size:12px;color:var(--muted)}
.work-timeline{position:relative;display:flex;flex-direction:column;gap:6px;padding:4px 0 4px 18px;border-left:2px solid var(--line)}
.work-tl{display:grid;grid-template-columns:96px 70px 1fr auto;gap:12px;align-items:center;padding:8px 12px;border:1px solid var(--line);border-radius:var(--r-m);background:var(--panel);color:inherit;text-decoration:none;margin-left:calc(var(--at) * 0.3)}
.work-tl time,.work-tl .ref{font:500 var(--fs-xs) var(--mono);color:var(--muted)}
@media (max-width:640px){.work-tl{grid-template-columns:1fr;margin-left:0}}
.work-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.work-move{display:flex;gap:6px;align-items:center}
.work-move .field{height:30px;min-width:220px}
.work-note{display:flex;flex-direction:column;gap:8px;align-items:flex-start;margin:0 0 14px}
.work-note .field{width:100%;max-width:640px}
.work-error{flex-basis:100%;margin:0;color:var(--bad)}
.work-body{border:1px solid var(--line);border-radius:var(--r-l);background:var(--panel);padding:2px 18px 6px;margin-bottom:8px}
.work-body h2{font-size:15px}
`;

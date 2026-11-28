/**
 * The Work tab's two pictures of a kind: the board, one column per
 * horizon with the items in their place, and the timeline, a bar for an
 * item planned from a start to an end, a bar over its parts for a parent,
 * a point for an item with one date, and a marker for each milestone its
 * items work toward. Both are static. A person who writes the workspace
 * drags a card to its place, or moves it with its up and down buttons; each
 * is one put with a place, the same the agents call.
 */
import type { AccessibleWorkspace } from '../authz.ts';
import { escapeHtml } from './html.ts';
import type { KindRow } from '../tracking/kinds.ts';
import type { Row } from '../tracking/read.ts';
import type { Marker } from '../tracking/milestone.ts';

const PILL: Record<Row['class'], string> = { 'not-started': '', 'in-progress': 'warn', done: 'ok', parked: '' };

export const itemUrl = (ws: string, key: string): string => `/w/${encodeURIComponent(ws)}/work/${encodeURIComponent(key)}`;

/** A pill for an item overdue or due soon, and nothing for one that is neither. */
export const duePill = (r: Pick<Row, 'due'>): string => (r.due?.overdue ? `<span class="pill bad" title="Due ${escapeHtml(r.due.date)}">Overdue</span>` : r.due?.soon ? `<span class="pill warn" title="Due ${escapeHtml(r.due.date)}">Due soon</span>` : '');

const pill = (r: Row, stateText: ReadonlyMap<string, string>): string => `<span class="pill ${PILL[r.class]}">${escapeHtml(stateText.get(r.state) ?? r.state)}</span>`;

/** The board: one column per horizon, and one for items with none, each in the kind's order. */
export function board(ws: AccessibleWorkspace, k: KindRow, rows: readonly Row[], stateText: ReadonlyMap<string, string>, author: boolean): string {
  const horizons = [...(k.definition.labels.find((l) => l.name === 'horizon')?.choices ?? []), ''];
  const cols = horizons.map((h) => {
    const mine = rows.filter((r) => (r.labels['horizon'] ?? '') === h);
    if (!h && !mine.length) return '';
    const cards = mine.map((r, i) => {
      const moves = author
        ? `<div class="work-card-move"><button class="btn ghost sm" type="button" data-place="up" aria-label="Move ${escapeHtml(r.key)} up"${i === 0 ? ' disabled' : ''}>Up</button><button class="btn ghost sm" type="button" data-place="down" aria-label="Move ${escapeHtml(r.key)} down"${i === mine.length - 1 ? ' disabled' : ''}>Down</button></div>`
        : '';
      return `<article class="work-card${r.due?.overdue ? ' overdue' : ''}" data-key="${escapeHtml(r.key)}"${author ? ' draggable="true"' : ''}><a href="${escapeHtml(itemUrl(ws.slug, r.key))}"><span class="ref">${escapeHtml(r.key)}</span><b>${escapeHtml(r.title)}</b></a>${pill(r, stateText)}${duePill(r)}${r.run ? `<span class="pill warn" title="${escapeHtml(`Working now: ${r.run}`)}">Live run</span>` : ''}<span class="sub">${escapeHtml([r.owner ? `owner ${r.owner}` : 'no owner', ...(r.holders.length ? [`held by ${r.holders.join(', ')}`] : []), r.proofAt ? `proof ${r.proofAt}` : 'no proof yet'].join(' · '))}</span>${moves}</article>`;
    });
    return `<section class="work-col" data-horizon="${escapeHtml(h)}" aria-label="${escapeHtml(h || 'No horizon')}"><h3>${escapeHtml(h ? h[0]!.toUpperCase() + h.slice(1) : 'No horizon')}<span class="n">${mine.length}</span></h3>${cards.join('') || '<p class="none">Nothing here.</p>'}</section>`;
  });
  const api = author ? ' data-api="/api/v1/items"' : '';
  return `<div class="work-board"${api}>${cols.join('')}</div>${author ? '<p class="work-error" role="alert" hidden></p><p class="none-here">Drag a card to put it in order, or to another horizon. Up and Down do the same from the keyboard.</p>' : ''}`;
}

/** When an item sits on the timeline: from its start to its end, over its parts' span, or at its one date. */
export function whenOf(k: KindRow, r: Row): { from: string; to: string; bar: boolean } | undefined {
  const date = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const start = date(r.labels['start']) ?? r.span?.start ?? undefined;
  const end = date(r.labels['end']) ?? r.span?.end ?? undefined;
  if (start && end) return { from: start, to: end, bar: true };
  const one = start ?? end ?? k.definition.labels.filter((l) => l.type === 'date').map((l) => date(r.labels[l.name])).find((v) => v !== undefined);
  return one ? { from: one, to: one, bar: false } : undefined;
}

/** The timeline: a row per dated item in date order, on one scale with the milestones its items work toward. */
export function timeline(ws: AccessibleWorkspace, k: KindRow, rows: readonly Row[], stateText: ReadonlyMap<string, string>, milestones: readonly Marker[]): string {
  const dated = rows.flatMap((r) => {
    const w = whenOf(k, r);
    return w ? [{ r, w }] : [];
  }).sort((a, b) => a.w.from.localeCompare(b.w.from) || a.w.to.localeCompare(b.w.to));
  const undated = rows.length - dated.length;
  if (!dated.length) return `<p class="none-here">No item has a date yet. A start, an end, or a promise is set only when a person gives one.</p>`;
  const days = [...dated.flatMap((x) => [x.w.from, x.w.to]), ...milestones.map((m) => m.date)].map((d) => Date.parse(d));
  const first = Math.min(...days), last = Math.max(...days);
  const span = Math.max(1, last - first);
  const at = (d: string): string => `${(((Date.parse(d) - first) / span) * 100).toFixed(2)}%`;
  const lines = milestones.map((m) => `<span class="work-ms-line" style="--at:${at(m.date)}"></span>`).join('');
  // A marker past the middle reads to its left, so its words stay on the track.
  const marks = milestones.map((m) => `<a class="work-ms${Date.parse(m.date) - first > span / 2 ? ' left' : ''}" href="${escapeHtml(itemUrl(ws.slug, m.key))}" style="--at:${at(m.date)}" title="${escapeHtml(`${m.key} ${m.title}, due ${m.date}`)}"><span class="work-ms-dot" aria-hidden="true"></span><span>${escapeHtml(m.key)} ${escapeHtml(m.date)}</span></a>`).join('');
  const head = `<div class="work-gantt-row work-gantt-head"><span class="lbl">${milestones.length ? 'Milestones' : ''}</span><span class="track">${lines}${marks}</span><span></span><time>${escapeHtml(new Date(first).toISOString().slice(0, 10))} to ${escapeHtml(new Date(last).toISOString().slice(0, 10))}</time></div>`;
  const body = dated.map(({ r, w }) => {
    const mark = w.bar ? `<span class="work-bar${r.labels['start'] === undefined ? ' parts' : ''}" style="--at:${at(w.from)};--w:${(((Date.parse(w.to) - Date.parse(w.from)) / span) * 100).toFixed(2)}%"></span>` : `<span class="work-pt" style="--at:${at(w.from)}"></span>`;
    const when = w.bar ? `${w.from} to ${w.to}${r.labels['start'] === undefined ? ', from its parts' : ''}` : w.from;
    return `<a class="work-gantt-row" href="${escapeHtml(itemUrl(ws.slug, r.key))}"><span class="lbl"><span class="ref">${escapeHtml(r.key)}</span><b>${escapeHtml(r.title)}</b></span><span class="track">${lines}${mark}</span>${pill(r, stateText)}<time>${escapeHtml(when)}</time></a>`;
  });
  return `<div class="work-gantt">${head}${body.join('')}</div>${undated ? `<p class="none-here">${undated} item${undated === 1 ? ' has' : 's have'} no date.</p>` : ''}`;
}

/** The board's one script: a drop or an up or down button sends one put with a place, and a horizon when the card changed column. */
export const BOARD_SCRIPT = `
(() => {
  const board = document.querySelector('.work-board[data-api]');
  if (!board) return;
  const csrf = document.querySelector('meta[name=csrf]')?.content ?? '';
  const err = board.parentElement.querySelector('.work-error');
  const send = async (key, horizon, place) => {
    const body = { item: key, place, ...(horizon === undefined ? {} : { labels: { horizon: horizon || null } }) };
    const res = await fetch(board.dataset.api, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) });
    if (res.ok) return location.reload();
    const j = await res.json().catch(() => ({}));
    if (err) { err.textContent = j.message || j.error || 'That did not land; try again.'; err.hidden = false; }
  };
  let dragged = null;
  const clear = () => { for (const x of board.querySelectorAll('.drop-to')) x.classList.remove('drop-to'); };
  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest && e.target.closest('.work-card');
    if (!card) return;
    dragged = card;
    e.dataTransfer.setData('text/plain', card.dataset.key);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  board.addEventListener('dragend', () => { if (dragged) dragged.classList.remove('dragging'); dragged = null; clear(); });
  board.addEventListener('dragover', (e) => {
    const col = e.target.closest && e.target.closest('.work-col');
    if (!col || !dragged) return;
    e.preventDefault();
    clear();
    (e.target.closest('.work-card') || col).classList.add('drop-to');
  });
  board.addEventListener('drop', (e) => {
    const col = e.target.closest && e.target.closest('.work-col');
    if (!col || !dragged) return;
    e.preventDefault();
    const over = e.target.closest('.work-card');
    if (over === dragged) return;
    const from = dragged.closest('.work-col').dataset.horizon;
    const to = col.dataset.horizon;
    let place = 'last';
    if (over) { const r = over.getBoundingClientRect(); place = e.clientY < r.top + r.height / 2 ? { before: over.dataset.key } : { after: over.dataset.key }; }
    send(dragged.dataset.key, to === from ? undefined : to, place);
  });
  board.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button[data-place]');
    if (!b) return;
    const card = b.closest('.work-card');
    const up = b.dataset.place === 'up';
    const next = up ? card.previousElementSibling : card.nextElementSibling;
    if (!next || !next.classList.contains('work-card')) return;
    send(card.dataset.key, undefined, up ? { before: next.dataset.key } : { after: next.dataset.key });
  });
})();
`;

export const WORK_VIEWS_CSS = `
.work-board{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;align-items:start}
.work-col{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--line);border-radius:var(--r-l);background:var(--sunken);min-height:80px}
.work-col.drop-to{border-color:var(--accent)}
.work-col h3{display:flex;justify-content:space-between;margin:0 2px 2px;font-size:13px;font-weight:600}
.work-col h3 .n{font:500 var(--fs-xs) var(--mono);color:var(--faint)}
.work-card{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-m);background:var(--panel)}
.work-card[draggable=true]{cursor:grab}
.work-card.dragging{opacity:.5}
.work-card.drop-to{border-color:var(--accent)}
.work-card:hover{border-color:var(--line2)}
.work-card.overdue{border-color:var(--bad-line)}
.work-card a{display:flex;flex-direction:column;gap:6px;color:inherit;text-decoration:none}
.work-card .ref{font:600 var(--fs-xs) var(--mono);color:var(--muted)}
.work-card b{font-weight:600;font-size:13.5px}
.work-card .pill{align-self:flex-start}
.work-card .sub{font-size:12px;color:var(--muted)}
.work-card-move{display:flex;gap:4px}
.work-gantt{display:flex;flex-direction:column;gap:4px}
.work-gantt-row{display:grid;grid-template-columns:minmax(160px,1.2fr) 3fr 96px 180px;gap:12px;align-items:center;padding:6px 10px;border:1px solid var(--line);border-radius:var(--r-m);background:var(--panel);color:inherit;text-decoration:none}
.work-gantt-head{background:var(--sunken)}
.work-gantt-head .track{height:22px}
.work-gantt-row .lbl{display:flex;gap:8px;align-items:baseline;min-width:0}
.work-gantt-row .lbl b{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.work-gantt-row .ref,.work-gantt-row time{font:500 var(--fs-xs) var(--mono);color:var(--muted)}
.work-gantt-row .ref{white-space:nowrap}
.work-gantt-row .pill{justify-self:start}
.work-gantt-row .track{position:relative;height:18px;border-bottom:1px solid var(--line)}
.work-bar{position:absolute;top:3px;height:12px;left:var(--at);width:max(var(--w),4px);border-radius:var(--r-s);background:var(--accent)}
.work-bar.parts{background:transparent;border:2px solid var(--accent)}
.work-pt{position:absolute;top:3px;width:12px;height:12px;margin-left:-6px;left:var(--at);border-radius:50%;background:var(--accent)}
.work-ms-line{position:absolute;top:-6px;bottom:-6px;left:var(--at);border-left:1px dashed var(--warn-ink)}
.work-ms{position:absolute;top:0;left:var(--at);display:flex;gap:4px;align-items:center;white-space:nowrap;font:500 var(--fs-xs) var(--mono);color:var(--muted);text-decoration:none}
.work-ms.left{flex-direction:row-reverse;transform:translateX(-100%)}
.work-ms.left .work-ms-dot{margin:0 -5px 0 0}
.work-ms-dot{width:10px;height:10px;margin-left:-5px;transform:rotate(45deg);background:var(--warn-ink)}
@media (max-width:640px){.work-gantt-row,.work-gantt-head{grid-template-columns:1fr}}
`;

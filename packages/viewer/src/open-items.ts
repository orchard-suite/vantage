/**
 * The open items section of the inspector: what is open against a bound
 * box right now, worst first, each with a link to where its source shows
 * it. An item whose last report is past the freshness threshold dims.
 */
import type { BundleOpenItem } from './bundle.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { ago } from './hub.ts';

const KIND: Readonly<Record<BundleOpenItem['kind'], string>> = { issue: 'Issue', alert: 'Alert', pr: 'Pull request', incident: 'Incident' };

function row(i: BundleOpenItem): HTMLLIElement {
  const li = h('li', `v-open-item${i.stale ? ' stale' : ''}`);
  const dot = h('span', `v-sev v-sev-${i.severity ?? 'info'}`);
  dot.title = i.severity ?? 'no severity';
  dot.setAttribute('aria-label', `severity ${i.severity ?? 'none'}`);
  const words = h('div', 'v-open-words');
  if (i.url) {
    const a = h('a', 'v-open-title');
    a.href = i.url;
    a.append(h('span', undefined, i.title), icon('open', 12));
    if (/^https?:/.test(i.url)) {
      a.target = '_blank';
      a.rel = 'noopener';
    }
    words.appendChild(a);
  } else words.appendChild(h('span', 'v-open-title', i.title));
  const meta = [KIND[i.kind], i.status, i.source].filter(Boolean).join(' · ');
  const line = h('span', 'v-open-meta', meta);
  const when = i.updated ?? i.observed;
  const time = h('time', undefined, ` · ${i.stale ? `last reported ${ago(i.observed)}` : ago(when)}`);
  time.dateTime = i.stale ? i.observed : when;
  time.title = time.dateTime;
  line.appendChild(time);
  words.appendChild(line);
  li.append(dot, words);
  return li;
}

/** Adds the section to the panel when the box has anything open. */
export function renderOpenItems(host: HTMLElement, items: readonly BundleOpenItem[] | undefined): void {
  if (!items?.length) return;
  const s = h('section', 'v-sec');
  const head = h('h4', 'v-sec-h', 'Open');
  head.appendChild(h('span', 'n', String(items.length)));
  const list = h('ul', 'v-open-list');
  for (const i of items) list.appendChild(row(i));
  s.append(head, list);
  host.appendChild(s);
}

export const OPEN_STYLES = `
.v-open-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px}
.v-open-item{display:flex;align-items:flex-start;gap:9px}
.v-open-item.stale{opacity:.55}
.v-sev{width:8px;height:8px;border-radius:50%;flex:none;margin-top:6px;background:var(--sev-info)}
.v-sev-critical{background:var(--sev-critical)}.v-sev-high{background:var(--sev-high)}.v-sev-medium{background:var(--sev-medium)}.v-sev-low{background:var(--sev-low)}
.v-open-words{display:flex;flex-direction:column;min-width:0}
.v-open-title{font-weight:500;color:var(--ink);overflow-wrap:anywhere;text-decoration:none;display:inline-flex;gap:5px;align-items:baseline}
a.v-open-title:hover{color:var(--accent-ink);text-decoration:underline}
.v-open-meta{font-size:var(--fs-s);color:var(--muted)}
.v-open-meta time{font-family:var(--mono);font-size:var(--fs-s)}
`;

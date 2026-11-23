/**
 * The inspector for a selected box: what it is, what it carries, what it
 * talks to, where it comes from, and where else it appears. A side sheet
 * on a wide screen, a bottom sheet on a phone.
 */
import type { Bundle, BundleBox, BundleView } from './bundle.ts';
import { formatRoute } from './router.ts';
import { button, h, iconButton } from './dom.ts';
import { icon } from './icons.ts';
import { ago } from './hub.ts';
import { renderOpenItems } from './open-items.ts';

export interface PanelActions {
  readonly select: (id: string) => void;
  /** For a group: open or shut it where it stands, or zoom into it alone. */
  readonly reshape: { readonly toggle: () => void; readonly zoom: () => void } | undefined;
  readonly close: () => void;
}

function section(host: HTMLElement, title: string, count?: number): HTMLElement {
  const s = h('section', 'v-sec');
  const head = h('h4', 'v-sec-h', title);
  if (count !== undefined) head.appendChild(h('span', 'n', String(count)));
  s.appendChild(head);
  host.appendChild(s);
  return s;
}

function external(href: string, text: string, cls: string): HTMLAnchorElement {
  const a = h('a', cls);
  a.href = href;
  a.append(h('span', undefined, text), icon('open', 13));
  if (/^https?:/.test(href)) {
    a.target = '_blank';
    a.rel = 'noopener';
  }
  return a;
}

/** Copies the box id, the name a YAML file or an agent uses for it, and says so for a moment. */
function copyId(id: string): HTMLButtonElement {
  const label = h('span', undefined, 'Copy id');
  const b = button('', () => {
    void navigator.clipboard?.writeText(id).then(() => {
      label.textContent = 'Copied';
      b.replaceChild(icon('check'), b.firstChild!);
      setTimeout(() => {
        label.textContent = 'Copy id';
        b.replaceChild(icon('copy'), b.firstChild!);
      }, 1600);
    });
  }, `Copy the id ${id}`, 'v-btn v-btn-soft');
  b.title = id;
  b.append(icon('copy'), label);
  return b;
}

export function renderPanel(host: HTMLElement, bundle: Bundle, b: BundleBox, view: BundleView, actions: PanelActions): void {
  host.replaceChildren();
  host.setAttribute('aria-labelledby', 'v-panel-name');
  const grip = h('button', 'grip');
  grip.type = 'button';
  host.appendChild(grip);
  const head = h('div', 'v-panel-head');
  const inside = view.boxes.filter((x) => x.parentId === b.id).length;
  const eyebrow = [b.type, b.kind === 'collapsed' ? 'collapsed' : b.kind === 'container' && inside ? `${inside} inside` : undefined].filter(Boolean).join(' · ');
  const titles = h('div', 'v-panel-titles');
  if (eyebrow) titles.appendChild(h('div', 'v-eyebrow', eyebrow));
  const name = h('h3', 'v-panel-name', b.name);
  name.id = 'v-panel-name';
  titles.appendChild(name);
  if (b.subtitle) titles.appendChild(h('div', 'v-panel-sub', b.subtitle));
  head.append(titles, iconButton('close', 'Close details (Esc)', actions.close, 'v-btn v-icon-btn v-quiet'));
  host.appendChild(head);

  {
    const row = h('div', 'v-panel-actions');
    if (actions.reshape) {
      const shown = b.kind === 'container';
      const toggle = button('', actions.reshape.toggle, shown ? `Fold ${b.name} to one box, keeping the rest as it is` : `Open ${b.name} here, keeping the rest as it is`, 'v-btn v-btn-soft');
      toggle.append(icon(shown ? 'minus' : 'plus'), h('span', undefined, shown ? 'Collapse' : 'Expand'));
      const zoom = button('', actions.reshape.zoom, `Show ${b.name} open on its own, the rest folded (Z)`, 'v-btn v-btn-soft');
      zoom.append(icon('enter'), h('span', undefined, 'Zoom in'));
      row.append(toggle, zoom);
    }
    if (b.url) row.appendChild(external(b.url, 'Open link', 'v-btn v-btn-soft'));
    row.appendChild(copyId(b.id));
    host.appendChild(row);
  }
  if (b.value !== undefined) host.appendChild(h('div', 'v-value', b.value));
  if (b.description) host.appendChild(h('p', 'v-desc', b.description));
  if (b.note) host.appendChild(h('div', 'v-note', b.note));

  renderOpenItems(host, b.openItems);
  if (b.facts?.length) {
    const s = section(host, 'Facts');
    const dl = h('dl', 'v-facts');
    for (const f of b.facts) {
      if (f.label) {
        dl.append(h('dt', undefined, f.label), h('dd', undefined, f.value));
      } else {
        dl.appendChild(h('dd', 'wide', f.value));
      }
    }
    s.appendChild(dl);
  }
  if (b.bullets?.length) {
    const s = section(host, 'Notes');
    const ul = h('ul', 'v-bullets');
    for (const t of b.bullets) ul.appendChild(h('li', undefined, t));
    s.appendChild(ul);
  }
  const pinned = (view.annotations ?? []).filter((a) => a.at === b.id);
  if (pinned.length) {
    const s = section(host, 'Callouts');
    for (const a of pinned) s.appendChild(h('p', 'v-callout', a.text));
  }

  const nameOf = (id: string): string => view.boxes.find((x) => x.id === id)?.name ?? id;
  const outs = view.edges.filter((x) => x.from === b.id);
  const ins = view.edges.filter((x) => x.to === b.id);
  if (outs.length || ins.length) {
    const s = section(host, 'Connections', outs.length + ins.length);
    const list = h('ul', 'v-rels');
    const row = (to: string, label: string | undefined, out: boolean): void => {
      const li = h('li');
      const btn = button('', () => actions.select(to), `${out ? 'To' : 'From'} ${nameOf(to)}${label ? `, ${label}` : ''}`, 'v-rel');
      const arrow = h('span', `v-rel-dir ${out ? 'out' : 'in'}`, out ? '→' : '←');
      arrow.setAttribute('aria-hidden', 'true');
      const words = h('span', 'v-rel-words');
      words.appendChild(h('span', 'v-rel-name', nameOf(to)));
      if (label) words.appendChild(h('span', 'v-rel-label', label));
      btn.append(arrow, words);
      li.appendChild(btn);
      list.appendChild(li);
    };
    for (const e of outs) row(e.to, e.label, true);
    for (const e of ins) row(e.from, e.label, false);
    s.appendChild(list);
  }
  // Hub mode fills this with what the hub knows about the box, such as the decisions that govern it.
  host.appendChild(h('div', 'v-panel-hub'));

  if (b.source || b.observed) {
    const s = section(host, 'Source');
    const line = h('p', 'v-source');
    if (b.source) line.append('From ', h('b', undefined, b.source));
    if (b.observed) {
      const when = h('time', undefined, ago(b.observed));
      when.dateTime = b.observed;
      when.title = b.observed;
      line.append(b.source ? ', observed ' : 'Observed ', when);
    }
    s.appendChild(line);
  }

  const pages = bundle.views.filter((v) => v.doc?.nodes.includes(b.id));
  if (pages.length) {
    const s = section(host, 'Written about in', pages.length);
    const row = h('div', 'v-also');
    for (const v of pages) {
      const a = h('a', 'v-chip', v.title);
      a.href = formatRoute({ view: v.id, node: b.id });
      row.appendChild(a);
    }
    s.appendChild(row);
  }

  const others = bundle.views.filter((v) => v.id !== view.id && v.kind !== 'walkthrough' && v.boxes.some((x) => x.id === b.id));
  if (others.length) {
    const s = section(host, 'Also in', others.length);
    const row = h('div', 'v-also');
    for (const v of others) {
      const a = h('a', 'v-chip', v.title);
      a.href = formatRoute({ view: v.id, node: b.id });
      row.appendChild(a);
    }
    s.appendChild(row);
  }
  host.classList.add('show');
}

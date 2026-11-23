/**
 * The sidebar picker: a tree of folding groups with the views inside. Fold
 * state is remembered per document in localStorage. Parts (hidden views)
 * are left out until the reader turns them on, then drawn dimmed.
 */
import { pickerTree, type BundleView, type PickerGroup } from './bundle.ts';
import { h } from './dom.ts';
import { formatRoute } from './router.ts';
import { icon } from './icons.ts';
import { recall, remember } from './storage.ts';

export interface PickerState {
  readonly currentId?: string | undefined;
  readonly filter: string;
  readonly parts: boolean;
  readonly badges: Readonly<Record<string, number>>;
}

export class Picker {
  private closed = new Set<string>();
  private q = '';

  constructor(
    readonly el: HTMLElement,
    private readonly storageKey: string,
    private readonly onPick: (view: BundleView, node?: string) => void,
  ) {
    const saved = recall(storageKey);
    if (saved) {
      try {
        this.closed = new Set(JSON.parse(saved) as string[]);
      } catch {
        this.closed = new Set();
      }
    }
  }

  render(views: readonly BundleView[], state: PickerState): void {
    this.el.replaceChildren();
    const q = state.filter.trim().toLowerCase();
    const matches = (v: BundleView): boolean => !q || v.title.toLowerCase().includes(q) || this.hit(v, q) !== undefined;
    this.q = q;
    const tree = pickerTree(views, state.parts);
    const single = tree.length === 1 && tree[0]!.groups.length === 0;
    for (const g of tree) this.renderGroup(g, this.el, state, matches, Boolean(q), single ? 'flat' : 0);
    if (q && !this.el.childElementCount) {
      const none = h('p', 'v-picker-empty', `No view, box, or heading matches “${state.filter.trim()}”.`);
      none.setAttribute('role', 'status');
      this.el.appendChild(none);
    }
  }

  private renderGroup(g: PickerGroup, into: HTMLElement, state: PickerState, matches: (v: BundleView) => boolean, searching: boolean, depth: number | 'flat'): void {
    const items = g.views.filter(matches);
    const kids = g.groups.filter((k) => this.hasMatch(k, matches));
    if (!items.length && !kids.length) return;
    if (depth === 'flat') {
      const head = h('div', 'v-group', g.name);
      into.appendChild(head);
      for (const v of items) into.appendChild(this.item(v, state));
      return;
    }
    const fold = document.createElement('details');
    fold.className = 'v-fold';
    fold.style.setProperty('--depth', String(depth));
    fold.open = searching || !this.closed.has(g.path);
    const summary = document.createElement('summary');
    summary.className = 'v-group';
    summary.textContent = g.name;
    const count = this.count(g, matches);
    summary.appendChild(h('span', 'n', String(count)));
    fold.appendChild(summary);
    fold.addEventListener('toggle', () => {
      if (searching) return;
      if (fold.open) this.closed.delete(g.path);
      else this.closed.add(g.path);
      this.save();
    });
    for (const v of items) fold.appendChild(this.item(v, state));
    for (const k of kids) this.renderGroup(k, fold, state, matches, searching, depth + 1);
    into.appendChild(fold);
  }

  private item(v: BundleView, state: PickerState): HTMLElement {
    const active = v.id === state.currentId;
    const item = h('a', 'v-item' + (active ? ' active' : '') + (v.hidden ? ' part' : ''));
    item.dataset['view'] = v.id;
    item.href = formatRoute({ view: v.id });
    if (active) item.setAttribute('aria-current', 'page');
    const title = h('span', 'v-item-title', v.title);
    title.title = v.title;
    item.appendChild(title);
    const kind = v.hidden ? 'part' : v.kind !== 'relation' ? v.kind : undefined;
    if (kind) {
      const glyph = h('span', 'v-kind');
      glyph.title = kind === 'part' ? 'Part: a view other views build on' : `${kind[0]!.toUpperCase()}${kind.slice(1)} view`;
      glyph.appendChild(icon(kind));
      item.appendChild(glyph);
      item.setAttribute('aria-description', glyph.title);
    }
    const open = state.badges[v.id];
    if (open) {
      const badge = h('span', 'v-count', String(open));
      badge.title = `${open} open comment${open === 1 ? '' : 's'}`;
      item.appendChild(badge);
    }
    // When the search matched a node rather than the title, say which, and open the view on it.
    const hit = this.q && !v.title.toLowerCase().includes(this.q) ? this.hit(v, this.q) : undefined;
    if (hit) item.appendChild(h('span', 'hit', `Has ${hit.name}`));
    item.addEventListener('click', (e) => {
      e.preventDefault();
      this.onPick(v, hit?.id);
    });
    return item;
  }

  /** What in a view the search text names: a box of a picture, or a heading of a page. */
  private hit(v: BundleView, q: string): { id: string; name: string } | undefined {
    const box = v.boxes.find((b) => b.name.toLowerCase().includes(q));
    if (box) return box;
    const heading = v.doc?.headings.find((x) => x.text.toLowerCase().includes(q));
    return heading ? { id: heading.id, name: heading.text } : undefined;
  }

  /** Marks the active item without rebuilding the tree, so folds keep their state. */
  setActive(id: string | undefined): void {
    for (const el of this.el.querySelectorAll<HTMLElement>('.v-item')) {
      const on = el.dataset['view'] === id;
      el.classList.toggle('active', on);
      if (on) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    }
    const active = this.el.querySelector<HTMLElement>('.v-item.active');
    let fold = active?.parentElement;
    while (fold) {
      if (fold instanceof HTMLDetailsElement) fold.open = true;
      fold = fold.parentElement;
    }
    active?.scrollIntoView({ block: 'nearest' });
  }

  private hasMatch(g: PickerGroup, matches: (v: BundleView) => boolean): boolean {
    return g.views.some(matches) || g.groups.some((k) => this.hasMatch(k, matches));
  }

  private count(g: PickerGroup, matches: (v: BundleView) => boolean): number {
    return g.views.filter(matches).length + g.groups.reduce((n, k) => n + this.count(k, matches), 0);
  }

  private save(): void {
    remember(this.storageKey, JSON.stringify([...this.closed]));
  }
}

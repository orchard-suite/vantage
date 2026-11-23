/**
 * The overview: the document's own page. It leads with the document's name
 * and description, then shows every view as a card with its picture and
 * the question it answers, in the picker's groups. It opens at the bare
 * route (`#`) and covers the stage; a card opens its view.
 */
import { hasOverview, pickerTree, type Bundle, type BundleView, type PickerGroup } from './bundle.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { formatRoute } from './router.ts';
import { docMeta } from './sidebar.ts';

export interface OverviewHost {
  readonly area: HTMLElement;
  /** The root element, where the overview's class goes. */
  readonly root: HTMLElement;
  bundle(): Bundle;
  /** A box's name by its id, drawn or not. */
  name(id: string): string | undefined;
  /** Whether the document has an overview, and whether it is open, for the sidebar's link. */
  marked(has: boolean, open: boolean): void;
}

/** The groups of the picker as flat sections: "Copilot / Governance" is one heading. */
function sections(groups: readonly PickerGroup[]): { name: string; views: BundleView[] }[] {
  return groups.flatMap((g) => [...(g.views.length ? [{ name: g.path, views: g.views }] : []), ...sections(g.groups)]);
}

/** The picture a card shows: the view's own, or the one a page is read beside. Pages without one show a glyph. */
function pictureOf(view: BundleView, views: readonly BundleView[]): BundleView | undefined {
  const pic = view.kind === 'doc' && view.beside !== undefined ? views.find((v) => v.id === view.beside) : view;
  return pic && pic.kind !== 'doc' && pic.svg ? pic : undefined;
}

export class Overview {
  readonly el: HTMLElement;
  private readonly page: HTMLElement;
  /** The bundle the page was last built from; a newer one rebuilds it the next time it shows. */
  private built: Bundle | undefined;
  private shown = false;

  constructor(private readonly host: OverviewHost) {
    this.el = h('div', 'v-ov');
    this.el.tabIndex = 0;
    this.el.setAttribute('role', 'document');
    this.page = h('div', 'v-ov-page');
    this.el.appendChild(this.page);
    host.area.appendChild(this.el);
  }

  get open(): boolean {
    return this.shown;
  }

  /**
   * Follows the route: the bare route opens the page when the document has
   * one. The page is built only while it shows, again when a newer bundle
   * arrives, and keeps its place while the bundle stays.
   */
  follow(bare: boolean): void {
    const bundle = this.host.bundle();
    const has = hasOverview(bundle);
    const on = bare && has;
    const opening = on && !this.shown;
    this.shown = on;
    this.host.root.classList.toggle('v-overviewing', on);
    if (on && this.built !== bundle) this.render(bundle);
    if (opening) this.el.scrollTop = 0;
    this.host.marked(has, on);
  }

  private render(bundle: Bundle): void {
    this.built = bundle;
    const head = h('header', 'v-ov-head');
    head.appendChild(h('h1', 'v-ov-title', bundle.title));
    const meta = docMeta(bundle);
    if (meta) head.appendChild(h('p', 'v-ov-meta', meta));
    const parts: HTMLElement[] = [head];
    if (bundle.description) parts.push(this.description(bundle));
    const groups = sections(pickerTree(bundle.views));
    const count = groups.reduce((n, g) => n + g.views.length, 0);
    parts.push(h('p', 'v-ov-count', `${count} ${count === 1 ? 'view' : 'views'} in this document`));
    for (const g of groups) {
      const section = h('section', 'v-ov-section');
      if (groups.length > 1 || g.name !== 'Views') section.appendChild(h('h2', 'v-ov-group', g.name));
      const grid = h('div', 'v-ov-grid');
      for (const v of g.views) grid.appendChild(this.card(v, bundle.views));
      section.appendChild(grid);
      parts.push(section);
    }
    this.page.replaceChildren(...parts);
  }

  /** The description as the page's prose. A bundle stored before it carried HTML shows the words as written. */
  private description(bundle: Bundle): HTMLElement {
    const prose = h('div', 'v-prose v-ov-desc');
    if (bundle.descriptionHtml === undefined) {
      for (const para of (bundle.description ?? '').split(/\n\s*\n/)) prose.appendChild(h('p', undefined, para.trim()));
      return prose;
    }
    prose.innerHTML = bundle.descriptionHtml;
    // A box the description names reads as its name and opens the first picture that draws it.
    for (const a of prose.querySelectorAll<HTMLAnchorElement>('a.v-ref')) {
      const id = a.dataset['node']!;
      if (!a.textContent) a.textContent = this.host.name(id) ?? id;
      const home = bundle.views.find((v) => v.kind !== 'doc' && v.kind !== 'walkthrough' && v.boxes.some((b) => b.id === id));
      if (home) a.href = formatRoute({ view: home.id, node: id });
      else a.classList.add('plain');
    }
    return prose;
  }

  private card(view: BundleView, views: readonly BundleView[]): HTMLElement {
    const card = h('a', 'v-ov-card');
    card.href = formatRoute({ view: view.id });
    const thumb = h('div', 'v-ov-thumb');
    const pic = pictureOf(view, views);
    if (pic) {
      const img = h('img');
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pic.svg)}`;
      thumb.appendChild(img);
    } else thumb.appendChild(icon('doc', 28));
    const words = h('div', 'v-ov-words');
    const title = h('div', 'v-ov-name');
    title.appendChild(h('span', undefined, view.title));
    if (view.kind !== 'relation') {
      const kind = h('span', 'v-ov-kind', view.kind);
      kind.prepend(icon(view.kind, 12));
      title.appendChild(kind);
    }
    words.appendChild(title);
    if (view.question) words.appendChild(h('p', 'v-ov-q', view.question));
    card.append(thumb, words);
    return card;
  }
}

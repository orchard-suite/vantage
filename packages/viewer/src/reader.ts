/**
 * The reader: a doc view's page. The page names boxes and views by id and
 * the reader fills them in from the bundle on the page: a box becomes a
 * chip with its name, a view becomes a figure of its picture, and a link
 * goes where the viewer's routes go. Beside a view, the boxes a passage
 * names light up on the stage as the passage is read, and a box picked on
 * the stage marks its mentions in the prose.
 */
import type { BundleBox, BundleView } from './bundle.ts';
import { button, h } from './dom.ts';
import { icon } from './icons.ts';
import { formatRoute } from './router.ts';
import { Tip } from './tip.ts';

export interface ReaderHost {
  readonly area: HTMLElement;
  /** The root element, where the reading classes go. */
  readonly root: HTMLElement;
  views(): readonly BundleView[];
  /** A box's name by its id, drawn or not. */
  name(id: string): string | undefined;
  /** The picture on the stage while a page is read beside a view. */
  drawn(): BundleView | undefined;
  /** Selects a box on the stage. */
  select(id: string): void;
  /** Lights boxes on the stage and frames them; undefined lights everything. */
  light(ids: readonly string[] | undefined): void;
  narrow(): boolean;
  /** The reader took or gave back room: the stage frames its picture again. */
  resized(): void;
}

interface Section {
  readonly el: HTMLElement | undefined;
  readonly nodes: string[];
  top: number;
}

/** How far down the reader a heading counts as the one being read: a third of the way, and never less than this. */
const READ_LINE = 96;
const READ_SHARE = 0.34;

function attr(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

export class Reader {
  readonly el: HTMLElement;
  private readonly scroll: HTMLElement;
  private readonly page: HTMLElement;
  private readonly toc: HTMLElement;
  private readonly list: HTMLElement;
  private readonly find: HTMLInputElement;
  private readonly tip: Tip;
  private view: BundleView | undefined;
  private html: string | undefined;
  private beside = false;
  private sections: Section[] = [];
  private current = -1;
  private lit = '';
  private frame = 0;

  constructor(private readonly host: ReaderHost) {
    this.el = h('div', 'v-read');
    this.scroll = h('div', 'v-read-scroll');
    this.scroll.tabIndex = 0;
    this.scroll.setAttribute('role', 'document');
    this.page = h('article', 'v-read-page');
    this.scroll.appendChild(this.page);
    this.toc = h('nav', 'v-read-toc');
    this.toc.setAttribute('aria-label', 'On this page');
    this.find = h('input', 'v-read-find');
    this.find.type = 'search';
    this.find.placeholder = 'Find on this page';
    this.find.setAttribute('aria-label', 'Find a heading on this page');
    this.find.addEventListener('input', () => this.filter());
    this.list = h('div', 'v-read-list');
    this.toc.append(h('h4', undefined, 'On this page'), this.find, this.list);
    this.el.append(this.scroll, this.toc);
    host.area.appendChild(this.el);
    this.tip = new Tip(host.area);
    this.scroll.addEventListener('scroll', () => this.onScroll(), { passive: true });
    new ResizeObserver(() => this.measure()).observe(this.page);
    this.list.addEventListener('click', () => this.el.classList.remove('v-toc-open'));
  }

  get open(): boolean {
    return this.view !== undefined;
  }

  /** The width the reader covers at the stage's left, for the camera. */
  get inset(): number {
    return this.open && this.beside ? this.el.offsetWidth : 0;
  }

  /** Shows a doc view's page, or closes the reader. The same page shown again keeps its place. */
  show(view: BundleView | undefined): void {
    const was = this.inset;
    const doc = view?.kind === 'doc' ? view.doc : undefined;
    this.view = doc ? view : undefined;
    const base = view?.beside !== undefined ? this.host.views().find((v) => v.id === view.beside) : undefined;
    this.beside = Boolean(doc && base && !this.host.narrow());
    this.host.root.classList.toggle('v-reading', this.open);
    this.host.root.classList.toggle('v-reading-beside', this.beside);
    if (!doc || !view) {
      this.html = undefined;
      this.tip.hide();
      if (was) this.host.resized();
      return;
    }
    const key = `${view.id}\n${this.beside}\n${doc.html}`;
    if (key !== this.html) {
      this.html = key;
      this.render(view, base && !this.beside ? base : undefined);
      this.scroll.scrollTop = 0;
    }
    this.fill();
    this.measure();
    if (this.inset !== was) this.host.resized();
  }

  /** Scrolls to a heading by its anchor, else to the first mention of a box. */
  goTo(target: string | undefined): void {
    if (!target || !this.open) return;
    const el = this.page.querySelector<HTMLElement>(`[data-anchor="${attr(target)}"]`) ?? this.page.querySelector<HTMLElement>(`a.v-ref[data-node="${attr(target)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: el.dataset['anchor'] !== undefined ? 'start' : 'center' });
    el.classList.remove('v-flash');
    void el.offsetWidth;
    el.classList.add('v-flash');
  }

  /** Marks the mentions of the box picked on the stage. */
  mark(node: string | undefined): void {
    for (const a of this.page.querySelectorAll<HTMLElement>('a.v-ref')) a.classList.toggle('on', node !== undefined && a.dataset['node'] === node);
  }

  private render(view: BundleView, lead: BundleView | undefined): void {
    const doc = view.doc!;
    const head = h('header', 'v-read-head');
    if (view.group) head.appendChild(h('p', 'v-read-group', view.group));
    const title = h('h1', 'v-read-title', view.title);
    title.id = 'v-view-title';
    head.appendChild(title);
    if (view.question) head.appendChild(h('p', 'v-read-lede', view.question));
    const tocBtn = button('', () => this.el.classList.toggle('v-toc-open'), 'Show the headings of this page', 'v-btn v-read-tocbtn');
    tocBtn.append(icon('notes'), h('span', undefined, 'On this page'));
    head.appendChild(tocBtn);
    const prose = h('div', 'v-prose');
    prose.innerHTML = doc.html || '<p class="v-read-empty">This page has no text yet.</p>';
    // On a phone the view a page is read with leads the page as a figure.
    if (lead) prose.prepend(this.figure(lead.id, undefined, lead.title));
    this.page.replaceChildren(head, prose);
    for (const el of prose.querySelectorAll<HTMLElement>('[data-anchor]')) {
      const a = h('a', 'v-anchor', '#');
      a.href = formatRoute({ view: view.id, node: el.dataset['anchor']! });
      a.setAttribute('aria-label', 'Link to this heading');
      el.appendChild(a);
    }
    this.buildToc(view);
    this.wire(prose);
  }

  private buildToc(view: BundleView): void {
    const hs = (view.doc?.headings ?? []).filter((x) => x.level <= 4);
    const top = Math.min(...hs.map((x) => x.level));
    this.list.replaceChildren(
      ...hs.map((x) => {
        const a = h('a', undefined, x.text);
        a.href = formatRoute({ view: view.id, node: x.id });
        a.dataset['anchor'] = x.id;
        a.title = x.text;
        a.style.setProperty('--depth', String(x.level - top));
        return a;
      }),
    );
    this.el.classList.toggle('v-read-notoc', hs.length < 3);
    this.find.value = '';
    this.find.hidden = hs.length < 12;
  }

  private filter(): void {
    const q = this.find.value.trim().toLowerCase();
    for (const a of this.list.children) (a as HTMLElement).hidden = Boolean(q) && !(a.textContent ?? '').toLowerCase().includes(q);
  }

  /** One figure of a view's picture, opening the view on click. */
  private figure(viewId: string, target: string | undefined, caption: string): HTMLElement {
    const fig = h('figure', 'v-figure');
    fig.dataset['view'] = viewId;
    if (target) fig.dataset['target'] = target;
    const pic = h('a', 'v-figure-pic');
    pic.href = formatRoute({ view: viewId, ...(target ? { node: target } : {}) });
    const cap = h('figcaption');
    cap.appendChild(h('span', undefined, caption));
    const open = h('a', 'v-go', 'Open view');
    open.href = pic.href;
    cap.appendChild(open);
    fig.append(pic, cap);
    return fig;
  }

  private wire(prose: HTMLElement): void {
    for (const span of prose.querySelectorAll<HTMLElement>('span.v-fig')) {
      const fig = this.figure(span.dataset['view']!, span.dataset['target'], span.dataset['caption'] ?? '');
      const p = span.parentElement;
      if (p && p.tagName === 'P' && p.childNodes.length === 1) p.replaceWith(fig);
      else span.replaceWith(fig);
    }
    prose.addEventListener('click', (e) => {
      const ref = (e.target as Element).closest<HTMLElement>('a.v-ref');
      if (!ref) return;
      e.preventDefault();
      const id = ref.dataset['node']!;
      if (this.beside && this.host.drawn()?.boxes.some((b) => b.id === id)) return this.host.select(id);
      const where = this.home(id);
      if (where) location.hash = formatRoute({ view: where.view.id, node: id });
    });
    prose.addEventListener('mouseover', (e) => {
      const ref = (e.target as Element).closest<HTMLElement>('a.v-ref');
      const box = ref ? this.home(ref.dataset['node']!)?.box : undefined;
      const text = box?.description ?? box?.subtitle;
      if (ref && text) this.tip.show(ref, text);
      else this.tip.hide();
    });
    prose.addEventListener('mouseleave', () => this.tip.hide());
  }

  /** The first picture that draws a box, and the box as drawn there. */
  private home(id: string): { view: BundleView; box: BundleBox } | undefined {
    for (const view of this.host.views()) {
      if (view.kind === 'doc' || view.kind === 'walkthrough') continue;
      const box = view.boxes.find((b) => b.id === id);
      if (box) return { view, box };
    }
    return undefined;
  }

  /** Fills chips and figures from the bundle on hand; runs again when a newer bundle arrives. */
  private fill(): void {
    for (const a of this.page.querySelectorAll<HTMLElement>('a.v-ref')) {
      const id = a.dataset['node']!;
      const at = this.home(id);
      if (!a.dataset['words']) a.dataset['words'] = a.textContent ? 'own' : 'name';
      if (a.dataset['words'] === 'name') a.textContent = at?.box.name ?? this.host.name(id) ?? id;
      // A box no picture draws has nowhere to go: it reads as a name.
      a.classList.toggle('plain', !at);
      a.setAttribute('role', 'button');
      a.tabIndex = 0;
    }
    for (const fig of this.page.querySelectorAll<HTMLElement>('figure.v-figure')) {
      const view = this.host.views().find((v) => v.id === fig.dataset['view']);
      const pic = fig.querySelector<HTMLElement>('.v-figure-pic')!;
      const cap = fig.querySelector<HTMLElement>('figcaption span')!;
      if (!view || view.kind === 'doc') {
        pic.replaceChildren(h('span', 'v-fig-missing', `No view has the id ${fig.dataset['view']}`));
        continue;
      }
      if (!cap.textContent) cap.textContent = view.title;
      if (pic.dataset['svg'] === view.svg) continue;
      pic.dataset['svg'] = view.svg;
      pic.innerHTML = view.svg;
      const svg = pic.querySelector('svg');
      svg?.removeAttribute('width');
      svg?.removeAttribute('height');
      svg?.setAttribute('role', 'img');
      svg?.setAttribute('aria-label', view.title);
    }
  }

  /** Where each heading sits, and the boxes named under it. */
  private measure(): void {
    if (!this.open) return;
    const prose = this.page.querySelector<HTMLElement>('.v-prose');
    if (!prose) return;
    const base = this.page.getBoundingClientRect().top;
    const sections: Section[] = [{ el: undefined, nodes: [], top: 0 }];
    for (const el of prose.querySelectorAll<HTMLElement>('[data-anchor], a.v-ref')) {
      if (el.dataset['anchor'] !== undefined) sections.push({ el, nodes: [], top: el.getBoundingClientRect().top - base });
      else if (el.dataset['node']) sections[sections.length - 1]!.nodes.push(el.dataset['node']);
    }
    this.sections = sections;
    this.current = -1;
    this.onScroll();
  }

  private onScroll(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const line = this.scroll.scrollTop + Math.max(READ_LINE, this.scroll.clientHeight * READ_SHARE);
      let lo = 0;
      let hi = this.sections.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (this.sections[mid]!.top <= line) lo = mid;
        else hi = mid - 1;
      }
      if (lo === this.current) return;
      this.current = lo;
      const s = this.sections[lo];
      const anchor = s?.el?.dataset['anchor'];
      for (const a of this.list.children) a.classList.toggle('on', anchor !== undefined && (a as HTMLElement).dataset['anchor'] === anchor);
      this.list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
      if (!this.beside) return;
      const drawn = new Set(this.host.drawn()?.boxes.map((b) => b.id));
      const ids = [...new Set(s?.nodes ?? [])].filter((id) => drawn.has(id));
      const key = ids.join(' ');
      if (key === this.lit) return;
      this.lit = key;
      this.host.light(ids.length ? ids : undefined);
    });
  }
}

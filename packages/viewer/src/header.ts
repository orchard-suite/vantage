/**
 * The chrome around the picture, in three parts:
 * - the app bar (`el`): the view list toggle, the mark, the document's
 *   name, and the document tools (collaborate, present, More); on a phone
 *   it also carries the view's title, so the card over the stage is only
 *   the question;
 * - the view card (`card`), floating over the stage: where the reader is
 *   (a crumb when a container is open), the view's title, its question,
 *   and the notes behind a button;
 * - the toolbar (`toolbar`), floating at the stage's foot: zoom, fit, the
 *   detail steps, the theme, and the shortcuts.
 */
import { button, h, iconButton } from './dom.ts';
import { icon, type IconName } from './icons.ts';
import { markSvg } from '../../render/src/kit.ts';
import { ZOOM_STEP } from './wheel.ts';

export interface HeaderActions {
  readonly fit: () => void;
  readonly zoom: (factor: number) => void;
  readonly present: () => void;
  readonly theme: () => void;
  readonly download: () => void;
  readonly actualSize: () => void;
  readonly help: () => void;
}

export interface HeaderView {
  readonly title: string;
  readonly question?: string | undefined;
  readonly notes?: string | undefined;
  /** Set while a container is open in place: the way back and the container's name. */
  readonly crumb?: { readonly back: string; readonly href: string; readonly name: string } | undefined;
  readonly score?: { readonly score: number; readonly notes: readonly string[] } | undefined;
}

export class Header {
  readonly el: HTMLElement;
  readonly tools: HTMLElement;
  readonly card: HTMLElement;
  readonly toolbar: HTMLElement;
  private readonly docTitle: HTMLElement;
  private readonly docMeta: HTMLElement;
  private readonly docStatus: HTMLElement;
  /** The view's title and the way back out of an opened container, in the app bar on a phone. */
  private readonly viewLine: HTMLElement;
  private readonly brand: HTMLElement;
  private readonly crumb: HTMLElement;
  private readonly title: HTMLElement;
  private readonly lede: HTMLElement;
  private readonly question: HTMLElement;
  private readonly expand: HTMLButtonElement;
  private readonly notesBtn: HTMLButtonElement;
  private readonly notes: HTMLElement;
  private readonly presentBtn: HTMLButtonElement;
  private readonly moreBtn: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private readonly themeBtn: HTMLButtonElement;
  private readonly themeItem: HTMLButtonElement;
  private readonly scoreItem: HTMLElement;

  constructor(menuBtn: HTMLButtonElement, detail: HTMLElement, private readonly actions: HeaderActions) {
    this.el = h('header', 'v-head');
    this.brand = h('span', 'v-brand');
    this.brand.innerHTML = markSvg(24, 'vb');
    const doc = h('div', 'v-docbar');
    this.docTitle = h('h1', 'v-doc-title');
    this.docMeta = h('span', 'v-doc-meta');
    this.docStatus = h('span', 'v-doc-status');
    this.docStatus.setAttribute('role', 'status');
    this.docStatus.hidden = true;
    this.viewLine = h('div', 'v-view-line');
    doc.append(this.docTitle, this.docStatus, this.docMeta, this.viewLine);
    this.card = h('section', 'v-viewcard');
    this.card.setAttribute('aria-labelledby', 'v-view-title');
    const titles = h('div', 'v-titles');
    this.crumb = h('nav', 'v-crumb');
    this.crumb.setAttribute('aria-label', 'Opened container');
    this.title = h('h2', 'v-title');
    this.title.id = 'v-view-title';
    this.lede = h('div', 'v-lede');
    this.question = h('p', 'v-question');
    this.expand = button('More', () => this.toggleQuestion(), 'Show the whole question', 'v-link v-expand');
    this.notesBtn = h('button', 'v-link v-notes-btn');
    this.notesBtn.type = 'button';
    this.notesBtn.append(icon('notes', 14), h('span', undefined, 'Notes'));
    this.notesBtn.setAttribute('aria-expanded', 'false');
    this.notesBtn.addEventListener('click', () => this.toggleNotes());
    this.notes = h('div', 'v-notes');
    this.notes.id = 'v-notes';
    this.notes.setAttribute('role', 'region');
    this.notes.setAttribute('aria-label', 'Notes on this view');
    this.notesBtn.setAttribute('aria-controls', this.notes.id);
    this.lede.append(this.question, this.expand, this.notesBtn);
    new ResizeObserver(() => this.measureQuestion()).observe(this.question);
    titles.append(this.crumb, this.title, this.lede);

    this.tools = h('div', 'v-tools');
    this.tools.setAttribute('role', 'toolbar');
    this.tools.setAttribute('aria-label', 'Document tools');
    this.toolbar = h('div', 'v-toolbar');
    this.toolbar.setAttribute('role', 'toolbar');
    this.toolbar.setAttribute('aria-label', 'View tools');
    const zoom = h('div', 'v-zoom');
    zoom.append(
      iconButton('minus', 'Zoom out (−)', () => actions.zoom(1 / ZOOM_STEP), 'v-btn v-icon-btn v-quiet'),
      iconButton('fit', 'Fit the view (F)', () => actions.fit(), 'v-btn v-icon-btn v-quiet v-keep'),
      iconButton('plus', 'Zoom in (+)', () => actions.zoom(ZOOM_STEP), 'v-btn v-icon-btn v-quiet'),
    );
    this.themeBtn = iconButton('moon', 'Dark theme', actions.theme, 'v-btn v-icon-btn v-quiet v-keep');
    const helpBtn = iconButton('keyboard', 'Keyboard shortcuts (?)', actions.help, 'v-btn v-icon-btn v-quiet v-help-btn');
    this.toolbar.append(zoom, h('span', 'v-sep'), detail, h('span', 'v-sep v-sep-detail'), this.themeBtn, helpBtn);
    this.presentBtn = iconButton('present', 'Present full screen (P)', () => actions.present(), 'v-btn v-present-btn', 'Present');
    this.moreBtn = iconButton('more', 'More', () => this.toggleMenu(), 'v-btn v-icon-btn v-keep');
    this.moreBtn.setAttribute('aria-haspopup', 'menu');
    this.moreBtn.setAttribute('aria-expanded', 'false');
    this.menu = h('div', 'v-menu');
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', 'More');
    // A phone keeps Present, Fit, and the theme here instead of in the crowded header and over the picture.
    this.item('present', 'Present', actions.present, 'P').classList.add('v-narrow-only');
    this.item('fit', 'Fit the view', actions.fit, 'F').classList.add('v-narrow-only');
    this.themeItem = this.item('moon', 'Dark theme', actions.theme);
    this.themeItem.classList.add('v-narrow-only');
    this.item('download', 'Download as SVG', actions.download);
    this.item('actual', 'Actual size', actions.actualSize);
    this.item('keyboard', 'Keyboard shortcuts', actions.help, '?');
    this.scoreItem = h('div', 'v-menu-info');
    this.menu.appendChild(this.scoreItem);
    this.menu.addEventListener('keydown', (e) => this.menuKey(e));
    const more = h('div', 'v-more');
    more.append(this.moreBtn, this.menu);
    this.tools.append(this.presentBtn, more);
    this.el.append(menuBtn, this.brand, doc, this.tools);
    this.card.append(titles, this.notes);
    document.addEventListener('click', (e) => {
      if (!more.contains(e.target as Node)) this.closeMenu();
      if (!this.notes.contains(e.target as Node) && !this.notesBtn.contains(e.target as Node)) this.closeNotes();
    });
  }

  private item(name: IconName, label: string, fn: () => void, key?: string): HTMLButtonElement {
    const b = h('button', 'v-menu-item');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.tabIndex = -1;
    b.append(icon(name), h('span', undefined, label));
    if (key) b.appendChild(h('kbd', undefined, key));
    b.addEventListener('click', () => {
      this.closeMenu(true);
      fn();
    });
    this.menu.appendChild(b);
    return b;
  }

  set(v: HeaderView): void {
    // Inside an opened container the title is the container; the crumb leads back to the view.
    this.title.textContent = v.crumb?.name ?? v.title;
    this.crumb.replaceChildren();
    this.crumb.classList.toggle('show', v.crumb !== undefined);
    if (v.crumb) {
      const back = h('a', 'v-crumb-back');
      back.href = v.crumb.href;
      back.append(icon('back', 14), h('span', undefined, v.crumb.back));
      back.title = `Back to ${v.crumb.back} (Esc)`;
      this.crumb.append(back, h('span', 'v-crumb-sep', '/'));
    }
    this.viewLine.replaceChildren();
    if (v.crumb) {
      const back = h('a', 'v-view-back');
      back.href = v.crumb.href;
      back.title = `Back to ${v.crumb.back}`;
      back.setAttribute('aria-label', back.title);
      back.appendChild(icon('back', 16));
      this.viewLine.appendChild(back);
    }
    this.viewLine.appendChild(h('span', 'v-view-name', v.crumb?.name ?? v.title));
    this.question.textContent = v.question ?? '';
    this.question.classList.remove('full');
    this.lede.classList.toggle('empty', !v.question && !v.notes);
    this.question.hidden = !v.question;
    this.notesBtn.hidden = !v.notes;
    this.notes.replaceChildren();
    if (v.notes) this.notes.appendChild(h('div', 'v-notes-body', v.notes));
    this.closeNotes();
    this.scoreItem.replaceChildren();
    this.scoreItem.hidden = !v.score;
    if (v.score) {
      this.scoreItem.append(h('span', undefined, 'Layout score'), h('b', undefined, String(v.score.score)));
      this.scoreItem.title = v.score.notes.length ? v.score.notes.join('\n') : 'No layout notes';
    }
    this.expand.textContent = 'More';
    this.expand.title = 'Show the whole question';
    this.measureQuestion();
  }

  /** The More link only shows when the question is longer than its clamp; a hidden card measures again when it shows. */
  private measureQuestion(): void {
    const q = this.question;
    if (q.classList.contains('full')) return;
    this.expand.hidden = !q.textContent || (q.scrollHeight <= q.clientHeight + 1 && q.scrollWidth <= q.clientWidth + 1);
  }

  /** A short note on the document's state beside its name, such as a newer picture still drawing; none hides it. */
  setStatus(text: string | undefined): void {
    this.docStatus.textContent = text ?? '';
    this.docStatus.hidden = !text;
  }

  /** The document's name and who and when, in the app bar; `home` makes the mark a way back to the hub. */
  setDoc(title: string, meta: string, home?: string): void {
    this.docTitle.textContent = title;
    this.docTitle.title = title;
    this.docMeta.textContent = meta;
    this.docMeta.hidden = !meta;
    if (home) {
      const a = h('a', 'v-brand');
      a.href = home;
      a.title = 'All diagrams';
      a.setAttribute('aria-label', 'All diagrams');
      a.innerHTML = this.brand.innerHTML;
      this.brand.replaceWith(a);
    }
  }

  /** A document action at the foot of the More menu, above the layout score; `bad` colors a destructive one. */
  addMenuItem(name: IconName, label: string, fn: () => void, bad = false): void {
    const sep = h('div', 'v-menu-sep');
    sep.setAttribute('role', 'separator');
    const b = this.item(name, label, fn);
    b.classList.toggle('v-bad', bad);
    this.menu.insertBefore(sep, this.scoreItem);
    this.menu.insertBefore(b, this.scoreItem);
  }

    addAction(btn: HTMLElement, where: 'before-present' | 'after-present'): void {
    if (where === 'before-present') this.tools.insertBefore(btn, this.presentBtn);
    else this.presentBtn.after(btn);
  }

  setTheme(dark: boolean): void {
    const label = dark ? 'Light theme' : 'Dark theme';
    this.themeBtn.title = label;
    this.themeBtn.setAttribute('aria-label', label);
    this.themeBtn.querySelector('svg')!.replaceWith(icon(dark ? 'sun' : 'moon'));
    this.themeItem.querySelector('svg')!.replaceWith(icon(dark ? 'sun' : 'moon'));
    this.themeItem.querySelector('span')!.textContent = label;
  }

  setPresenting(on: boolean): void {
    const label = this.presentBtn.querySelector('.v-btn-label')!;
    label.textContent = on ? 'Exit' : 'Present';
    this.presentBtn.title = on ? 'Leave present mode (Esc)' : 'Present full screen (P)';
    this.presentBtn.classList.toggle('on', on);
    this.presentBtn.querySelector('svg')!.replaceWith(icon(on ? 'close' : 'present'));
  }

  /** Closes the menu or the notes; true when something was open, so Escape stops there. */
  dismiss(): boolean {
    const open = this.menu.classList.contains('show') || this.notes.classList.contains('show');
    this.closeMenu(true);
    this.closeNotes();
    return open;
  }

  private toggleQuestion(): void {
    const full = this.question.classList.toggle('full');
    this.expand.textContent = full ? 'Less' : 'More';
    this.expand.title = full ? 'Shorten the question' : 'Show the whole question';
  }

  private toggleNotes(): void {
    const show = !this.notes.classList.contains('show');
    this.notes.classList.toggle('show', show);
    this.notesBtn.setAttribute('aria-expanded', String(show));
  }

  private closeNotes(): void {
    this.notes.classList.remove('show');
    this.notesBtn.setAttribute('aria-expanded', 'false');
  }

  private toggleMenu(): void {
    if (this.menu.classList.contains('show')) return this.closeMenu(true);
    this.menu.classList.add('show');
    this.moreBtn.setAttribute('aria-expanded', 'true');
    this.menu.querySelector<HTMLElement>('.v-menu-item')?.focus();
  }

  private closeMenu(refocus = false): void {
    if (!this.menu.classList.contains('show')) return;
    this.menu.classList.remove('show');
    this.moreBtn.setAttribute('aria-expanded', 'false');
    if (refocus && this.menu.contains(document.activeElement)) this.moreBtn.focus();
  }

  private menuKey(e: KeyboardEvent): void {
    const items = [...this.menu.querySelectorAll<HTMLElement>('.v-menu-item')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      this.closeMenu(true);
    } else if (e.key === 'Tab') {
      this.closeMenu();
    }
  }
}

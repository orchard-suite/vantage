/**
 * A modal dialog over the viewer: a scrim, a card with a title, a body and
 * a footer. Escape and the scrim close it, focus moves in on open and
 * back to the opener on close, and Tab stays inside while it is open.
 */
import { h, iconButton } from './dom.ts';

export class Dialog {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  readonly foot: HTMLElement;
  private readonly card: HTMLElement;
  private opener: HTMLElement | null = null;
  private readonly onKey = (e: KeyboardEvent): void => this.key(e);

  constructor(title: string, lede: string, private readonly onClose?: () => void) {
    this.el = h('div', 'v-dlg-wrap');
    this.el.hidden = true;
    this.el.addEventListener('mousedown', (e) => {
      if (e.target === this.el) this.close();
    });
    this.card = h('section', 'v-dlg');
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    const id = `v-dlg-${title.toLowerCase().replace(/\W+/g, '-')}`;
    this.card.setAttribute('aria-labelledby', id);
    const head = h('header', 'v-dlg-head');
    const words = h('div', 'v-dlg-words');
    const t = h('h2', undefined, title);
    t.id = id;
    words.append(t, h('p', undefined, lede));
    head.append(words, iconButton('close', 'Close (Esc)', () => this.close(), 'v-btn v-icon-btn v-quiet'));
    this.body = h('div', 'v-dlg-body');
    this.foot = h('footer', 'v-dlg-foot');
    this.card.append(head, this.body, this.foot);
    this.el.appendChild(this.card);
    document.body.appendChild(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(): void {
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.el.hidden = false;
    document.addEventListener('keydown', this.onKey, true);
    requestAnimationFrame(() => (this.card.querySelector<HTMLElement>('[data-autofocus]') ?? this.focusables()[0])?.focus());
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    document.removeEventListener('keydown', this.onKey, true);
    this.opener?.focus();
    this.onClose?.();
  }

  private focusables(): HTMLElement[] {
    return [...this.card.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select,textarea,[tabindex="0"]')].filter((e) => e.offsetParent !== null);
  }

  private key(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    // The viewer's own shortcuts stay quiet while a dialog is up.
    if (e.key !== 'Tab') {
      if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) e.stopPropagation();
      return;
    }
    const f = this.focusables();
    if (!f.length) return;
    const first = f[0]!, last = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

/** A segmented choice: buttons with aria-pressed, one pressed at a time. */
export function segmented<T extends string>(label: string, options: readonly (readonly [T, string])[], value: T, onPick: (v: T) => void): { el: HTMLElement; set: (v: T) => void } {
  const el = h('div', 'seg');
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', label);
  const buttons = options.map(([v, text]) => {
    const b = h('button', undefined, text);
    b.type = 'button';
    b.dataset['v'] = v;
    b.addEventListener('click', () => {
      set(v);
      onPick(v);
    });
    return b;
  });
  const set = (v: T): void => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset['v'] === v)));
  el.append(...buttons);
  set(value);
  return { el, set };
}

/** A switch row: a label, a hint, and a role=switch button. */
export function switchRow(label: string, hint: string, on: boolean, onFlip: (on: boolean) => void): HTMLElement {
  const row = h('div', 'v-dlg-row');
  const words = h('span', 'v-dlg-row-words');
  const l = h('span', 'v-dlg-row-label', label);
  l.id = `v-sw-${label.toLowerCase().replace(/\W+/g, '-')}`;
  words.append(l, h('span', 'f-hint', hint));
  const b = h('button', 'switch');
  b.type = 'button';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(on));
  b.setAttribute('aria-labelledby', l.id);
  b.addEventListener('click', () => {
    const next = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(next));
    onFlip(next);
  });
  row.append(words, b);
  return row;
}

/** A copy button that says it copied. */
export function copyButton(text: () => string, label = 'Copy'): HTMLButtonElement {
  const b = h('button', 'btn sm', label);
  b.type = 'button';
  b.addEventListener('click', () => {
    void navigator.clipboard?.writeText(text()).then(() => {
      b.textContent = 'Copied';
      setTimeout(() => (b.textContent = label), 1600);
    });
  });
  return b;
}

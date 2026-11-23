/** The keyboard shortcuts dialog, opened with "?" or from the More menu. Focus moves in on open and back out on close. */
import { h, iconButton } from './dom.ts';

const ROWS: readonly [string, readonly (readonly [readonly string[], string])[]][] = [
  ['Move around', [
    [['↑', '↓'], 'Previous or next view'],
    [['←', '→'], 'Step through a path or walkthrough'],
    [['/'], 'Find a view or box'],
    [['V'], 'Show or hide the view list'],
  ]],
  ['The picture', [
    [['F'], 'Fit the view'],
    [['+', '−'], 'Zoom in or out; the scroll wheel and a pinch zoom too'],
    [['Click a group title'], 'Open or fold it where it stands'],
    [['Z'], 'Zoom into the selected group; Esc comes back'],
    [['Esc'], 'Close what is open, one thing at a time'],
  ]],
  ['Show it', [
    [['P'], 'Present full screen; ← → move through slides'],
    [['?'], 'This list'],
  ]],
];

export class Help {
  readonly el: HTMLElement;
  private readonly card: HTMLElement;
  private returnTo: HTMLElement | undefined;

  constructor() {
    this.el = h('div', 'v-help');
    this.card = h('div', 'v-help-card');
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.card.setAttribute('aria-labelledby', 'v-help-title');
    this.card.tabIndex = -1;
    const head = h('div', 'v-help-head');
    const title = h('h2', undefined, 'Keyboard shortcuts');
    title.id = 'v-help-title';
    head.append(title, iconButton('close', 'Close (Esc)', () => this.close(), 'v-btn v-icon-btn v-quiet'));
    this.card.appendChild(head);
    for (const [group, rows] of ROWS) {
      const sec = h('section');
      sec.appendChild(h('h3', undefined, group));
      const dl = h('dl');
      for (const [keys, what] of rows) {
        const dt = h('dt');
        // A key is a kbd; a gesture written as words stays words.
        for (const part of keys) dt.appendChild(part.includes(' ') ? h('span', 'v-gesture', part) : h('kbd', undefined, part));
        dl.append(dt, h('dd', undefined, what));
      }
      sec.appendChild(dl);
      this.card.appendChild(sec);
    }
    this.el.appendChild(this.card);
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
    // Tab stays inside the dialog while it is open.
    this.card.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        this.card.querySelector<HTMLElement>('button')?.focus();
      }
    });
  }

  get open(): boolean {
    return this.el.classList.contains('show');
  }

  toggle(): void {
    if (this.open) this.close();
    else {
      this.returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      this.el.classList.add('show');
      this.card.querySelector<HTMLElement>('button')?.focus();
    }
  }

  close(): void {
    if (!this.open) return;
    this.el.classList.remove('show');
    this.returnTo?.focus();
  }
}

/**
 * Responsive shell: on a wide screen the sidebar and the hub dock are
 * columns; on a phone (the compact layout) they become drawers over the stage with a scrim.
 * On a wide screen both can be tucked away, and those choices are
 * remembered. The dock starts closed: most readers read, and an author
 * who opens it finds it open next time.
 */
import { h, iconButton } from './dom.ts';
import { recall, remember } from './storage.ts';
import { COMPACT } from './compact.ts';

const SIDE_KEY = 'vantage:side';
const DOCK_KEY = 'vantage:dock';

export class Shell {
  readonly scrim: HTMLElement;
  readonly menuBtn: HTMLButtonElement;
  readonly dockBtn: HTMLButtonElement;
  /** Hub mode: the close button the collaboration module puts in its tab strip. */
  readonly dockClose: HTMLButtonElement;
  private readonly dockCount: HTMLElement;
  private readonly mq = matchMedia(COMPACT);

  constructor(
    private readonly root: HTMLElement,
    private readonly side: HTMLElement,
    private readonly dock: HTMLElement | undefined,
    /** Called after the sidebar opens, so the caller can focus the search box. */
    private readonly onSideOpen: () => void,
    /** Called after a column opens or closes, so the stage can refit. */
    private readonly onLayout: () => void,
  ) {
    this.scrim = h('div', 'v-scrim');
    this.scrim.addEventListener('click', () => this.closeAll());
    this.menuBtn = iconButton('sidebar', 'Views (V)', () => this.toggleSide(), 'v-btn v-icon-btn v-quiet v-menu-btn');
    this.menuBtn.setAttribute('aria-controls', 'v-side');
    this.dockBtn = iconButton('chat', 'Steer, comments, and history', () => this.toggleDock(), 'v-btn v-dock-btn v-keep', 'Collaborate');
    this.dockCount = h('span', 'v-count');
    this.dockCount.hidden = true;
    this.dockBtn.appendChild(this.dockCount);
    side.id = 'v-side';
    side.appendChild(iconButton('close', 'Close the view list', () => this.closeSide(), 'v-btn v-icon-btn v-quiet v-side-close'));
    this.dockClose = iconButton('close', 'Close', () => this.closeDock(), 'v-btn v-icon-btn v-quiet v-dock-close');
    this.mq.addEventListener('change', () => this.apply());
    this.apply();
  }

  get narrow(): boolean {
    return this.mq.matches;
  }

  /** Open comments across the document, shown on the Collaborate button. */
  setCount(n: number): void {
    this.dockCount.hidden = n === 0;
    this.dockCount.textContent = String(n);
    this.dockBtn.title = n ? `Steer, comments, and history; ${n} open comment${n === 1 ? '' : 's'}` : 'Steer, comments, and history';
  }

  private apply(): void {
    if (this.narrow) {
      this.root.classList.remove('v-side-hidden', 'v-dock-shown');
      this.closeAll();
    } else {
      this.side.classList.remove('open');
      this.dock?.classList.remove('open');
      this.scrim.classList.remove('show');
      this.root.classList.toggle('v-side-hidden', recall(SIDE_KEY) === 'hidden');
      this.root.classList.toggle('v-dock-shown', this.dock !== undefined && recall(DOCK_KEY) === 'shown');
    }
    this.sync();
  }

  private sync(): void {
    const sideOpen = this.narrow ? this.side.classList.contains('open') : !this.root.classList.contains('v-side-hidden');
    this.menuBtn.setAttribute('aria-expanded', String(sideOpen));
    const dockOpen = this.narrow ? Boolean(this.dock?.classList.contains('open')) : this.root.classList.contains('v-dock-shown');
    this.dockBtn.setAttribute('aria-pressed', String(dockOpen));
  }

  toggleSide(): void {
    if (this.narrow) {
      if (this.side.classList.contains('open')) this.closeSide();
      else this.openSide();
      return;
    }
    const hidden = this.root.classList.toggle('v-side-hidden');
    remember(SIDE_KEY, hidden ? 'hidden' : 'shown');
    this.sync();
    this.onLayout();
  }

  openSide(): void {
    if (!this.narrow) {
      if (this.root.classList.contains('v-side-hidden')) this.toggleSide();
      return;
    }
    this.dock?.classList.remove('open');
    this.side.classList.add('open');
    this.scrim.classList.add('show');
    this.sync();
    // A keyboard would cover half a phone; only a pointer device gets the search box focused.
    if (matchMedia('(hover: hover)').matches) this.onSideOpen();
  }

  closeSide(): void {
    this.side.classList.remove('open');
    if (!this.dock?.classList.contains('open')) this.scrim.classList.remove('show');
    this.sync();
  }

  toggleDock(): void {
    if (!this.dock) return;
    if (!this.narrow) {
      const shown = this.root.classList.toggle('v-dock-shown');
      remember(DOCK_KEY, shown ? 'shown' : 'hidden');
      this.sync();
      this.onLayout();
      return;
    }
    if (this.dock.classList.contains('open')) this.closeDock();
    else {
      this.side.classList.remove('open');
      this.dock.classList.add('open');
      this.scrim.classList.add('show');
      this.sync();
    }
  }

  closeDock(): void {
    if (!this.narrow) {
      if (this.root.classList.contains('v-dock-shown')) this.toggleDock();
      return;
    }
    this.dock?.classList.remove('open');
    if (!this.side.classList.contains('open')) this.scrim.classList.remove('show');
    this.sync();
  }

  closeAll(): void {
    this.side.classList.remove('open');
    this.dock?.classList.remove('open');
    this.scrim.classList.remove('show');
    this.sync();
  }

  /** On a phone, picking a view closes the drawer so the picture is visible. */
  afterPick(): void {
    if (this.narrow) this.closeSide();
  }
}

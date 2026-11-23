/**
 * The inspector as a bottom sheet on a phone. It rests at one of three
 * heights: peek (the name and the actions), half the stage, or nearly all
 * of it. The grip and the head drag it between them, a tap on the grip
 * steps it, and a drag below peek closes it. On a wide screen it does
 * nothing and the panel stays a side sheet.
 */
export type Snap = 'peek' | 'half' | 'full';

const ORDER: readonly Snap[] = ['peek', 'half', 'full'];
/** How far under peek a drag has to go to close the sheet. */
const CLOSE_PAST = 48;
/** A release faster than this, in px per ms, moves one snap in its direction. */
const FLING = 0.45;
/** Movement under this many px is a tap, not a drag. */
const SLOP = 6;

export class Sheet {
  private snap: Snap = 'peek';
  private open = false;
  private drag: { id: number; y0: number; h0: number; y: number; t: number; v: number; moved: boolean } | undefined;
  /** A drag that ended on the grip still clicks it; that click is not a tap. */
  private dragged = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly narrow: () => boolean,
    /** Called when the sheet settles at a new height. */
    private readonly onSnap: (snap: Snap) => void,
    private readonly onClose: () => void,
  ) {
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
    // Registered before the viewer's own resize listener, so the camera insets see the new height.
    window.addEventListener('resize', () => this.refit());
    el.addEventListener('click', (e) => {
      if (!this.narrow() || !(e.target as Element).closest('.grip')) return;
      if (this.dragged) this.dragged = false;
      else this.step();
    });
  }

  /** Called after the panel renders a box: a closed sheet opens at peek, an open one keeps its height. */
  shown(): void {
    if (!this.open) this.snap = 'peek';
    this.open = true;
    if (!this.narrow()) return this.clear();
    this.settle(this.snap, false);
  }

  hidden(): void {
    this.open = false;
    this.clear();
  }

  /** The window changed size, or crossed the narrow breakpoint. */
  private refit(): void {
    if (!this.open) return;
    if (this.narrow()) this.settle(this.snap, false);
    else this.clear();
  }

  private clear(): void {
    this.el.style.height = '';
    this.el.classList.remove('peek', 'half', 'full', 'dragging');
  }

  /** Heights for each snap, in px; a box with little to say gets fewer distinct stops. */
  private heights(): Record<Snap, number> {
    const stage = this.el.parentElement?.clientHeight ?? window.innerHeight;
    const actions = this.el.querySelector<HTMLElement>('.v-panel-actions') ?? this.el.querySelector<HTMLElement>('.v-panel-head');
    const pad = parseFloat(getComputedStyle(this.el).paddingBottom) || 0;
    const last = this.el.lastElementChild as HTMLElement | null;
    const content = last ? last.offsetTop + last.offsetHeight + pad : 0;
    const full = Math.min(content, stage - 8);
    const peek = Math.min(full, actions ? actions.offsetTop + actions.offsetHeight + pad : full);
    const half = Math.max(peek, Math.min(full, Math.round(stage * 0.5)));
    return { peek, half, full };
  }

  private settle(snap: Snap, notify = true): void {
    const hs = this.heights();
    this.snap = snap;
    this.el.classList.remove('peek', 'half', 'full', 'dragging');
    this.el.classList.add(snap);
    this.el.style.height = `${hs[snap]}px`;
    if (snap === 'peek') this.el.scrollTop = 0;
    const grip = this.el.querySelector('.grip');
    grip?.setAttribute('aria-label', snap === 'full' ? 'Show less' : 'Show more');
    grip?.setAttribute('aria-expanded', String(snap !== 'peek'));
    if (notify) this.onSnap(snap);
  }

  private step(): void {
    this.settle(this.snap === 'peek' ? 'half' : this.snap === 'half' ? 'full' : 'peek');
  }

  private down(e: PointerEvent): void {
    if (!this.narrow() || e.button !== 0) return;
    const t = e.target as Element;
    // The grip and the head drag; anything else in the head that is a control stays a control.
    if (!t.closest('.grip') && (!t.closest('.v-panel-head') || t.closest('button,a'))) return;
    this.dragged = false;
    this.drag = { id: e.pointerId, y0: e.clientY, h0: this.el.offsetHeight, y: e.clientY, t: e.timeStamp, v: 0, moved: false };
  }

  private move(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved) {
      if (Math.abs(e.clientY - d.y0) < SLOP) return;
      d.moved = true;
      this.el.classList.add('dragging');
      this.el.setPointerCapture(e.pointerId);
    }
    const dt = Math.max(1, e.timeStamp - d.t);
    d.v = (e.clientY - d.y) / dt;
    d.y = e.clientY;
    d.t = e.timeStamp;
    const hs = this.heights();
    this.el.style.height = `${Math.max(0, Math.min(hs.full, d.h0 - (e.clientY - d.y0)))}px`;
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = undefined;
    if (!d.moved) return;
    this.dragged = true;
    const hs = this.heights();
    const h = this.el.offsetHeight;
    const flung = Math.abs(d.v) > FLING ? Math.sign(d.v) : 0;
    if (h < hs.peek - CLOSE_PAST || (flung > 0 && this.snap === 'peek' && h < hs.peek)) {
      this.clear();
      return this.onClose();
    }
    let at = ORDER.reduce((best, s) => (Math.abs(hs[s] - h) < Math.abs(hs[best] - h) ? s : best), this.snap);
    if (flung) {
      // A fling moves past the nearest stop toward the direction of travel; down is a smaller sheet.
      const i = ORDER.indexOf(at);
      const next = ORDER[Math.max(0, Math.min(ORDER.length - 1, i - flung))]!;
      if ((flung < 0 && hs[next] > h) || (flung > 0 && hs[next] < h)) at = next;
    }
    this.settle(at);
  }
}

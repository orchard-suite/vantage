/**
 * Present mode: full screen, one view per slide in picker order. Right
 * advances through the slide's steps and then to the next slide; Left goes
 * back the same way; Escape leaves.
 */
import type { BundleView } from './bundle.ts';
import { h } from './dom.ts';

export interface PresentHost {
  readonly root: HTMLElement;
  readonly slides: () => readonly BundleView[];
  readonly currentId: () => string | undefined;
  readonly goTo: (view: BundleView) => void;
  /** Advance within the slide; false when the slide has nothing left. */
  readonly stepForward: () => boolean;
  readonly stepBack: () => boolean;
  /** Called whenever present mode turns on or off. */
  readonly onToggle: (on: boolean) => void;
}

export class Presenter {
  readonly counter: HTMLElement;
  private on = false;

  constructor(private readonly host: PresentHost) {
    this.counter = h('div', 'v-slide');
    this.counter.setAttribute('aria-live', 'polite');
    document.addEventListener('fullscreenchange', () => {
      if (this.on && !document.fullscreenElement) this.exit();
    });
  }

  get active(): boolean {
    return this.on;
  }

  enter(): void {
    this.on = true;
    this.host.root.classList.add('v-present');
    const req = this.host.root.requestFullscreen?.bind(this.host.root);
    if (req) req().catch(() => undefined);
    const first = this.host.slides()[0];
    if (!this.host.currentId() && first) this.host.goTo(first);
    this.host.onToggle(true);
    this.update();
  }

  exit(): void {
    if (!this.on) return;
    this.on = false;
    this.host.root.classList.remove('v-present');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    this.host.onToggle(false);
    this.update();
  }

  toggle(): void {
    if (this.on) this.exit();
    else this.enter();
  }

  /** Call after any slide or step change so the counter reads right. */
  update(): void {
    const slides = this.host.slides();
    const i = slides.findIndex((v) => v.id === this.host.currentId());
    this.counter.textContent = this.on && i >= 0 ? `${i + 1} / ${slides.length}` : '';
    this.counter.classList.toggle('show', this.on);
  }

  next(): void {
    if (this.host.stepForward()) return this.update();
    this.jump(1);
  }

  prev(): void {
    if (this.host.stepBack()) return this.update();
    this.jump(-1);
  }

  jump(d: number): void {
    const slides = this.host.slides();
    const i = slides.findIndex((v) => v.id === this.host.currentId());
    const n = slides[Math.max(0, Math.min(slides.length - 1, i + d))];
    if (n && n.id !== this.host.currentId()) this.host.goTo(n);
    this.update();
  }

  /** In present mode a horizontal swipe on the stage changes slides, as the arrow keys do. */
  wireSwipe(canvas: HTMLElement, gesturing: () => boolean): void {
    let x0 = 0, y0 = 0, t0 = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      x0 = e.clientX;
      y0 = e.clientY;
      t0 = performance.now();
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch' || !this.on || gesturing()) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (performance.now() - t0 < 600 && Math.abs(dx) > 70 && Math.abs(dy) < 50) {
        if (dx < 0) this.next();
        else this.prev();
      }
    });
  }
}

/**
 * Runtime detail depth: one step per depth that changes the drawn view,
 * drawn as rising bars, so more bars reads as more inside the boxes. The
 * authored depth is one step among them. Nothing is saved.
 */
import type { BundleView } from './bundle.ts';
import { h } from './dom.ts';

export class DetailControl {
  readonly el: HTMLElement;
  private view: BundleView | undefined;
  private depth = 0;
  private readonly steps: HTMLElement;

  constructor(private readonly onChange: (depth: number) => void) {
    this.el = h('div', 'v-detail');
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', 'Detail inside boxes');
    this.el.title = 'Show less or more inside the boxes';
    this.steps = h('div', 'v-detail-steps');
    this.el.append(h('span', 'l', 'Detail'), this.steps);
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        this.move(e.key === 'ArrowRight' ? 1 : -1);
        this.steps.querySelector<HTMLElement>('[aria-pressed=true]')?.focus();
      }
    });
  }

  /** The depths that change the picture, in order. */
  private get stops(): number[] {
    const v = this.view;
    if (!v) return [];
    return [...new Set([v.detail ?? 0, ...(v.depths ?? [])])].sort((a, b) => a - b);
  }

  /** The view whose depths to offer, at the depth the reader left it. */
  attach(view: BundleView | undefined, depth: number): void {
    this.view = view;
    this.depth = depth;
    this.render();
  }

  private move(d: number): void {
    const stops = this.stops;
    const depth = stops[Math.max(0, Math.min(stops.length - 1, stops.indexOf(this.depth) + d))];
    if (depth !== undefined) this.go(depth);
  }

  private go(depth: number): void {
    if (depth === this.depth) return;
    this.depth = depth;
    this.render();
    this.onChange(depth);
  }

  private render(): void {
    const stops = this.stops;
    const show = stops.length > 1;
    this.el.classList.toggle('show', show);
    this.steps.replaceChildren();
    if (!show) return;
    const authored = this.view?.detail ?? 0;
    stops.forEach((depth, i) => {
      const b = h('button', 'v-detail-step');
      b.type = 'button';
      const on = depth === this.depth;
      b.setAttribute('aria-pressed', String(on));
      b.tabIndex = on ? 0 : -1;
      const name = `Depth ${depth}${depth === authored ? ', as authored' : ''}`;
      b.setAttribute('aria-label', name);
      b.title = name;
      const bar = h('i');
      bar.style.height = `${8 + Math.round((i / Math.max(1, stops.length - 1)) * 8)}px`;
      b.appendChild(bar);
      if (i <= stops.indexOf(this.depth)) b.classList.add('lit');
      b.addEventListener('click', () => this.go(depth));
      this.steps.appendChild(b);
    });
  }
}

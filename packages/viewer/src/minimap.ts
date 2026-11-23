/**
 * A minimap for views larger than the stage: boxes as small rects and the
 * viewport as a frame. Clicking pans the stage to that point. Redraws only
 * when the camera or the picture changes.
 */
import type { BundleView } from './bundle.ts';
import type { PanZoom } from './panzoom.ts';
import { h } from './dom.ts';
import { LIGHT } from '../../render/src/tokens.ts';

const W = 200;
const H = 140;

export class Minimap {
  readonly el: HTMLCanvasElement;
  private view: BundleView | undefined;
  private k = 1;
  private ox = 0;
  private oy = 0;

  constructor(private readonly panzoom: PanZoom) {
    this.el = h('canvas', 'v-minimap');
    this.el.width = W * devicePixelRatio;
    this.el.height = H * devicePixelRatio;
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', 'Minimap; click to pan');
    this.el.addEventListener('click', (e) => {
      const r = this.el.getBoundingClientRect();
      const x = (e.clientX - r.left - this.ox) / this.k;
      const y = (e.clientY - r.top - this.oy) / this.k;
      this.panzoom.centerOn(x, y, 0, 0);
    });
  }

  attach(view: BundleView | undefined): void {
    this.view = view;
    this.draw();
  }

  draw(): void {
    const v = this.view;
    const cam = this.panzoom.camera;
    // Shown only when the picture runs off a side; one seen full width scrolls up and down without a map over it.
    const seen = this.panzoom.region;
    const big = v !== undefined && (seen.x > 1 || seen.x + seen.w < v.width - 1);
    this.el.classList.toggle('show', big);
    if (!v || !big) return;
    const ctx = this.el.getContext('2d');
    if (!ctx) return;
    const dpr = devicePixelRatio;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    this.k = Math.min((W - 8) / v.width, (H - 8) / v.height);
    this.ox = (W - v.width * this.k) / 2;
    this.oy = (H - v.height * this.k) / 2;
    const css = getComputedStyle(this.el);
    const line = css.getPropertyValue('--line').trim() || LIGHT.line;
    const ink = css.getPropertyValue('--muted').trim() || LIGHT.muted;
    const accent = css.getPropertyValue('--accent').trim() || LIGHT.accent;
    for (const b of v.boxes) {
      ctx.fillStyle = b.kind === 'container' ? line : ink;
      ctx.globalAlpha = b.kind === 'container' ? 0.45 : 0.9;
      ctx.fillRect(this.ox + b.x * this.k, this.oy + b.y * this.k, Math.max(2, b.w * this.k), Math.max(2, b.h * this.k));
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    const vx = -cam.tx / cam.scale, vy = -cam.ty / cam.scale;
    const vw = cam.viewW / cam.scale, vh = cam.viewH / cam.scale;
    ctx.strokeRect(this.ox + vx * this.k, this.oy + vy * this.k, vw * this.k, vh * this.k);
  }
}

/**
 * Pan and zoom for the stage: the wheel and a trackpad pinch glide the
 * zoom around the cursor, a drag with the left or middle button pans, two fingers pinch and pan, a double
 * tap zooms in on the spot, fit() frames the view.
 */
import { fitAll, frame, wholeFrame, MAX_FIT, NO_INSETS, opening, READABLE, regionCamera, reveal, visibleRegion, type Camera, type Insets, type Rect, type Viewport } from './camera.ts';
import { wheelZoom } from './wheel.ts';

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
/** How far a press may wander, in screen pixels, and still count as a click rather than a drag. */
const CLICK_SLOP = 4;
/** The share of the remaining zoom a glide covers each frame. */
const GLIDE_RATE = 0.3;

function clampScale(s: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
}

export class PanZoom {
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private contentW = 0;
  private contentH = 0;
  /** Active touch points by pointer id, for pinch. */
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private lastTap = 0;
  private pinched = false;
  /** Where the press started, and whether it has since moved far enough to be a drag. */
  private downX = 0;
  private downY = 0;
  private dragged = false;
  /** A stepped zoom in flight: the scale it heads for and the screen point it holds still. */
  private glide: { target: number; x: number; y: number } | undefined;
  /** Called after every camera change, so the minimap can follow. */
  onChange: (() => void) | undefined;

  constructor(private readonly canvas: HTMLElement, private readonly stage: HTMLElement) {
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    // The middle button pans like the left; its press would otherwise start the browser's autoscroll.
    canvas.addEventListener('mousedown', (e) => e.button === 1 && e.preventDefault());
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('dblclick', (e) => {
      const r = canvas.getBoundingClientRect();
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, 1.6, true);
    });
    window.addEventListener('resize', () => this.fit());
  }

  /** The picture's size, and where its drawing ends and the prose under it begins. */
  setContent(w: number, h: number, figureH = h): void {
    this.contentW = w;
    this.contentH = h;
    this.figureH = figureH;
  }

  private figureH = 0;

  /** Camera and viewport in one read: content size, scale, offset, and the visible canvas size. */
  get camera(): { scale: number; tx: number; ty: number; viewW: number; viewH: number; contentW: number; contentH: number } {
    const r = this.canvas.getBoundingClientRect();
    return { scale: this.scale, tx: this.tx, ty: this.ty, viewW: r.width, viewH: r.height, contentW: this.contentW, contentH: this.contentH };
  }

  /** Panels and the story card covering the canvas; frames and fits keep clear of them. */
  insets: Insets = NO_INSETS;

  private get viewport(): Viewport {
    const r = this.canvas.getBoundingClientRect();
    return { width: r.width, height: r.height, insets: this.insets };
  }

  private get padding(): number {
    return this.canvas.clientWidth < 600 ? 12 : 40;
  }

  private get content(): { w: number; h: number } {
    return { w: this.contentW, h: this.contentH };
  }

  /** The whole picture in the visible area. */
  fit(animate = false): void {
    if (!this.contentW || !this.contentH) return;
    this.set(fitAll(this.viewport, this.content, this.padding), animate);
  }

  /** The first frame of a view: the whole drawing, or its width from the top when the whole would be unreadable; never cropped from the side. */
  open(focus: Rect | undefined = this.focus): void {
    if (!this.contentW || !this.contentH) return;
    this.focus = focus;
    this.set(opening(this.viewport, this.content, this.padding, this.figureH, focus), false);
    this.opened = { scale: this.scale, tx: this.tx, ty: this.ty };
  }

  /** Frames the view again when the space around it changed and the reader has not moved since it opened. */
  reopen(): void {
    const o = this.opened;
    if (o && o.scale === this.scale && o.tx === this.tx && o.ty === this.ty) this.open();
  }

  private opened: Camera | undefined;
  /** Where a picture too wide to read whole opens: its first story step. */
  private focus: Rect | undefined;

  /** Frames a canvas rect, for a story step: zoomed in on it, centred, never smaller than the whole fit, taking in whole any box it would cut in half. */
  frameRect(r: Rect, boxes: readonly Rect[] = []): void {
    if (!this.contentW || !this.contentH) return;
    const whole = wholeFrame(this.viewport, this.content, r, boxes, this.padding + 24);
    this.set(frame(this.viewport, this.content, whole, this.padding + 24), true);
  }

  /** Pans just enough that a canvas rect is fully visible beside the panels; zooms in first when it is too small to read. */
  reveal(r: Rect): void {
    const cam = this.scale < READABLE ? { scale: Math.min(READABLE * 1.6, MAX_FIT), tx: this.tx, ty: this.ty } : { scale: this.scale, tx: this.tx, ty: this.ty };
    this.set(reveal(this.viewport, cam, r, 24), true);
  }

  /** Centres a canvas rect in the visible area without changing the zoom. */
  centerOn(x: number, y: number, w: number, h: number): void {
    const v = this.viewport;
    const cx = v.insets.left + (v.width - v.insets.left - v.insets.right) / 2;
    const cy = v.insets.top + (v.height - v.insets.top - v.insets.bottom) / 2;
    this.set({ scale: this.scale, tx: cx - (x + w / 2) * this.scale, ty: cy - (y + h / 2) * this.scale }, true);
  }

  /** Moves the camera with a box that moved by (dx, dy) canvas pixels, so it stays still on screen. */
  shiftBy(dx: number, dy: number): void {
    this.set({ scale: this.scale, tx: this.tx - dx * this.scale, ty: this.ty - dy * this.scale }, false);
  }

  /** The part of the picture the reader sees clear of the panels, in canvas pixels. */
  get region(): Rect {
    return visibleRegion(this.viewport, { scale: this.scale, tx: this.tx, ty: this.ty });
  }

  /** Shows a region of the picture whole, for a reader following another; each update glides briefly into the next. */
  showRegion(r: Rect): void {
    if (!this.contentW || !this.contentH) return;
    const cam = regionCamera(this.viewport, r, clampScale);
    if (Math.abs(cam.scale - this.scale) < 1e-4 && Math.abs(cam.tx - this.tx) < 0.5 && Math.abs(cam.ty - this.ty) < 0.5) return;
    this.glide = undefined;
    this.scale = cam.scale;
    this.tx = cam.tx;
    this.ty = cam.ty;
    const glide = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.stage.style.transition = glide ? 'transform var(--d-2) var(--ease)' : '';
    this.apply();
  }

  /** Scale 1, centred. */
  reset(): void {
    const r = this.canvas.getBoundingClientRect();
    this.set({ scale: 1, tx: (r.width - this.contentW) / 2, ty: (r.height - this.contentH) / 2 }, true);
  }

  private set(cam: Camera, animate: boolean): void {
    this.glide = undefined;
    this.scale = cam.scale;
    this.tx = cam.tx;
    this.ty = cam.ty;
    const glide = animate && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.stage.style.transition = glide ? 'transform .45s cubic-bezier(.2,.7,.2,1)' : '';
    this.apply();
    if (glide) setTimeout(() => (this.stage.style.transition = ''), 460);
  }

  /** Zooms around the centre by a factor, gliding there. */
  zoomBy(f: number): void {
    const r = this.canvas.getBoundingClientRect();
    this.glideBy(r.width / 2, r.height / 2, f);
  }

  /** Zooms by a factor around a screen point over a few frames; steps that arrive mid-glide add to its target. */
  private glideBy(px: number, py: number, f: number): void {
    const target = clampScale((this.glide?.target ?? this.scale) * f);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return this.zoomAt(px, py, target / this.scale);
    const running = this.glide !== undefined;
    this.glide = { target, x: px, y: py };
    if (!running) requestAnimationFrame(() => this.glideFrame());
  }

  private glideFrame(): void {
    const g = this.glide;
    if (!g) return;
    const rest = g.target / this.scale;
    if (Math.abs(Math.log(rest)) < 0.002) {
      this.glide = undefined;
      return this.zoomAt(g.x, g.y, rest);
    }
    this.zoomAt(g.x, g.y, rest ** GLIDE_RATE);
    requestAnimationFrame(() => this.glideFrame());
  }

  /** The canvas's place on the page, for turning a pointer's page position into canvas pixels. */
  canvasRect(): DOMRect {
    return this.canvas.getBoundingClientRect();
  }

  zoomAt(px: number, py: number, f: number, animate = false): void {
    const ns = clampScale(this.scale * f);
    const k = ns / this.scale;
    this.tx = px - (px - this.tx) * k;
    this.ty = py - (py - this.ty) * k;
    this.scale = ns;
    if (animate) {
      this.stage.style.transition = 'transform .3s ease';
      setTimeout(() => (this.stage.style.transition = ''), 310);
    }
    this.apply();
  }

  /** True while a two-finger gesture is in progress, or a pinch or drag just ended, so its release is not read as a click. */
  get gesturing(): boolean {
    return this.pointers.size > 1 || this.pinched || this.dragged;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const f = wheelZoom(e);
    if (f !== 1) this.glideBy(e.clientX - r.left, e.clientY - r.top, f);
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.pointerType === 'touch') {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        this.lastMidX = undefined;
        this.lastMidY = undefined;
        this.pinchDist = this.spread();
        this.pinched = true;
        this.dragging = false;
        return;
      }
      // A second tap within 300ms on one finger zooms in where it landed.
      const now = performance.now();
      if (now - this.lastTap < 300) {
        const r = this.canvas.getBoundingClientRect();
        this.zoomAt(e.clientX - r.left, e.clientY - r.top, 1.6, true);
        this.lastTap = 0;
        return;
      }
      this.lastTap = now;
    }
    this.dragging = true;
    this.dragged = false;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.canvas.classList.add('dragging');
  }
  private onMove(e: PointerEvent): void {
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) return this.pinch();
    }
    if (!this.dragging) return;
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > CLICK_SLOP) this.dragged = true;
    this.moving();
    this.tx += e.clientX - this.lastX;
    this.ty += e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.apply();
  }
  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0 && this.pinched) setTimeout(() => (this.pinched = false), 50);
    // The click that follows this release lands in the same task; clear once it has been ignored.
    if (this.dragged) setTimeout(() => (this.dragged = false), 0);
    this.dragging = false;
    this.canvas.classList.remove('dragging');
    if (this.pointers.size === 0) this.canvas.classList.remove('moving');
  }
  /** Marks the canvas while a hand moves the picture, so the floating chrome can step aside. */
  private moving(): void {
    if (!this.canvas.classList.contains('moving')) this.canvas.classList.add('moving');
  }
  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
  /** Zooms around the midpoint of two fingers and pans with them. */
  private pinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    this.moving();
    const r = this.canvas.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
    const d = this.spread();
    if (this.pinchDist > 0) {
      const f = d / this.pinchDist;
      const ns = clampScale(this.scale * f);
      const k = ns / this.scale;
      this.tx = mx - (mx - this.tx) * k;
      this.ty = my - (my - this.ty) * k;
      this.scale = ns;
    }
    if (this.lastMidX !== undefined && this.lastMidY !== undefined) {
      this.tx += mx - this.lastMidX;
      this.ty += my - this.lastMidY;
    }
    this.lastMidX = mx;
    this.lastMidY = my;
    this.pinchDist = d;
    this.apply();
  }
  private lastMidX: number | undefined;
  private lastMidY: number | undefined;
  private apply(): void {
    this.stage.style.transform = `translate(${this.tx}px,${this.ty}px) scale(${this.scale})`;
    // The dot grid travels with the picture, so panning reads as moving paper, not sliding a sticker.
    const step = Math.max(8, 24 * this.scale);
    this.canvas.style.backgroundSize = `${step}px ${step}px`;
    this.canvas.style.backgroundPosition = `${this.tx}px ${this.ty}px`;
    this.onChange?.();
  }
}

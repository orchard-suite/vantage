/**
 * Camera math for the stage, kept free of the DOM so it can be tested.
 * A viewport is the canvas size less the insets that panels and the story
 * card cover; every frame is computed against what the reader can see.
 */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly insets: Insets;
}

export interface Camera {
  readonly scale: number;
  readonly tx: number;
  readonly ty: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Never magnify a picture past this when fitting; small views stay crisp, not cartoonish. */
export const MAX_FIT = 1.6;
/** Below this scale the 11px fact text is too small to read: 0.75 draws it at about 8px. */
export const READABLE = 0.75;
/** The first frame shows the whole drawing when it reads at this scale or larger. */
export const OPEN_FLOOR = 0.5;
/** A phone held at arm's length needs larger type: a picture too big to read whole opens on its first step at this scale. */
export const PHONE_FLOOR = 0.8;
/** Visible widths under this are phones. */
export const PHONE_WIDTH = 600;
/** A step frame never zooms past this, so a two-box step still shows its neighbours. */
export const MAX_FRAME = 1.1;

function visible(vp: Viewport): { x: number; y: number; w: number; h: number } {
  const w = Math.max(1, vp.width - vp.insets.left - vp.insets.right);
  const h = Math.max(1, vp.height - vp.insets.top - vp.insets.bottom);
  return { x: vp.insets.left, y: vp.insets.top, w, h };
}

/** The whole picture, centred in the visible area. */
export function fitAll(vp: Viewport, content: { w: number; h: number }, padding: number): Camera {
  const v = visible(vp);
  const scale = Math.min((v.w - padding * 2) / content.w, (v.h - padding * 2) / content.h, MAX_FIT);
  return { scale, tx: v.x + (v.w - content.w * scale) / 2, ty: v.y + (v.h - content.h * scale) / 2 };
}

/**
 * The first frame of a view. The drawing (the picture above any prose
 * under it) opens whole when it reads at OPEN_FLOOR or larger, with the
 * prose below to scroll to. Too big for that, it opens at its full width
 * from the top, the way a long page opens, when that still reads. Too wide
 * even for that, it opens framed on its first story step the way the story
 * will frame it, or, with no story, readable at its left edge, where the
 * flow starts; the reader pans.
 */
export function opening(vp: Viewport, content: { w: number; h: number }, padding: number, figureHeight = content.h, focus?: Rect): Camera {
  const v = visible(vp);
  const figure = Math.min(figureHeight, content.h);
  const byWidth = Math.min((v.w - padding * 2) / content.w, MAX_FIT);
  const whole = Math.min(byWidth, (v.h - padding * 2) / figure);
  if (whole >= OPEN_FLOOR) {
    if (content.h * whole <= v.h - padding * 2) return fitAll(vp, content, padding);
    return { scale: whole, tx: v.x + (v.w - content.w * whole) / 2, ty: v.y + Math.max(padding, (v.h - figure * whole) / 2) };
  }
  const width = Math.min(byWidth, 1);
  if (width >= OPEN_FLOOR) return { scale: width, tx: v.x + (v.w - content.w * width) / 2, ty: v.y + padding };
  const floor = v.w < PHONE_WIDTH ? PHONE_FLOOR : OPEN_FLOOR;
  // With a first story step, frame it the way the story will, never smaller than readable, centred on the step.
  if (focus) {
    const f = frame(vp, content, focus, padding);
    if (f.scale >= floor) return f;
    return { scale: floor, tx: v.x + v.w / 2 - (focus.x + focus.w / 2) * floor, ty: v.y + v.h / 2 - (focus.y + focus.h / 2) * floor };
  }
  const scale = floor;
  const ty = figure * scale <= v.h - padding * 2 ? v.y + (v.h - figure * scale) / 2 : v.y + padding;
  return { scale, tx: v.x + padding, ty };
}

/** Frames a rect: zooms in until it fills the visible area (capped), never out past the whole-picture fit, and centres it. */
export function frame(vp: Viewport, content: { w: number; h: number }, r: Rect, padding: number): Camera {
  const v = visible(vp);
  const floor = Math.min(fitAll(vp, content, padding).scale, MAX_FRAME);
  const want = Math.min((v.w - padding * 2) / Math.max(r.w, 1), (v.h - padding * 2) / Math.max(r.h, 1), MAX_FRAME);
  const scale = Math.max(floor, want);
  return { scale, tx: v.x + v.w / 2 - (r.x + r.w / 2) * scale, ty: v.y + v.h / 2 - (r.y + r.h / 2) * scale };
}

/**
 * A step frame that would cut a box in half at the screen's edge takes the
 * box in whole when most of it already shows; a box mostly outside stays
 * outside. One widening, so a frame never creeps out to the whole picture.
 */
export function wholeFrame(vp: Viewport, content: { w: number; h: number }, r: Rect, boxes: readonly Rect[], padding: number): Rect {
  const region = visibleRegion(vp, frame(vp, content, r, padding));
  const shown = (b: Rect): number => {
    const w = Math.min(b.x + b.w, region.x + region.w) - Math.max(b.x, region.x);
    const h = Math.min(b.y + b.h, region.y + region.h) - Math.max(b.y, region.y);
    return w > 0 && h > 0 ? (w * h) / (b.w * b.h) : 0;
  };
  const cut = boxes.filter((b) => { const f = shown(b); return f >= 0.4 && f < 1; });
  return union([r, ...cut]) ?? r;
}

/** The smallest pan that brings a rect fully into the visible area at the current scale; centres it when it cannot fit. */
export function reveal(vp: Viewport, cam: Camera, r: Rect, margin: number): Camera {
  const v = visible(vp);
  const axis = (pos: number, size: number, start: number, span: number, t: number): number => {
    const a = pos * cam.scale + t, b = (pos + size) * cam.scale + t;
    if (b - a > span - margin * 2) return start + span / 2 - (pos + size / 2) * cam.scale;
    if (a < start + margin) return t + (start + margin - a);
    if (b > start + span - margin) return t - (b - (start + span - margin));
    return t;
  };
  return { scale: cam.scale, tx: axis(r.x, r.w, v.x, v.w, cam.tx), ty: axis(r.y, r.h, v.y, v.h, cam.ty) };
}

/** The bounding rect of several rects, or undefined for none. */
export function union(rects: readonly Rect[]): Rect | undefined {
  if (!rects.length) return undefined;
  const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w)), y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

/** The part of the picture, in canvas pixels, that the reader sees clear of the panels: what a follower is shown. */
export function visibleRegion(vp: Viewport, cam: Camera): Rect {
  const v = visible(vp);
  return { x: (v.x - cam.tx) / cam.scale, y: (v.y - cam.ty) / cam.scale, w: v.w / cam.scale, h: v.h / cam.scale };
}

/** The camera that shows a region of the picture whole in this viewport, centred, whatever its shape; `clamp` bounds the scale and the centre holds. */
export function regionCamera(vp: Viewport, r: Rect, clamp: (s: number) => number = (s) => s): Camera {
  const v = visible(vp);
  const scale = clamp(Math.min(v.w / r.w, v.h / r.h));
  return { scale, tx: v.x + v.w / 2 - (r.x + r.w / 2) * scale, ty: v.y + v.h / 2 - (r.y + r.h / 2) * scale };
}

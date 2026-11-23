export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly w: number;
  readonly h: number;
}

export interface Rect extends Point, Size {}

export const rectRight = (r: Rect): number => r.x + r.w;
export const rectBottom = (r: Rect): number => r.y + r.h;
export const rectCenter = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;
}

export function rectContainsPoint(r: Rect, p: Point, margin = 0): boolean {
  return p.x > r.x - margin && p.x < r.x + r.w + margin && p.y > r.y - margin && p.y < r.y + r.h + margin;
}

export function inflate(r: Rect, m: number): Rect {
  return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
}

export function union(rects: readonly Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Axis-aligned segments only. Returns true when two segments cross at interior points. */
export function segmentsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const aH = a1.y === a2.y;
  const bH = b1.y === b2.y;
  if (aH === bH) return false;
  const h1 = aH ? a1 : b1, h2 = aH ? a2 : b2, v1 = aH ? b1 : a1, v2 = aH ? b2 : a2;
  const y = h1.y, x = v1.x;
  const hx0 = Math.min(h1.x, h2.x), hx1 = Math.max(h1.x, h2.x);
  const vy0 = Math.min(v1.y, v2.y), vy1 = Math.max(v1.y, v2.y);
  return x > hx0 && x < hx1 && y > vy0 && y < vy1;
}

/** True when an axis-aligned segment passes through the interior of a rect. */
export function segmentCrossesRect(p: Point, q: Point, r: Rect): boolean {
  const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x), y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
  return x0 < r.x + r.w && x1 > r.x && y0 < r.y + r.h && y1 > r.y;
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

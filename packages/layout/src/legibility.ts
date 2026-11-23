/**
 * What a reader trips on that crossings do not count: a label adrift from
 * its line, sitting on a frame, or cut by another line; two lines running
 * a hair apart or on top of each other; a jog a few pixels long; arrowheads
 * piled on one side of a box; story badges on top of each other; and text
 * cut short. Each check is a count, so a score can weigh it.
 */
import type { Point, Rect } from './geometry.ts';
import { rectsOverlap, segmentCrossesRect } from './geometry.ts';
import { textWidth } from './text/measure.ts';
import { chipWidth, RULES } from './style.ts';
import type { Extra, LayoutBox, LayoutEdge } from './types.ts';

const LEG = RULES.legibility;

export interface Legibility {
  /** Labels farther than LABEL_REACH from their own line, or as near another edge's line as their own. */
  readonly labelDrift: number;
  /** Labels another edge's line runs through. */
  readonly labelCrossed: number;
  /** Labels lying across a container's frame line. */
  readonly labelOnFrame: number;
  /** Pairs of parallel segments from different edges closer than HUG but not on top of each other. */
  readonly hugging: number;
  /** Runs where two different edges lie on one line for more than SHARED: the reader cannot tell them apart. */
  readonly sharedRuns: number;
  /** Runs of a line along a drawn border, closer than BORDER for more than 30px: the line reads as part of the frame. */
  readonly borderRuns: number;
  /** Long runs alongside a container's frame, closer than FRAME_NEAR for more than FRAME_RUN: the line tours the frame. */
  readonly frameRuns: number;
  /** Inner segments shorter than JOG: a kink, not a turn. */
  readonly jogs: number;
  /** Box sides where two separate ports sit closer than CROWD: arrowheads that touch read as a pile. */
  readonly crowdedSides: number;
  /** Story badges that cover another badge or a label. */
  readonly badgeOverlaps: number;
  /** Text lines cut short with an ellipsis. */
  readonly truncated: number;
  /** Edge segments that cross a container's title or facts. */
  readonly throughText: number;
  /** Routes that leave a container and come back into it: the line reads as lost. */
  readonly frameLoops: number;
  /** Edges whose route runs more than DETOUR times the distance between their ends. */
  readonly detours: number;
}

export const LABEL_REACH = RULES.legibility.labelReach;
export const LABEL_CLEAR = RULES.legibility.labelClear;
export const HUG = RULES.legibility.hug;
export const JOG = RULES.legibility.jog;
export const CROWD = RULES.legibility.crowd;
export const DETOUR = 2.6;
export const SHARED = RULES.legibility.shared;
export const BORDER = RULES.legibility.border;
export const FRAME_NEAR = RULES.legibility.frameNear;
export const FRAME_RUN = RULES.legibility.frameRun;

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The gap between a rect and a polyline: zero when the line touches it. */
export function rectToLine(r: Rect, pts: readonly Point[]): number {
  let best = Infinity;
  const corners: Point[] = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    // A segment that passes through the rect's span on its own axis is measured straight across.
    if (a.y === b.y && Math.max(a.x, b.x) >= r.x && Math.min(a.x, b.x) <= r.x + r.w) best = Math.min(best, a.y < r.y ? r.y - a.y : a.y > r.y + r.h ? a.y - r.y - r.h : 0);
    else if (a.x === b.x && Math.max(a.y, b.y) >= r.y && Math.min(a.y, b.y) <= r.y + r.h) best = Math.min(best, a.x < r.x ? r.x - a.x : a.x > r.x + r.w ? a.x - r.x - r.w : 0);
    else for (const c of corners) best = Math.min(best, distToSegment(c, a, b));
  }
  return best;
}

/** True when a rect straddles one of a container's four frame lines. */
export function onFrame(r: Rect, c: Rect, slack = 1): boolean {
  if (!rectsOverlap(r, c)) return false;
  const inside = r.x >= c.x - slack && r.y >= c.y - slack && r.x + r.w <= c.x + c.w + slack && r.y + r.h <= c.y + c.h + slack;
  const outside = r.x + r.w <= c.x + slack || r.x >= c.x + c.w - slack || r.y + r.h <= c.y + slack || r.y >= c.y + c.h - slack;
  return !inside && !outside;
}

function sideOf(p: Point, b: Rect): string | undefined {
  if (Math.abs(p.x - b.x) < LEG.onSide) return 'left';
  if (Math.abs(p.x - b.x - b.w) < LEG.onSide) return 'right';
  if (Math.abs(p.y - b.y) < LEG.onSide) return 'top';
  if (Math.abs(p.y - b.y - b.h) < LEG.onSide) return 'bottom';
  return undefined;
}

function pathLength(pts: readonly Point[]): number {
  let n = 0;
  for (let i = 0; i + 1 < pts.length; i++) n += Math.abs(pts[i + 1]!.x - pts[i]!.x) + Math.abs(pts[i + 1]!.y - pts[i]!.y);
  return n;
}

/** The rect a container's header text covers (title, subtitle, icon, and facts), in canvas pixels, padded a little. */
export function headerText(b: LayoutBox): (Rect & { id: string })[] {
  const blocks = [b.name, ...(b.subtitle ? [b.subtitle] : []), ...(b.texts ?? [])];
  let x0 = b.icon ? b.icon.x : Infinity, y0 = b.icon ? b.icon.y : Infinity, x1 = b.icon ? b.icon.x + b.icon.size : -Infinity, y1 = b.icon ? b.icon.y + b.icon.size : -Infinity;
  for (const t of blocks) {
    const w = Math.max(0, ...t.lines.map((l) => textWidth(l, t.size, t.weight)));
    const left = t.anchor === 'middle' ? t.x - w / 2 : t.x;
    x0 = Math.min(x0, left);
    x1 = Math.max(x1, left + w);
    y0 = Math.min(y0, t.y);
    y1 = Math.max(y1, t.y + t.lines.length * t.lineHeight);
  }
  if (!Number.isFinite(x0)) return [];
  const pad = LEG.headerPad;
  const text = { id: `${b.id}#header`, x: b.x + x0 - pad, y: b.y + y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  // The count chip ("+3 more") sits at the header's right end.
  if (!b.badge) return [text];
  const w = chipWidth(b.badge);
  return [text, { id: `${b.id}#chip`, x: b.x + b.w - LEG.chipInset - w - pad, y: b.y + LEG.chipTop - pad, w: w + pad * 2, h: RULES.chip.height + pad * 2 }];
}

export function measureLegibility(boxes: readonly LayoutBox[], edges: readonly LayoutEdge[], extras: readonly Extra[] = []): Legibility {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const containers = boxes.filter((b) => b.kind === 'container' && b.frame !== 'none');
  let labelDrift = 0, labelOnFrame = 0, labelCrossed = 0;
  for (const e of edges) {
    if (!e.label) continue;
    if (edges.some((o) => o !== e && o.points.slice(1).some((q, i) => segmentCrossesRect(o.points[i]!, q, e.label!)))) labelCrossed++;
    const own = rectToLine(e.label, e.points);
    if (own > LABEL_REACH || edges.some((o) => o !== e && o.label?.text !== e.label!.text && rectToLine(e.label!, o.points) <= Math.max(own + 2, LABEL_CLEAR))) labelDrift++;
    if (containers.some((c) => onFrame(e.label!, c))) labelOnFrame++;
  }

  interface Seg { a: Point; b: Point; edge: string; h: boolean }
  const segs: Seg[] = [];
  let jogs = 0;
  for (const e of edges) {
    for (let i = 0; i + 1 < e.points.length; i++) {
      const a = e.points[i]!, b = e.points[i + 1]!;
      if (a.x !== b.x && a.y !== b.y) continue;
      segs.push({ a, b, edge: e.id, h: a.y === b.y });
      const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (i > 0 && i + 2 < e.points.length && len > 0.5 && len < JOG) jogs++;
    }
  }
  let hugging = 0, sharedRuns = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i]!, t = segs[j]!;
      if (s.edge === t.edge || s.h !== t.h) continue;
      const gap = s.h ? Math.abs(s.a.y - t.a.y) : Math.abs(s.a.x - t.a.x);
      if (gap >= HUG) continue;
      const [s0, s1] = s.h ? [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)] : [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)];
      const [t0, t1] = t.h ? [Math.min(t.a.x, t.b.x), Math.max(t.a.x, t.b.x)] : [Math.min(t.a.y, t.b.y), Math.max(t.a.y, t.b.y)];
      const along = Math.min(s1, t1) - Math.max(s0, t0);
      if (gap < 1 && along > SHARED) sharedRuns++;
      else if (gap >= 1 && along > LEG.hugRun) hugging++;
    }
  }

  // Edges that share a port meet at one point: a side is crowded by the points on it, not the lines.
  let borderRuns = 0;
  const framed = boxes.filter((b) => b.frame !== 'none');
  for (const s of segs) {
    for (const b of framed) {
      const lines = s.h ? [b.y, b.y + b.h] : [b.x, b.x + b.w];
      const at = s.h ? s.a.y : s.a.x;
      if (!lines.some((l) => Math.abs(l - at) < BORDER)) continue;
      const [s0, s1] = s.h ? [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)] : [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)];
      const [b0, b1] = s.h ? [b.x, b.x + b.w] : [b.y, b.y + b.h];
      if (Math.min(s1, b1) - Math.max(s0, b0) > LEG.borderRun) borderRuns++;
    }
  }
  let frameRuns = 0;
  for (const s of segs) {
    for (const c of containers) {
      const lines = s.h ? [c.y, c.y + c.h] : [c.x, c.x + c.w];
      const at = s.h ? s.a.y : s.a.x;
      if (!lines.some((l) => Math.abs(l - at) < FRAME_NEAR)) continue;
      const [s0, s1] = s.h ? [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)] : [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)];
      const [c0, c1] = s.h ? [c.x, c.x + c.w] : [c.y, c.y + c.h];
      if (Math.min(s1, c1) - Math.max(s0, c0) > FRAME_RUN) frameRuns++;
    }
  }
  const sides = new Map<string, Set<string>>();
  for (const e of edges) {
    const ends: [string, Point | undefined][] = [[e.from, e.points[0]], [e.to, e.points[e.points.length - 1]]];
    for (const [id, p] of ends) {
      const b = byId.get(id);
      const side = b && p ? sideOf(p, b) : undefined;
      if (side) sides.set(`${id}|${side}`, (sides.get(`${id}|${side}`) ?? new Set()).add(`${Math.round(p!.x)},${Math.round(p!.y)}`));
    }
  }
  const crowdedSides = [...sides.values()].filter((set) => {
    const at = [...set].map((k) => k.split(',').map(Number) as [number, number]);
    return at.some((a, i) => at.some((b, j) => j > i && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < CROWD));
  }).length;

  const badgeRects = extras.flatMap((x) => (x.kind === 'badge' ? [{ x: x.at.x - LEG.badgeHalf, y: x.at.y - LEG.badgeHalf, w: LEG.badgeHalf * 2, h: LEG.badgeHalf * 2 }] : []));
  const labels = edges.flatMap((e) => (e.label ? [e.label] : []));
  let badgeOverlaps = 0;
  badgeRects.forEach((r, i) => {
    if (badgeRects.some((o, j) => j > i && rectsOverlap(r, o))) badgeOverlaps++;
    if (labels.some((l) => rectsOverlap(r, l))) badgeOverlaps++;
  });

  let truncated = 0;
  for (const b of boxes) for (const t of [b.name, b.subtitle, ...(b.texts ?? [])]) if (t) truncated += t.lines.filter((l) => l.endsWith('…')).length;

  let detours = 0;
  for (const e of edges) {
    const a = e.points[0], z = e.points[e.points.length - 1];
    if (!a || !z || e.from === e.to) continue;
    const direct = Math.abs(a.x - z.x) + Math.abs(a.y - z.y);
    const len = pathLength(e.points);
    if (len > LEG.detourMin && len > direct * DETOUR) detours++;
  }
  const headers = boxes.flatMap((b) => (b.kind === 'container' ? headerText(b) : []));
  let throughText = 0;
  for (const e of edges) for (let i = 0; i + 1 < e.points.length; i++) for (const h of headers) if (segmentCrossesRect(e.points[i]!, e.points[i + 1]!, h)) throughText++;
  let frameLoops = 0;
  for (const e of edges) {
    for (const f of containers) {
      const inside = (p: Point): boolean => p.x > f.x && p.x < f.x + f.w && p.y > f.y && p.y < f.y + f.h;
      let changes = 0;
      for (let i = 0; i + 1 < e.points.length; i++) if (inside(e.points[i]!) !== inside(e.points[i + 1]!)) changes++;
      const a = e.points[0], z = e.points[e.points.length - 1];
      if (a && z && inside(a) === inside(z) && changes >= 2) frameLoops++;
    }
  }
  return { frameLoops, labelDrift, labelCrossed, labelOnFrame, hugging, sharedRuns, borderRuns, frameRuns, jogs, crowdedSides, badgeOverlaps, truncated, throughText, detours };
}

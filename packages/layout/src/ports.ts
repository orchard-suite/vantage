/**
 * Where an edge leaves and enters a box. Forward edges leave the flow-facing
 * side and arrive on the opposite side; edges between boxes stacked across
 * the flow use the near sides. Ports on one side are spread evenly and
 * sorted by where the other end sits, so edges never cross at the box.
 */
import type { Direction } from '@vantage/model';
import type { Point, Rect } from './geometry.ts';
import { RULES } from './style.ts';

export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface PortRequest {
  readonly edgeId: string;
  readonly from: Rect;
  readonly to: Rect;
  readonly fromId: string;
  readonly toId: string;
  /** Where along its side an end would rather sit: for an edge lifted to a container, the middle of the boxes it stands for. */
  readonly fromFocus?: Point;
  readonly toFocus?: Point;
  /** Width of a chip ("3 inside") straddling the top-right corner of either box; top ports keep left of it. */
  readonly fromChip?: number;
  readonly toChip?: number;
  /** Sides the caller has already settled, such as a decision's branches leaving by its corners. */
  readonly sides?: { readonly fromSide: Side; readonly toSide: Side };
}

export interface PortAssignment {
  readonly edgeId: string;
  readonly fromSide: Side;
  readonly toSide: Side;
  readonly fromPoint: Point;
  readonly toPoint: Point;
}

function centre(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function chooseSides(from: Rect, to: Rect, direction: Direction): { fromSide: Side; toSide: Side } {
  const slack = 8;
  // Boxes apart on both axes face each other across the wider gap: a ring's spokes meet the hub on the side they come from.
  const gapX = Math.max(to.x - (from.x + from.w), from.x - (to.x + to.w));
  const gapY = Math.max(to.y - (from.y + from.h), from.y - (to.y + to.h));
  const horizontal = gapX > slack && gapY > slack ? gapX >= gapY : direction === 'right' || direction === 'left';
  if (horizontal) {
    if (to.x >= from.x + from.w - slack) return { fromSide: 'right', toSide: 'left' };
    if (to.x + to.w <= from.x + slack) return { fromSide: 'left', toSide: 'right' };
    return centre(to).y > centre(from).y ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' };
  }
  if (to.y >= from.y + from.h - slack) return { fromSide: 'bottom', toSide: 'top' };
  if (to.y + to.h <= from.y + slack) return { fromSide: 'top', toSide: 'bottom' };
  return centre(to).x > centre(from).x ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' };
}

export function assignPorts(requests: readonly PortRequest[], direction: Direction): Map<string, PortAssignment> {
  const sides = new Map(requests.map((r) => [r.edgeId, r.sides ?? chooseSides(r.from, r.to, direction)]));
  interface Slot {
    edgeId: string;
    end: 'from' | 'to';
    rect: Rect;
    side: Side;
    other: Point;
    chip?: number;
    focus?: Point;
  }
  const groups = new Map<string, Slot[]>();
  for (const r of requests) {
    const s = sides.get(r.edgeId)!;
    const add = (end: 'from' | 'to', rect: Rect, id: string, side: Side, other: Rect): void => {
      const k = `${id}|${side}`;
      const list = groups.get(k) ?? [];
      const chip = end === 'from' ? r.fromChip : r.toChip;
      const focus = end === 'from' ? r.fromFocus : r.toFocus;
      list.push({ edgeId: r.edgeId, end, rect, side, other: centre(other), ...(chip ? { chip } : {}), ...(focus ? { focus } : {}) });
      groups.set(k, list);
    };
    add('from', r.from, r.fromId, s.fromSide, r.to);
    add('to', r.to, r.toId, s.toSide, r.from);
  }
  const points = new Map<string, { from?: Point; to?: Point }>();
  for (const slots of groups.values()) {
    const side = slots[0]!.side;
    const vertical = side === 'left' || side === 'right';
    slots.sort((a, b) => sweep(a, side) - sweep(b, side) || a.edgeId.localeCompare(b.edgeId));
    const n = slots.length;
    // A chip on the top-right corner takes that end of the top side.
    const r0 = slots[0]!.rect;
    const start = vertical ? r0.y : r0.x;
    const length = side === 'top' && slots[0]!.chip ? Math.max(r0.w * 0.4, r0.w - slots[0]!.chip - 8) : vertical ? r0.h : r0.w;
    // Each port wants its even share of the side, or its focus when it has one; then they are pushed apart to PORT_GAP and kept on the side.
    const want = slots.map((s, i) => {
      const even = start + length * ((i + 1) / (n + 1));
      return s.focus ? Math.max(start + PORT_GAP / 2, Math.min(start + length - PORT_GAP / 2, vertical ? s.focus.y : s.focus.x)) : even;
    });
    const gap = Math.min(PORT_GAP, length / (n + 1));
    const order = slots.map((_, i) => i).sort((a, b) => want[a]! - want[b]! || a - b);
    const at = new Map<number, number>();
    let prev = -Infinity;
    for (const i of order) { const v = Math.max(want[i]!, prev + gap); at.set(i, v); prev = v; }
    let next = Infinity;
    for (const i of [...order].reverse()) { const v = Math.min(at.get(i)!, next - gap, start + length - gap / 2); at.set(i, v); next = v; }
    slots.forEach((s, i) => {
      const r = s.rect;
      const c = Math.round(Math.max(start + gap / 2, at.get(i)!));
      const p: Point = vertical ? { x: side === 'left' ? r.x : r.x + r.w, y: c } : { x: c, y: side === 'top' ? r.y : r.y + r.h };
      const entry = points.get(s.edgeId) ?? {};
      entry[s.end] = p;
      points.set(s.edgeId, entry);
    });
  }
  straightPorts(requests, sides, points);
  const out = new Map<string, PortAssignment>();
  for (const r of requests) {
    const s = sides.get(r.edgeId)!;
    const p = points.get(r.edgeId)!;
    out.set(r.edgeId, { edgeId: r.edgeId, fromSide: s.fromSide, toSide: s.toSide, fromPoint: p.from!, toPoint: p.to! });
  }
  return out;
}

/**
 * Where a port's line heads, as an angle swept along its side in port
 * order (top to bottom on left and right, left to right on top and
 * bottom). Ports in sweep order never cross at the box, even when their
 * other ends sit level: the line to the farthest of three boxes below
 * and to the left leaves highest on the left side and drops last.
 */
function sweep(s: { rect: Rect; other: Point }, side: Side): number {
  const c = centre(s.rect);
  const a = (Math.atan2(s.other.y - c.y, s.other.x - c.x) * 180) / Math.PI;
  const mod = (v: number): number => ((v % 360) + 360) % 360;
  switch (side) {
    case 'left': return mod(-90 - a);
    case 'right': return mod(a + 90);
    case 'top': return mod(a - 180);
    case 'bottom': return mod(180 - a);
  }
}

export const PORT_GAP = RULES.portGap;

/**
 * Two boxes that face each other with room to spare are joined by a straight
 * line: both ports move to one shared coordinate inside their overlap, the
 * one nearest where even spreading put them, when that keeps every other
 * port on both sides PORT_GAP away. Even spreading alone leaves a jog where
 * a straight line was free.
 */
function straightPorts(requests: readonly PortRequest[], sides: ReadonlyMap<string, { fromSide: Side; toSide: Side }>, points: Map<string, { from?: Point; to?: Point }>): void {
  const opposite: Record<Side, Side> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
  const onSide = (id: string, side: Side, except: string): Point[] => {
    const out: Point[] = [];
    for (const r of requests) {
      if (r.edgeId === except) continue;
      const s = sides.get(r.edgeId)!, p = points.get(r.edgeId)!;
      if (r.fromId === id && s.fromSide === side && p.from) out.push(p.from);
      if (r.toId === id && s.toSide === side && p.to) out.push(p.to);
    }
    return out;
  };
  for (const r of requests) {
    const s = sides.get(r.edgeId)!;
    if (opposite[s.fromSide] !== s.toSide) continue;
    const p = points.get(r.edgeId)!;
    const vertical = s.fromSide === 'left' || s.fromSide === 'right';
    const lo = vertical ? Math.max(r.from.y, r.to.y) + PORT_GAP : Math.max(r.from.x, r.to.x) + PORT_GAP;
    const chipAt = (rect: Rect, side: Side, chip: number | undefined): number => (side === 'top' && chip ? rect.x + rect.w - chip - 8 : Infinity);
    const hi = vertical ? Math.min(r.from.y + r.from.h, r.to.y + r.to.h) - PORT_GAP : Math.min(r.from.x + r.from.w, r.to.x + r.to.w, chipAt(r.from, s.fromSide, r.fromChip), chipAt(r.to, s.toSide, r.toChip)) - PORT_GAP;
    if (hi < lo) continue;
    const at = (q: Point): number => (vertical ? q.y : q.x);
    const fromNow = at(p.from!), toNow = at(p.to!);
    if (fromNow === toNow) continue;
    const others = [...onSide(r.fromId, s.fromSide, r.edgeId).map(at), ...onSide(r.toId, s.toSide, r.edgeId).map(at)];
    const free = (c: number): boolean => others.every((o) => Math.abs(o - c) >= PORT_GAP);
    const want = Math.round(Math.max(lo, Math.min(hi, (fromNow + toNow) / 2)));
    // The nearest free coordinate to the midpoint, searched outward in small steps.
    let pick: number | undefined;
    for (let d = 0; d <= hi - lo && pick === undefined; d += 2) {
      for (const c of [want - d, want + d]) if (c >= lo && c <= hi && free(c)) { pick = c; break; }
    }
    if (pick === undefined) continue;
    points.set(r.edgeId, vertical ? { from: { x: p.from!.x, y: pick }, to: { x: p.to!.x, y: pick } } : { from: { x: pick, y: p.from!.y }, to: { x: pick, y: p.to!.y } });
  }
}

export function sideNormal(side: Side): Point {
  switch (side) {
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
    case 'top':
      return { x: 0, y: -1 };
    case 'bottom':
      return { x: 0, y: 1 };
  }
}

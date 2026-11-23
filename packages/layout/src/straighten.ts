/**
 * A jog of a few pixels between two parallel runs reads as a kink, not a
 * turn. After routing, each short jog is removed by sliding one of its
 * neighbouring runs onto the other's line, when the slid run hits no box
 * it may not cross and, where it ends on a port, the port stays on its side
 * clear of the corners and of the other ports there.
 */
import type { Point, Rect } from './geometry.ts';
import { segmentCrossesRect } from './geometry.ts';
import { simplify } from './route.ts';
import { RULES } from './style.ts';

export const KINK = RULES.kink;
const PORT_ROOM = RULES.portRoom;

export interface StraightenEdge {
  readonly id: string;
  readonly points: readonly Point[];
  readonly from: Rect;
  readonly to: Rect;
  /** Boxes this edge may cross: its ends and their ancestors. */
  readonly transparent: ReadonlySet<string>;
}

export interface Obstacle extends Rect {
  readonly id: string;
}

function onSide(p: Point, r: Rect): 'h' | 'v' | undefined {
  if (Math.abs(p.x - r.x) < 0.5 || Math.abs(p.x - r.x - r.w) < 0.5) return 'v';
  if (Math.abs(p.y - r.y) < 0.5 || Math.abs(p.y - r.y - r.h) < 0.5) return 'h';
  return undefined;
}

/** A port slid along its side to a new point: still on the side, off the corners, apart from the others. */
function portFits(p: Point, r: Rect, others: readonly Point[]): boolean {
  const side = onSide(p, r);
  if (side === 'v' && (p.y < r.y + PORT_ROOM || p.y > r.y + r.h - PORT_ROOM)) return false;
  if (side === 'h' && (p.x < r.x + PORT_ROOM || p.x > r.x + r.w - PORT_ROOM)) return false;
  return !others.some((o) => Math.abs(o.x - p.x) + Math.abs(o.y - p.y) < PORT_ROOM);
}

function clear(pts: readonly Point[], from: number, to: number, obstacles: readonly Obstacle[], transparent: ReadonlySet<string>): boolean {
  for (let i = Math.max(0, from); i < Math.min(pts.length - 1, to); i++) {
    for (const o of obstacles) {
      if (transparent.has(o.id)) continue;
      if (segmentCrossesRect(pts[i]!, pts[i + 1]!, { x: o.x + 1, y: o.y + 1, w: o.w - 2, h: o.h - 2 })) return false;
    }
  }
  return true;
}

/** Removes short jogs from every edge; edges are handled in order, each seeing the ports the others already hold. */
export function straighten(edges: readonly StraightenEdge[], obstacles: readonly Obstacle[]): Map<string, Point[]> {
  const out = new Map(edges.map((e) => [e.id, [...e.points]]));
  const ports = (except: string): Point[] => [...out.entries()].filter(([k]) => k !== except).flatMap(([, p]) => [p[0]!, p[p.length - 1]!]);
  for (const e of edges) {
    let pts = out.get(e.id)!;
    for (let guard = 0; guard < 8; guard++) {
      let changed = false;
      for (let i = 1; i + 2 < pts.length; i++) {
        const a = pts[i]!, b = pts[i + 1]!;
        if (a.x !== b.x && a.y !== b.y) continue;
        const horizontalJog = a.y === b.y;
        const len = horizontalJog ? Math.abs(a.x - b.x) : Math.abs(a.y - b.y);
        if (len < 0.5 || len >= KINK) continue;
        // Try sliding the run before the jog onto the run after it, then the other way.
        for (const before of [true, false]) {
          const next = pts.map((p) => ({ ...p }));
          const target = before ? b : a;
          const [lo, hi] = before ? [0, i] : [i + 1, pts.length - 1];
          // The run to slide is the stretch of points sharing the jog's start (or end) coordinate, back to the previous turn.
          const idx = before ? [i - 1, i] : [i + 1, i + 2];
          for (const k of idx) {
            if (k < lo || k > hi) continue;
            if (horizontalJog) next[k]!.x = target.x;
            else next[k]!.y = target.y;
          }
          const first = next[0]!, last = next[next.length - 1]!;
          if (idx.includes(0) && !portFits(first, e.from, ports(e.id))) continue;
          if (idx.includes(next.length - 1) && !portFits(last, e.to, ports(e.id))) continue;
          if (!clear(next, Math.min(...idx) - 1, Math.max(...idx) + 1, obstacles, e.transparent)) continue;
          pts = simplify(next);
          changed = true;
          break;
        }
        if (changed) break;
      }
      if (!changed) break;
    }
    out.set(e.id, pts);
  }
  return out;
}

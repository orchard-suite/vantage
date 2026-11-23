/**
 * Two relations whose runs lie on one line, overlapping or end to end
 * across a short gap, read as a single stroke. After routing, an inner run
 * of the later edge is slid sideways by a lane, onto open ground: the runs
 * either side of it stretch to meet it. A slide that would cross a box, or
 * land on yet another line, is not made.
 */
import type { Point, Rect } from './geometry.ts';
import { segmentCrossesRect } from './geometry.ts';
import { simplify } from './path.ts';

/** How far a run is slid to part it from another. */
export const PART = 18;
/** A slid run must keep at least this far from any other line beside it, and from box borders. */
const CLEAR = 16;
/** Runs closer than this sideways count as one line. */
const SIDE = 3;
/** End to end across a gap shorter than this, two runs read as one stroke. */
const GAP = 120;

export interface SeparateObstacle extends Rect {
  readonly id: string;
}

interface Run { readonly edge: string; readonly i: number; readonly h: boolean; readonly at: number; readonly lo: number; readonly hi: number }

function runsOf(id: string, pts: readonly Point[]): Run[] {
  const out: Run[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    if (a.y === b.y && a.x !== b.x) out.push({ edge: id, i, h: true, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    else if (a.x === b.x && a.y !== b.y) out.push({ edge: id, i, h: false, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
  }
  return out;
}

function oneStroke(r: Run, s: Run): boolean {
  return r.edge !== s.edge && r.h === s.h && Math.abs(r.at - s.at) < SIDE && Math.min(r.hi, s.hi) - Math.max(r.lo, s.lo) > -GAP;
}

/** A parallel run of another edge within CLEAR sideways, overlapping along its length. */
function beside(r: Run, s: Run): boolean {
  return r.edge !== s.edge && r.h === s.h && Math.abs(r.at - s.at) < CLEAR && Math.min(r.hi, s.hi) - Math.max(r.lo, s.lo) > 0;
}

/** A run that would lie along a box's side, closer than CLEAR, for part of its length. */
function alongBorder(r: Run, o: Rect): boolean {
  const sides = r.h ? [o.y, o.y + o.h] : [o.x, o.x + o.w];
  const [o0, o9] = r.h ? [o.x, o.x + o.w] : [o.y, o.y + o.h];
  return sides.some((v) => Math.abs(v - r.at) < CLEAR) && Math.min(r.hi, o9) - Math.max(r.lo, o0) > 0;
}

/** Slides inner runs apart where two edges would read as one stroke; edges are given as id to points, and may cross only their own transparent boxes. */
export function separate(routes: Map<string, Point[]>, transparent: ReadonlyMap<string, ReadonlySet<string>>, obstacles: readonly SeparateObstacle[]): void {
  const ids = [...routes.keys()];
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    for (const id of ids) {
      const pts = routes.get(id)!;
      const mine = runsOf(id, pts);
      const others = ids.filter((o) => o !== id).flatMap((o) => runsOf(o, routes.get(o)!));
      let here = false;
      for (const r of mine) {
        // Only an inner run can slide: the first and last leave and enter their ports.
        if (r.i === 0 || r.i + 2 >= pts.length) continue;
        if (!others.some((s) => oneStroke(r, s))) continue;
        for (const d of [PART, -PART]) {
          const next = pts.map((p) => ({ ...p }));
          for (const k of [r.i, r.i + 1]) {
            if (r.h) next[k]!.y += d;
            else next[k]!.x += d;
          }
          // The slid run and the two runs that stretch to meet it must all land in the clear.
          const changed = runsOf(id, next).filter((x) => x.i >= r.i - 1 && x.i <= r.i + 1);
          const slid = changed.find((x) => x.i === r.i);
          if (!slid || others.some((s) => oneStroke(slid, s))) continue;
          if (changed.some((c) => others.some((s) => beside(c, s)) || obstacles.some((o) => alongBorder(c, o)))) continue;
          const own = transparent.get(id) ?? new Set<string>();
          const hits = [r.i - 1, r.i, r.i + 1].some((k) => k >= 0 && k + 1 < next.length && obstacles.some((o) => !own.has(o.id) && segmentCrossesRect(next[k]!, next[k + 1]!, { x: o.x + 1, y: o.y + 1, w: o.w - 2, h: o.h - 2 })));
          if (hits) continue;
          routes.set(id, simplify(next));
          moved = here = true;
          break;
        }
        if (here) break;
      }
    }
    if (!moved) break;
  }
}

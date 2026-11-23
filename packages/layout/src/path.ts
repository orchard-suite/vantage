/** Orthogonal polylines without a grid: merging collinear points, and the fewest-bend route between two ports. */
import type { Point } from './geometry.ts';
import type { Side } from './ports.ts';
import { sideNormal } from './ports.ts';

/** Drops repeated points and the middle of any three in a line, so a route is its corners only. */
export function simplify(pts: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const a = out[out.length - 2], b = out[out.length - 1];
    if (b && b.x === p.x && b.y === p.y) continue;
    if (a && b && ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y))) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/** The fewest-bend route between two ports, ignoring obstacles: what an arrow draws when nothing is in its way. */
export function directRoute(start: Point, end: Point, fromSide: Side, margin: number): Point[] {
  const n = sideNormal(fromSide);
  const p1 = { x: start.x + n.x * margin, y: start.y + n.y * margin };
  if (n.x !== 0) {
    const midX = (p1.x + end.x) / 2;
    return simplify([start, p1, { x: midX, y: p1.y }, { x: midX, y: end.y }, end]);
  }
  const midY = (p1.y + end.y) / 2;
  return simplify([start, p1, { x: p1.x, y: midY }, { x: end.x, y: midY }, end]);
}

/**
 * Orthogonal edge routing on a sparse grid built from box edges, box
 * centres, and port positions. A* with a bend penalty finds the route with
 * the fewest turns that avoids every box it is not allowed to cross. Boxes
 * that contain an endpoint are transparent; everything else is an obstacle.
 */
import type { Point, Rect } from './geometry.ts';
import type { Side } from './ports.ts';
import { sideNormal } from './ports.ts';
import { directRoute, simplify } from './path.ts';

export { directRoute, simplify } from './path.ts';

export interface RouteObstacle extends Rect {
  readonly id: string;
  /** Hard obstacles are leaves; soft ones are containers an edge may pass through at a cost. */
  readonly hard: boolean;
  /** A container with no drawn frame: routes ignore it, since hugging an invisible border reads as a frame. */
  readonly ghost?: boolean;
  /** Words (a title, a chip), not a drawn shape: no border to keep off and no grid lines of its own, only an area no step may run through. */
  readonly words?: boolean;
  /** Adds no grid lines of its own: it only prices the steps that pass through it (container titles, count chips). */
  readonly priceOnly?: boolean;
}

export interface RouteRequest {
  readonly id: string;
  readonly from: Point;
  readonly to: Point;
  readonly fromSide: Side;
  readonly toSide: Side;
  /** Ids of boxes this edge may pass through freely (its endpoints and their ancestors). */
  readonly transparent: ReadonlySet<string>;
  /** Ancestors of both endpoints: travelling inside them is free, since the edge belongs there. */
  readonly common?: ReadonlySet<string>;
}

export interface RouterOptions {
  readonly margin: number;
  readonly bendCost: number;
  readonly softCost: number;
  readonly hardCost: number;
  readonly sharedCost: number;
  /** Cost of crossing an edge routed earlier; routes are routed longest first so short ones go around. */
  readonly crossCost: number;
  /** Cost per pixel travelled outside a container that holds both ends: a line between two of its children stays in it. */
  readonly outsideFactor: number;
  /** Extra cost per pixel travelled inside a container, so routes stay in gutters and enter late. */
  readonly insideFactor: number;
  /** Per-step cost for a segment that is not on a gutter centre line. */
  readonly channelCost: number;
  /** Extra cost per pixel travelled along a container's padding ring; the approach to a port crosses it, routes should not run in it. */
  readonly ringFactor: number;
  /** Cost per pixel of running along a drawn box border, closer than borderGap: a line on a border reads as part of the box. */
  readonly borderFactor: number;
  readonly borderGap: number;
  /** Cost per pixel of running beside a container's frame, closer than frameGap: gentler than a border, and wider. */
  readonly frameFactor: number;
  readonly frameGap: number;
  /** How far past a lower bound the search's estimate leans: above 1 it explores far fewer cells, and a route stays within this factor of the cheapest; 1 finds the cheapest. */
  readonly heuristicWeight: number;
  /** Shortest straight run out of and into a port: room for the arrowhead before a turn. */
  readonly stub: number;
  /** Cost per pixel of running beside an earlier segment, closer than a lane. */
  readonly crowdFactor: number;
  /** Distance of the side lanes beside each gutter centre line, so parallel edges can run apart instead of on top of each other. */
  readonly lane: number;
}

export const DEFAULT_ROUTER: RouterOptions = { margin: 14, bendCost: 60, softCost: 400, hardCost: 4000, sharedCost: 250, crossCost: 90, insideFactor: 0.6, outsideFactor: 3, channelCost: 1, ringFactor: 2.5, lane: 16, crowdFactor: 4, borderFactor: 2, borderGap: 8, frameFactor: 1.2, frameGap: 28, stub: 8, heuristicWeight: 1.3 };

/** What earlier routes hold, by grid cell (`xi * ys.length + yi`). */
interface Occupancy {
  /** Routes on the grid step that starts at the cell and runs right (h) or down (v). */
  readonly h: Int32Array;
  readonly v: Int32Array;
  /** Grid nodes strictly inside a horizontal or vertical segment of an earlier route. */
  readonly hThrough: Int32Array;
  readonly vThrough: Int32Array;
  /** Earlier segments by the coordinate they run along: y for horizontal, x for vertical. */
  readonly hRuns: Runs;
  readonly vRuns: Runs;
}

export class OrthogonalRouter {
  private readonly xs: number[];
  private readonly ys: number[];
  /** Gutter centre lines: where a jog between two boxes looks deliberate. */
  private readonly channelX = new Set<number>();
  private readonly channelY = new Set<number>();
  /** Whether each grid line is a gutter centre line or lane, by index. */
  private readonly onChannelX: Uint8Array;
  private readonly onChannelY: Uint8Array;
  private readonly occupancy: Occupancy;
  private readonly byId: Map<string, RouteObstacle>;
  /** Reserved lines, held twice as hard as a route, and every route so far by edge id: what occupancy is rebuilt from. */
  private readonly reserved: Point[][] = [];
  private readonly routes = new Map<string, Point[]>();
  /** Per grid step (stepKey), what of the boxes depends on geometry alone: the border-hugging cost and the boxes its midpoint can sit in. */
  private readonly steps: (StepBoxes | undefined)[];
  /** Per grid step, what earlier routes add to it: sharing and crowding. Known where flagged; a segment added or taken away unflags the steps it changes (touched). */
  private readonly traffic: Float64Array;
  private readonly trafficKnown: Uint8Array;
  /** The search's cost and parent per state (cell and heading), valid where its stamp is the current search. */
  private readonly best: Float64Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private search = 0;
  /** Per grid step, what crossing boxes costs the route being searched: fixed for one route, so worked out once. Valid where its stamp is the current search. */
  private readonly crossing: Float64Array;
  private readonly crossingStamp: Uint32Array;

  constructor(private readonly obstacles: readonly RouteObstacle[], ports: readonly Point[], private readonly opts: RouterOptions = DEFAULT_ROUTER) {
    this.byId = new Map(obstacles.map((o) => [o.id, o]));
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (const o of obstacles) {
      // A keep-out with no lines of its own (a title, a chip) only prices the grid the boxes already made.
      if (o.priceOnly || o.words) continue;
      for (const x of [o.x - opts.margin, o.x + o.w + opts.margin, o.x + o.w / 2]) xs.add(Math.round(x));
      for (const y of [o.y - opts.margin, o.y + o.h + opts.margin, o.y + o.h / 2]) ys.add(Math.round(y));
    }
    for (const p of ports) {
      xs.add(Math.round(p.x));
      ys.add(Math.round(p.y));
    }
    // Channels: the middle of a gap that runs from one box's far edge to another box's near edge.
    // Padding inside a container (child edge to parent edge) is not a gutter.
    const addChannels = (axis: 'x' | 'y'): void => {
      const marks: { at: number; kind: 'start' | 'end' }[] = [];
      for (const o of obstacles) {
        marks.push({ at: Math.round(axis === 'x' ? o.x : o.y), kind: 'start' });
        marks.push({ at: Math.round(axis === 'x' ? o.x + o.w : o.y + o.h), kind: 'end' });
      }
      marks.sort((a, b) => a.at - b.at);
      const into = axis === 'x' ? this.channelX : this.channelY;
      const coords = axis === 'x' ? xs : ys;
      for (let i = 0; i + 1 < marks.length; i++) {
        const a = marks[i]!, b = marks[i + 1]!;
        if (a.kind !== 'end' || b.kind !== 'start' || b.at - a.at < opts.margin * 2.5) continue;
        const mid = Math.round((a.at + b.at) / 2);
        const insideHard = obstacles.some((o) => o.hard && (axis === 'x' ? mid > o.x && mid < o.x + o.w : mid > o.y && mid < o.y + o.h));
        if (insideHard) continue;
        // The centre line and a lane either side: three tracks, so edges sharing a gutter run side by side.
        for (const at of b.at - a.at >= opts.margin * 2.5 + opts.lane * 2 ? [mid - opts.lane, mid, mid + opts.lane] : [mid]) {
          into.add(at);
          coords.add(at);
        }
      }
    };
    addChannels('x');
    addChannels('y');
    this.xs = [...xs].sort((a, b) => a - b);
    this.ys = [...ys].sort((a, b) => a - b);
    const cells = this.xs.length * this.ys.length;
    this.onChannelX = Uint8Array.from(this.xs, (x) => (this.channelX.has(x) ? 1 : 0));
    this.onChannelY = Uint8Array.from(this.ys, (y) => (this.channelY.has(y) ? 1 : 0));
    const empty = (): Int32Array => new Int32Array(cells);
    this.occupancy = { h: empty(), v: empty(), hThrough: empty(), vThrough: empty(), hRuns: new Runs(), vRuns: new Runs() };
    this.steps = new Array<StepBoxes | undefined>(cells * 2);
    this.traffic = new Float64Array(cells * 2);
    this.trafficKnown = new Uint8Array(cells * 2);
    this.best = new Float64Array(cells * 4);
    this.parent = new Int32Array(cells * 4);
    this.seen = new Uint32Array(cells * 4);
    this.crossing = new Float64Array(cells * 2);
    this.crossingStamp = new Uint32Array(cells * 2);
  }

  route(req: RouteRequest): Point[] {
    const xs = this.xs, ys = this.ys;
    const start = { x: req.from.x, y: req.from.y };
    const end = { x: req.to.x, y: req.to.y };
    const xi0 = indexOf(xs, start.x), yi0 = indexOf(ys, start.y);
    const xi1 = indexOf(xs, end.x), yi1 = indexOf(ys, end.y);
    if (xi0 < 0 || yi0 < 0 || xi1 < 0 || yi1 < 0) return [start, end];

    // Search the whole grid unless it is huge; a tight window forces routes through boxes.
    const found = this.search1(req, start, end, xi0, yi0, xi1, yi1, xs.length * ys.length > 90000 ? 12 : xs.length + ys.length);
    if (found === undefined) return directRoute(start, end, req.fromSide, this.opts.margin);
    const parent = this.parent, ny = ys.length;
    const pts: Point[] = [];
    for (let k = found; k >= 0; k = parent[k]!) {
      const cell = k >> 2;
      pts.push({ x: xs[Math.floor(cell / ny)]!, y: ys[cell % ny]! });
    }
    pts.reverse();
    const simplified = simplify(pts);
    this.keep(req.id, simplified);
    return simplified;
  }


  /** One A* search inside a window `pad` grid lines round the two ends: the end state, or undefined when none is reached. */
  private search1(req: RouteRequest, start: Point, end: Point, xi0: number, yi0: number, xi1: number, yi1: number, pad: number): number | undefined {
    const xs = this.xs, ys = this.ys;
    const n = sideNormal(req.fromSide);
    const bx0 = Math.max(0, Math.min(xi0, xi1) - pad), bx1 = Math.min(xs.length - 1, Math.max(xi0, xi1) + pad);
    const by0 = Math.max(0, Math.min(yi0, yi1) - pad), by1 = Math.min(ys.length - 1, Math.max(yi0, yi1) + pad);

    const startDir = DIRS.findIndex((d) => d.x === n.x && d.y === n.y);
    const endNormal = sideNormal(req.toSide);
    const ny = ys.length;
    const key = (xi: number, yi: number, d: number): number => ((xi * ny + yi) << 2) | d;
    const open = new Heap();
    const best = this.best, parent = this.parent, seen = this.seen;
    const search = ++this.search;
    const sk = key(xi0, yi0, startDir);
    best[sk] = 0;
    parent[sk] = -1;
    seen[sk] = search;
    open.push(sk, 0);
    const { hThrough, vThrough } = this.occupancy;
    const o = this.opts;
    const endX = end.x, endY = end.y;
    let found: number | undefined;
    let expansions = 0;
    while (open.size) {
      const cur = open.pop();
      const d = cur & 3, cell = cur >> 2, xi = Math.floor(cell / ny), yi = cell % ny;
      const dx = DX[d]!, dy = DY[d]!;
      if (xi === xi1 && yi === yi1 && dx === -endNormal.x && dy === -endNormal.y) {
        found = cur;
        break;
      }
      if (expansions++ > 200000) break;
      const g = best[cur]!;
      const ax = xs[xi]!, ay = ys[yi]!;
      for (let nd = 0; nd < 4; nd++) {
        const sx = DX[nd]!, sy = DY[nd]!;
        if (sx === -dx && sy === -dy) continue;
        const nxi = xi + sx, nyi = yi + sy;
        if (nxi < bx0 || nxi > bx1 || nyi < by0 || nyi > by1) continue;
        const bx = xs[nxi]!, by = ys[nyi]!;
        const len = Math.abs(bx - ax) + Math.abs(by - ay);
        const step = this.stepKey(xi, yi, nxi, nyi);
        let crossing: number;
        if (this.crossingStamp[step] === search) crossing = this.crossing[step]!;
        else {
          crossing = this.crossingCost(this.stepBoxes(step, ax, ay, bx, by), ax, ay, bx, by, len, req.transparent, req.common);
          this.crossing[step] = crossing;
          this.crossingStamp[step] = search;
        }
        let cost = len + (nd === d ? 0 : o.bendCost) + crossing + this.trafficCost(step, xi, yi, nxi, nyi, ax, ay, bx, by);
        const atEnd = nxi === xi1 && nyi === yi1;
        const intoEnd = sx === -endNormal.x && sy === -endNormal.y;
        if (!atEnd && (sx === 0 ? hThrough : vThrough)[nxi * ny + nyi]) cost += o.crossCost;
        // A jog on a gutter centre line is free; elsewhere it pays a little, so jogs land mid-gutter.
        if (sx === 0 && !this.onChannelX[xi]) cost += o.channelCost;
        if (sy === 0 && !this.onChannelY[yi]) cost += o.channelCost;
        if (atEnd && !intoEnd) cost += o.hardCost;
        // Leave and enter a port straight for at least a stub, so the arrowhead has room before a turn.
        if (d === startDir && nd !== startDir && onStub(ax, ay, start, n, o.stub)) cost += o.hardCost;
        if (!atEnd && !intoEnd && onStub(bx, by, end, endNormal, o.stub)) cost += o.hardCost;
        const nk = key(nxi, nyi, nd);
        const ng = g + cost;
        if (seen[nk] !== search || ng < best[nk]!) {
          best[nk] = ng;
          parent[nk] = cur;
          seen[nk] = search;
          // Distance still to go, plus the bend a route not yet heading the way it must arrive cannot avoid, weighted a little past
          // a lower bound: the search finds a route within that factor of the cheapest while exploring far fewer cells.
          open.push(nk, ng + o.heuristicWeight * ((Math.abs(bx - endX) + Math.abs(by - endY)) + (sx === -endNormal.x && sy === -endNormal.y ? 0 : o.bendCost)));
        }
      }
    }
    return found;
  }

  /** Routes an edge again knowing every other route, including the ones routed after it. */
  reroute(req: RouteRequest): Point[] {
    const old = this.routes.get(req.id);
    this.routes.delete(req.id);
    if (old) this.occupy(old, -1);
    return this.route(req);
  }

  /** Records a route as the edge's own, replacing any it had. */
  keep(id: string, pts: Point[]): void {
    const old = this.routes.get(id);
    if (old) this.occupy(old, -1);
    this.routes.set(id, pts);
    this.occupy(pts, 1);
  }

  /** One key per grid step whichever way it is walked. */
  private stepKey(xi: number, yi: number, nx: number, ny: number): number {
    return ((Math.min(xi, nx) * this.ys.length + Math.min(yi, ny)) << 1) | (xi === nx ? 1 : 0);
  }

  private stepBoxes(k: number, ax: number, ay: number, bx: number, by: number): StepBoxes {
    const hit = this.steps[k];
    if (hit) return hit;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    // The widest box test crossingCost makes: a box outside it costs nothing but its border.
    const reach = Math.max(-1, this.opts.margin - 1);
    let border = 0;
    const boxes: RouteObstacle[] = [];
    for (const o of this.obstacles) {
      if (o.ghost) continue;
      if (o.words) {
        // Words add no grid lines, so a step can be long: it pays if any of it runs through them, not only its middle.
        if (crossesRect(ax, ay, bx, by, o)) boxes.push(o);
        continue;
      }
      border += this.alongBorder(ax, ay, bx, by, o, this.opts.borderGap) * this.opts.borderFactor;
      // A long run beside a container's frame reads as the frame: price the band beside it, gently, so routes take the open channel.
      if (!o.hard) border += this.alongBorder(ax, ay, bx, by, o, this.opts.frameGap) * this.opts.frameFactor;
      if (inside(o, mx, my, reach)) boxes.push(o);
    }
    const out = { border, boxes };
    this.steps[k] = out;
    return out;
  }

  private crossingCost(step: StepBoxes, ax: number, ay: number, bx: number, by: number, len: number, transparent: ReadonlySet<string>, common?: ReadonlySet<string>): number {
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    let cost = step.border;
    for (const o of step.boxes) {
      if (o.words) {
        cost += this.opts.hardCost;
        continue;
      }
      if (transparent.has(o.id)) {
        // An endpoint leaf: the route leaves and enters on its border, never through it.
        if (o.hard) {
          if (inside(o, mx, my, -1)) cost += this.opts.hardCost;
          continue;
        }
        if (!inside(o, mx, my, -1)) continue;
        // Inside a container of one endpoint only, pay per pixel so the route enters late; keep off the padding ring.
        if (!common?.has(o.id)) cost += len * this.opts.insideFactor;
        if (!inside(o, mx, my, -(this.opts.margin + 2))) cost += len * this.opts.ringFactor;
        continue;
      }
      if (inside(o, mx, my, o.hard ? this.opts.margin - 1 : -1)) cost += o.hard ? this.opts.hardCost : this.opts.softCost;
    }
    // A container that holds both ends holds the whole line: every pixel outside it is a detour out and back.
    for (const id of common ?? []) {
      const o = this.byId.get(id);
      if (o && !o.ghost && !inside(o, mx, my, -1)) cost += len * this.opts.outsideFactor;
    }
    return cost;
  }

  /** Pixels of the segment that run within gap of one of the box's sides, parallel to it. */
  private alongBorder(ax: number, ay: number, bx: number, by: number, o: Rect, gap: number): number {
    const vertical = ax === bx;
    const at = vertical ? ax : ay;
    const near0 = vertical ? o.x : o.y, near1 = vertical ? o.x + o.w : o.y + o.h;
    if (!(Math.abs(at - near0) < gap || Math.abs(at - near1) < gap)) return 0;
    const lo = vertical ? Math.min(ay, by) : Math.min(ax, bx), hi = vertical ? Math.max(ay, by) : Math.max(ax, bx);
    const s0 = vertical ? o.y : o.x, s1 = vertical ? o.y + o.h : o.x + o.w;
    return Math.max(0, Math.min(hi, s1) - Math.max(lo, s0));
  }

  private trafficCost(k: number, xi: number, yi: number, nx: number, ny: number, ax: number, ay: number, bx: number, by: number): number {
    if (this.trafficKnown[k]) return this.traffic[k]!;
    const cost = this.sharedCost(xi, yi, nx, ny) + this.crowdCost(ax, ay, bx, by);
    this.traffic[k] = cost;
    this.trafficKnown[k] = 1;
    return cost;
  }

  private sharedCost(xi: number, yi: number, nx: number, ny: number): number {
    const k = Math.min(xi, nx) * this.ys.length + Math.min(yi, ny);
    const counts = yi === ny ? this.occupancy.h : this.occupancy.v;
    return counts[k]! * this.opts.sharedCost;
  }

  /** A step running beside an earlier segment, closer than a lane, pays per pixel alongside: lines that close read as one smeared line. */
  private crowdCost(ax: number, ay: number, bx: number, by: number): number {
    const vertical = ax === bx;
    const at = vertical ? ax : ay;
    const lo = vertical ? Math.min(ay, by) : Math.min(ax, bx), hi = vertical ? Math.max(ay, by) : Math.max(ax, bx);
    const runs = vertical ? this.occupancy.vRuns : this.occupancy.hRuns;
    const lane = this.opts.lane;
    let beside = 0;
    for (let i = runs.first(at - lane); i < runs.ats.length && runs.ats[i]! < at + lane; i++) {
      const c = runs.ats[i]!;
      if (c === at) continue;
      const list = runs.at(c);
      for (let j = 0; j < list.length; j += 2) beside = Math.max(beside, Math.min(hi, list[j + 1]!) - Math.max(lo, list[j]!));
    }
    return beside * this.opts.crowdFactor;
  }

  /**
   * Forgets the traffic of every step a new segment changes: the steps along
   * it (sharing) and the parallel steps within a lane that overlap it
   * (crowding). Every other step's traffic stays as it was.
   */
  private touched(a: Point, b: Point): void {
    const horizontal = a.y === b.y;
    const along = horizontal ? this.xs : this.ys, across = horizontal ? this.ys : this.xs;
    const at = horizontal ? a.y : a.x;
    const r0 = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y), r1 = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    const lane = this.opts.lane;
    const ny = this.ys.length;
    for (let j = lowerBound(across, at - lane); j < across.length && across[j]! < at + lane; j++) {
      if (!(across[j]! > at - lane)) continue;
      for (let i = Math.max(0, lowerBound(along, r0) - 1); i + 1 < along.length && along[i]! <= r1; i++) {
        if (along[i + 1]! < r0) continue;
        const k = horizontal ? ((i * ny + j) << 1) | 0 : ((j * ny + i) << 1) | 1;
        this.trafficKnown[k] = 0;
      }
    }
  }

  /** Pre-occupies drawn lines (dividers) so routes step off them instead of tracing them. */
  reserve(lines: readonly { from: Point; to: Point }[]): void {
    for (const l of lines) {
      if (l.from.x !== l.to.x && l.from.y !== l.to.y) continue;
      const a = snapToGrid(this.xs, this.ys, l.from), b = snapToGrid(this.xs, this.ys, l.to);
      this.reserved.push([a, b]);
      this.occupy([a, b], 1);
      this.occupy([a, b], 1);
    }
  }

  /** Adds a route's segments to what later routes see (by 1), or takes them away (by -1). */
  private occupy(pts: Point[], by: 1 | -1): void {
    const ny = this.ys.length;
    const occ = this.occupancy;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      this.touched(a, b);
      if (a.y === b.y) {
        if (by > 0) occ.hRuns.add(a.y, a.x, b.x);
        else occ.hRuns.remove(a.y, a.x, b.x);
        const yi = indexOf(this.ys, a.y);
        const x0 = indexOf(this.xs, Math.min(a.x, b.x)), x1 = indexOf(this.xs, Math.max(a.x, b.x));
        if (yi >= 0) for (let x = Math.max(0, x0); x < x1; x++) occ.h[x * ny + yi]! += by;
        for (let x = x0 + 1; x < x1; x++) occ.hThrough[x * ny + yi]! += by;
      } else {
        if (by > 0) occ.vRuns.add(a.x, a.y, b.y);
        else occ.vRuns.remove(a.x, a.y, b.y);
        const xi = indexOf(this.xs, a.x);
        const y0 = indexOf(this.ys, Math.min(a.y, b.y)), y1 = indexOf(this.ys, Math.max(a.y, b.y));
        if (xi >= 0) for (let y = Math.max(0, y0); y < y1; y++) occ.v[xi * ny + y]! += by;
        for (let y = y0 + 1; y < y1; y++) occ.vThrough[xi * ny + y]! += by;
      }
    }
  }
}

interface StepBoxes {
  readonly border: number;
  readonly boxes: readonly RouteObstacle[];
}

/** Whether an axis-aligned step from (ax, ay) to (bx, by) runs through the inside of a rect. */
function crossesRect(ax: number, ay: number, bx: number, by: number, r: Rect): boolean {
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
  return x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h;
}

/** The four headings, right, left, down, up, as a search state's low two bits. */
const DIRS: readonly Point[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
const DX = DIRS.map((d) => d.x);
const DY = DIRS.map((d) => d.y);

function inside(r: Rect, x: number, y: number, margin: number): boolean {
  return x > r.x - margin && x < r.x + r.w + margin && y > r.y - margin && y < r.y + r.h + margin;
}

/** True when (x, y) lies on the ray out of a port along its normal, closer than length. */
function onStub(x: number, y: number, port: Point, normal: Point, length: number): boolean {
  const along = (x - Math.round(port.x)) * normal.x + (y - Math.round(port.y)) * normal.y;
  const across = (x - Math.round(port.x)) * normal.y + (y - Math.round(port.y)) * normal.x;
  return across === 0 && along >= 0 && along < length;
}

function snapToGrid(xs: readonly number[], ys: readonly number[], p: Point): Point {
  const near = (arr: readonly number[], v: number): number => arr.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), arr[0] ?? v);
  return { x: near(xs, p.x), y: near(ys, p.y) };
}


/** Earlier segments by the coordinate they run along, with the coordinates kept sorted so a neighbourhood is one search. */
class Runs {
  /** Each coordinate's runs as flat pairs: from, to. */
  private readonly byAt = new Map<number, number[]>();
  readonly ats: number[] = [];

  add(at: number, from: number, to: number): void {
    let list = this.byAt.get(at);
    if (!list) {
      list = [];
      this.byAt.set(at, list);
      let i = this.ats.length;
      while (i > 0 && this.ats[i - 1]! > at) i--;
      this.ats.splice(i, 0, at);
    }
    list.push(Math.min(from, to), Math.max(from, to));
  }

  /** Takes away one run added before; its coordinate stays, with nothing on it. */
  remove(at: number, from: number, to: number): void {
    const list = this.byAt.get(at)!;
    const lo = Math.min(from, to), hi = Math.max(from, to);
    for (let j = 0; j < list.length; j += 2) {
      if (list[j] === lo && list[j + 1] === hi) {
        list.splice(j, 2);
        return;
      }
    }
  }

  /** The runs on one coordinate in `ats`, as flat pairs. */
  at(c: number): readonly number[] {
    return this.byAt.get(c)!;
  }

  /** The index of the first coordinate above `above`. */
  first(above: number): number {
    let lo = 0, hi = this.ats.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.ats[mid]! <= above) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

/** The index of the first value at or above v. */
function lowerBound(sorted: readonly number[], v: number): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function indexOf(sorted: number[], v: number): number {
  const r = Math.round(v);
  let lo = 0, hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = sorted[mid]!;
    if (m === r) return mid;
    if (m < r) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Binary min-heap keyed by priority; stores integer node keys. */
class Heap {
  private keys: number[] = [];
  private pri: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(k: number, p: number): void {
    this.keys.push(k);
    this.pri.push(p);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.pri[parent]! <= this.pri[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.keys[0]!;
    const lk = this.keys.pop()!, lp = this.pri.pop()!;
    if (this.keys.length) {
      this.keys[0] = lk;
      this.pri[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.keys.length && this.pri[l]! < this.pri[m]!) m = l;
        if (r < this.keys.length && this.pri[r]! < this.pri[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    const k = this.keys[a]!, p = this.pri[a]!;
    this.keys[a] = this.keys[b]!;
    this.pri[a] = this.pri[b]!;
    this.keys[b] = k;
    this.pri[b] = p;
  }
}

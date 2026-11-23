/**
 * Timeline view: lanes by owner, one row per item, bars by date, diamonds
 * for milestones, arrows for dependencies. Roadmaps, migrations, sprints,
 * incident timelines. Dates scale linearly; `ordinal` makes every distinct
 * start a step, for stories that have an order but no calendar.
 *
 * Every item has its own row, so a label never shares space with another
 * item. An arrow leaves an item from its bottom or top edge, never through
 * the label beside it, and the rows inside a lane are ordered to keep
 * arrows off bars and labels.
 */
import type { Model, ResolvedTimelineView, TimelineItem } from '@vantage/model';
import type { Point } from './geometry.ts';
import { textWidth, wrapText } from './text/measure.ts';
import { DEFAULT_STYLE, type LayoutStyle } from './style.ts';
import type { Extra, Layout, LayoutBox, LayoutEdge, TextBlock } from './types.ts';
import { syntheticNode } from './synthetic.ts';
import { measureQuality } from './metrics.ts';

const DAY = 86400000;
/** Spans up to this many days get a tick every day, then every Monday, then every month. */
const DAILY_TICKS_MAX_DAYS = 14;
const WEEKLY_TICKS_MAX_DAYS = 120;
/** Above this many items the row order stays in start order. */
const ORDER_SEARCH_MAX_ITEMS = 60;

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** An item's horizontal shape, before it has a row. */
interface Shape {
  readonly item: TimelineItem;
  readonly id: string;
  readonly lane: number;
  readonly milestone: boolean;
  /** Box left and width; a milestone's box is its diamond. */
  readonly x: number;
  readonly w: number;
  readonly h: number;
  /** The label: inside the bar, or to the right of it. */
  readonly label: TextBlock;
  readonly outside: boolean;
  readonly labelW: number;
  readonly labelH: number;
  readonly startKey: number;
}

interface Dep {
  readonly from: string;
  readonly to: string;
}

export function layoutTimelineView(model: Model, view: ResolvedTimelineView, style: LayoutStyle = DEFAULT_STYLE): Layout {
  const T = style.timeline;
  const ordinal = view.scale === 'ordinal';
  const lanes: string[] = [...(view.lanes ?? [])];
  for (const it of view.items) {
    const l = it.lane ?? 'Timeline';
    if (!lanes.includes(l)) lanes.push(l);
  }

  // Scale: dates in days, or distinct labels as equal steps.
  const labels = [...new Set(view.items.flatMap((it) => [it.start, ...(it.end ? [it.end] : [])]))];
  const pos = (v: string): number => (ordinal ? labels.indexOf(v) : Date.parse(v) / DAY);
  const minV = Math.min(...labels.map(pos)), maxV = Math.max(...labels.map(pos));
  const span = Math.max(1, maxV - minV);
  const trackW = clamp(ordinal ? span * T.stepWidth : span * T.dayWidth, T.minTrack, T.maxTrack);
  const x0 = style.canvasPad + T.laneTitleWidth + T.trackInset;
  const xAt = (v: number): number => x0 + ((v - minV) / span) * trackW;

  const shapes: Shape[] = view.items.map((it, i) => shapeOf(it, it.id ?? `item-${i}`, lanes.indexOf(it.lane ?? 'Timeline'), xAt(pos(it.start)), it.end ? xAt(pos(it.end)) : undefined, style));
  const deps: Dep[] = (view.dependencies ?? []).filter((d) => shapes.some((s) => s.id === d.from) && shapes.some((s) => s.id === d.to));

  // Rows: each lane lists its items in start order, then swaps rows while that keeps more arrows clear.
  const order: number[][] = lanes.map((_, li) =>
    shapes.map((s, i) => [s, i] as const).filter(([s]) => s.lane === li).sort(([a, ai], [b, bi]) => a.startKey - b.startKey || ai - bi).map(([, i]) => i),
  );
  const startRank = new Map(order.flatMap((o) => o.map((i, r) => [i, r] as const)));
  const cost = (o: number[][]): number => {
    const placed = place(o, shapes, style);
    const routes = deps.map((d) => routeOf(d, placed, shapes, style));
    const crossings = deps.reduce((n, d, i) => n + crossingCount(routes[i]!, d, placed), 0);
    const tangles = routes.reduce((n, r, i) => n + routes.slice(i + 1).filter((q) => tangled(r, q)).length, 0);
    const drift = o.reduce((n, rows) => n + rows.reduce((m, i, r) => m + Math.abs(r - startRank.get(i)!), 0), 0);
    return crossings * 1000 + tangles * 200 + drift;
  };
  if (shapes.length <= ORDER_SEARCH_MAX_ITEMS && deps.length > 0) improveOrder(order, cost);
  const placed = place(order, shapes, style);

  const right = Math.max(x0 + trackW + T.trackInset, ...[...placed.boxes.values()].map((b) => b.x + b.w), ...[...placed.labels.values()].map((r) => r.x + r.w));
  const width = right + T.trackInset + style.canvasPad;
  const height = placed.bottom + style.canvasPad;

  const extras: Extra[] = [];
  lanes.forEach((lane, li) => {
    const { y, h } = placed.lanes[li]!;
    const title: TextBlock = { lines: wrapText(lane, style.nameSize, 'semibold', T.laneTitleWidth - 20, 2).lines, size: style.nameSize, weight: 'semibold', x: 12, y: h / 2 - style.nameSize * 0.7, lineHeight: style.nameSize * 1.25, anchor: 'start' };
    extras.push({ kind: 'lane', id: `lane-${li}`, rect: { x: style.canvasPad, y, w: width - style.canvasPad * 2, h }, title });
  });
  const ticks = ordinal ? labels.map((l, i) => ({ id: l, at: i, text: l })) : dateTicks(minV, maxV);
  for (const t of ticks) {
    const x = xAt(t.at);
    if (x < x0 - T.trackInset || x > x0 + trackW + T.trackInset) continue;
    extras.push({ kind: 'line', id: `tick-${t.id}`, from: { x, y: style.canvasPad + T.axisHeight - 6 }, to: { x, y: placed.bottom }, style: 'divider' });
    extras.push({ kind: 'text', id: `tick-label-${t.id}`, role: 'axis', text: { lines: [t.text], size: style.subtitleSize, weight: 'medium', x, y: style.canvasPad + 10, lineHeight: style.subtitleSize * 1.25, anchor: 'middle' } });
  }

  const boxes: LayoutBox[] = shapes.map((s) => {
    const linked = s.item.node !== undefined ? model.nodes.get(s.item.node) : undefined;
    const node = linked ?? syntheticNode(s.id, s.item.text, { color: s.item.color ?? (s.milestone ? 'amber' : 'blue'), ...(s.item.description !== undefined ? { description: s.item.description } : {}) });
    const r = placed.boxes.get(s.id)!;
    return {
      id: s.id, kind: 'leaf', depth: 0, node: { ...node, name: s.item.text, color: s.item.color ?? node.color }, shape: s.milestone ? 'diamond' : 'rounded', frame: 'box', iconOnly: false,
      x: r.x, y: r.y, w: r.w, h: r.h, name: s.label,
    };
  });
  const edges: LayoutEdge[] = deps.map((d, i) => {
    const id = `dep-${i}`;
    const points = routeOf(d, placed, shapes, style);
    return { id, relation: { id, from: d.from, to: d.to, kind: 'sync' as const, via: [], tags: [], both: false, weight: 1, style: 'orthogonal' as const }, from: d.from, to: d.to, kind: 'sync' as const, points, both: false, bundled: 1, members: [`${d.from}>${d.to}`], reversed: false, style: 'orthogonal' as const };
  });
  const m = measureQuality(boxes, edges, width, height);
  return { viewId: view.id, title: view.title, width: Math.ceil(width), height: Math.ceil(height), boxes, edges, extras, metrics: { ...m, notes: m.notes.filter((n) => !n.startsWith('no relations') && !n.includes('no arrows')) } };
}

function shapeOf(item: TimelineItem, id: string, lane: number, a: number, b: number | undefined, style: LayoutStyle): Shape {
  const T = style.timeline;
  if (b === undefined) {
    const size = style.nameSize - 1;
    const label = wrapText(item.text, size, 'medium', T.labelMaxWidth, 2);
    const labelW = Math.max(...label.lines.map((l) => textWidth(l, size, 'medium')));
    const m = T.milestone;
    return {
      item, id, lane, milestone: true, x: a - m / 2, w: m, h: m, outside: true, labelW, labelH: label.height, startKey: a,
      label: { lines: label.lines, size, weight: 'medium', x: m + T.labelGap, y: (m - label.height) / 2, lineHeight: label.lineHeight, anchor: 'start' },
    };
  }
  const w = Math.max(b - a, T.minBarWidth), h = T.barHeight;
  const fits = textWidth(item.text, style.nameSize, 'medium') + 20 <= w;
  const label = wrapText(item.text, style.nameSize, 'medium', fits ? w - 16 : T.labelMaxWidth, fits ? 1 : 2);
  const labelW = Math.max(...label.lines.map((l) => textWidth(l, style.nameSize, 'medium')));
  return {
    item, id, lane, milestone: false, x: a, w, h, outside: !fits, labelW, labelH: label.height, startKey: a,
    label: fits
      ? { lines: label.lines, size: style.nameSize, weight: 'medium', x: w / 2, y: (h - label.height) / 2, lineHeight: label.lineHeight, anchor: 'middle' }
      : { lines: label.lines, size: style.nameSize, weight: 'medium', x: w + T.labelGap, y: (h - label.height) / 2, lineHeight: label.lineHeight, anchor: 'start' },
  };
}

interface Placement {
  readonly boxes: Map<string, Rect>;
  /** Outside labels only; a label inside its bar is the bar. */
  readonly labels: Map<string, Rect>;
  /** Each item's row top, for the arrow jog in the gap above or below it. */
  readonly rowTop: Map<string, number>;
  readonly lanes: { y: number; h: number }[];
  readonly bottom: number;
}

function place(order: number[][], shapes: Shape[], style: LayoutStyle): Placement {
  const T = style.timeline;
  const boxes = new Map<string, Rect>(), labels = new Map<string, Rect>(), rowTop = new Map<string, number>();
  const lanes: { y: number; h: number }[] = [];
  let y = style.canvasPad + T.axisHeight;
  for (const rows of order) {
    const h = Math.max(1, rows.length) * (T.barHeight + T.rowGap) + T.rowGap;
    lanes.push({ y, h });
    rows.forEach((i, r) => {
      const s = shapes[i]!;
      const top = y + T.rowGap + r * (T.barHeight + T.rowGap);
      const box = { x: s.x, y: top + (T.barHeight - s.h) / 2, w: s.w, h: s.h };
      boxes.set(s.id, box);
      rowTop.set(s.id, top);
      if (s.outside) labels.set(s.id, { x: box.x + box.w + T.labelGap, y: box.y + box.h / 2 - s.labelH / 2, w: s.labelW, h: s.labelH });
    });
    y += h;
  }
  return { boxes, labels, rowTop, lanes, bottom: y };
}

/**
 * Finish to start. The arrow leaves the earlier item through its bottom (or
 * top) edge near its end, so it never runs through that item's label. It
 * drops straight onto a bar that is already under way, turns into the left
 * end of one that starts later, or jogs in the row gap when the next item
 * starts right where this one ends.
 */
function routeOf(d: Dep, p: Placement, shapes: Shape[], style: LayoutStyle): Point[] {
  const T = style.timeline;
  const a = p.boxes.get(d.from)!, b = p.boxes.get(d.to)!;
  const aMs = shapes.find((s) => s.id === d.from)!.milestone, bMs = shapes.find((s) => s.id === d.to)!.milestone;
  const down = b.y > a.y;
  const exitX = aMs ? a.x + a.w / 2 : a.x + a.w - Math.min(12, a.w / 2);
  const aEdge = down ? a.y + a.h : a.y;
  const bEdge = down ? b.y : b.y + b.h;
  const exit = { x: exitX, y: aEdge };
  if (!bMs && exitX >= b.x + 6 && exitX <= b.x + b.w - 6) return [exit, { x: exitX, y: bEdge }];
  if (b.x - exitX >= T.elbowRun) {
    const cy = b.y + b.h / 2;
    return [exit, { x: exitX, y: cy }, { x: b.x, y: cy }];
  }
  const inset = bMs ? b.w / 2 : Math.min(10, b.w / 2);
  const tx = exitX < b.x + inset ? b.x + inset : b.x + b.w - inset;
  if (Math.abs(tx - exitX) < 1) return [exit, { x: exitX, y: bEdge }];
  const top = p.rowTop.get(d.to)!;
  const jogY = down ? top - T.rowGap / 2 : top + T.barHeight + T.rowGap / 2;
  return [exit, { x: exitX, y: jogY }, { x: tx, y: jogY }, { x: tx, y: bEdge }];
}

/** How many bars, diamonds, and outside labels an arrow runs through, its own ends aside. */
function crossingCount(points: Point[], d: Dep, p: Placement): number {
  let n = 0;
  for (const [id, r] of p.boxes) if (id !== d.from && id !== d.to && hits(points, r)) n++;
  for (const [, r] of p.labels) if (hits(points, r)) n++;
  return n;
}

/** Two arrows cross, or run along each other closer than a hand's width, anywhere but a shared end. */
function tangled(p: Point[], q: Point[]): boolean {
  const near = 6;
  for (let i = 1; i < p.length; i++) {
    for (let j = 1; j < q.length; j++) {
      const a = p[i - 1]!, b = p[i]!, c = q[j - 1]!, d = q[j]!;
      const ax1 = Math.min(a.x, b.x), ax2 = Math.max(a.x, b.x), ay1 = Math.min(a.y, b.y), ay2 = Math.max(a.y, b.y);
      const cx1 = Math.min(c.x, d.x), cx2 = Math.max(c.x, d.x), cy1 = Math.min(c.y, d.y), cy2 = Math.max(c.y, d.y);
      const aV = a.x === b.x, cV = c.x === d.x;
      if (aV === cV) {
        // Parallel: tangled when close and overlapping for more than a corner, unless they merge onto one line.
        const gap = aV ? Math.abs(a.x - c.x) : Math.abs(a.y - c.y);
        const overlap = aV ? Math.min(ay2, cy2) - Math.max(ay1, cy1) : Math.min(ax2, cx2) - Math.max(ax1, cx1);
        if (gap > 0.5 && gap < near && overlap > 0) return true;
      } else {
        const [v1, v2, h1, h2] = aV ? [a, b, c, d] : [c, d, a, b];
        const x = v1.x, y = h1.y;
        const inside = x > Math.min(h1.x, h2.x) + 1 && x < Math.max(h1.x, h2.x) - 1 && y > Math.min(v1.y, v2.y) + 1 && y < Math.max(v1.y, v2.y) - 1;
        if (inside) return true;
      }
    }
  }
  return false;
}

function hits(points: Point[], r: Rect): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
    if (x2 > r.x + 1 && x1 < r.x + r.w - 1 && y2 > r.y + 1 && y1 < r.y + r.h - 1) return true;
  }
  return false;
}

/** Swap rows inside each lane while a swap lowers the cost; deterministic and small. */
function improveOrder(order: number[][], cost: (o: number[][]) => number): void {
  let best = cost(order);
  for (let pass = 0; pass < 8; pass++) {
    let improved = false;
    for (const rows of order) {
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          [rows[i], rows[j]] = [rows[j]!, rows[i]!];
          const c = cost(order);
          if (c < best) {
            best = c;
            improved = true;
          } else [rows[i], rows[j]] = [rows[j]!, rows[i]!];
        }
      }
    }
    if (!improved) return;
  }
}

interface Tick {
  readonly id: string;
  readonly at: number;
  readonly text: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Days for a short span, Mondays for a span of weeks, months for longer ones. The first day tick and each new year carry the year. */
function dateTicks(minDays: number, maxDays: number): Tick[] {
  const out: Tick[] = [];
  const span = maxDays - minDays;
  const step = span <= DAILY_TICKS_MAX_DAYS ? 1 : span <= WEEKLY_TICKS_MAX_DAYS ? 7 : 0;
  const d = new Date(minDays * DAY);
  if (step === 7) d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (step === 0) d.setUTCDate(1);
  let year = -1;
  while (d.getTime() / DAY <= maxDays + (step || 31)) {
    const y = d.getUTCFullYear(), mon = MONTHS[d.getUTCMonth()]!;
    const text = step ? `${mon} ${d.getUTCDate()}${y !== year ? `, ${y}` : ''}` : `${mon} ${y}`;
    out.push({ id: d.toISOString().slice(0, 10), at: d.getTime() / DAY, text });
    year = y;
    if (step) d.setUTCDate(d.getUTCDate() + step);
    else d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

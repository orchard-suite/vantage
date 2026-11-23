/** Lays out one relation view: visible set, compose, ports, route, labels, metrics. */
import { ancestorsOf, type Model, type ModelNode, type ModelRelation, type ResolvedRelationView } from '@vantage/model/resolved';
import { computeVisible, type VisibleSet } from './visible.ts';
import { liftSiblingHops, type LiftedHop } from './lift.ts';
import { compose } from './compose.ts';
import { assignPorts, type PortRequest } from './ports.ts';
import { DEFAULT_ROUTER, OrthogonalRouter, directRoute, simplify, type RouteObstacle, type RouteRequest } from './route.ts';
import { placeLabel, type Segment } from './labels.ts';
import { straighten } from './straighten.ts';
import { separate } from './separate.ts';
import { DETOUR, headerText, LABEL_CLEAR, LABEL_REACH, rectToLine } from './legibility.ts';
import { loopCandidates } from './loop.ts';
import { measureQuality } from './metrics.ts';
import { chipWidth, DEFAULT_STYLE, type LayoutStyle, RULES } from './style.ts';
import type { Layout, LayoutBox, LayoutEdge } from './types.ts';
import { shiftLayout } from './shift.ts';
import { rectsOverlap, segmentCrossesRect, segmentsCross, type Point, type Rect } from './geometry.ts';
import { applyPaths, collectNotes, footer, highlightExtras, placeNotes } from './story.ts';

const RL = RULES.relation, EL = RULES.edgeLabel, CH = RULES.chip;

interface Bundle {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly hops: LiftedHop[];
}

/** Hops between the same visible pair become one drawn edge; opposite directions stay separate. */
function bundle(hops: readonly LiftedHop[]): Bundle[] {
  const map = new Map<string, Bundle>();
  for (const h of hops) {
    const k = `${h.from}>${h.to}`;
    const b = map.get(k);
    if (b) b.hops.push(h);
    else map.set(k, { id: h.id, from: h.from, to: h.to, hops: [h] });
  }
  return [...map.values()];
}

function bundleLabel(hops: readonly LiftedHop[]): string | undefined {
  // A relation with via hops carries its label once, on the middle hop.
  const labelled = hops.filter((h) => h.hopCount === 1 || h.hopIndex === Math.floor((h.hopCount - 1) / 2));
  const labels = [...new Set(labelled.map((h) => (h.relation.label ? (h.note ? `${h.relation.label} (${h.note})` : h.relation.label) : undefined)).filter((l): l is string => l !== undefined && l !== ''))];
  if (!labels.length) return undefined;
  if (labels.length <= 2) return labels.join(' · ');
  return `${labels[0]} +${labels.length - 1} more`;
}

/**
 * A second tree over the same resources: the view's `reparent` map moves
 * nodes under other containers (or to the canvas) for this view only. The
 * model is copied with parents, children, and depths recomputed.
 */
export function reparented(model: Model, map: Readonly<Record<string, string>>): Model {
  const nodes = new Map(model.nodes);
  const roots = [...model.roots];
  for (const [id, target] of Object.entries(map)) {
    const node = nodes.get(id);
    if (!node) continue;
    const newParent = target === 'root' ? undefined : target;
    if (newParent !== undefined && !nodes.has(newParent)) continue;
    // Refuse to put a node under its own descendant.
    if (newParent !== undefined && ancestorsOf({ ...model, nodes }, newParent).includes(id)) continue;
    const old = node.parentId;
    if (old !== undefined) {
      const p = nodes.get(old)!;
      nodes.set(old, { ...p, childIds: p.childIds.filter((c) => c !== id) });
    } else {
      const i = roots.indexOf(id);
      if (i >= 0) roots.splice(i, 1);
    }
    if (newParent !== undefined) {
      const p = nodes.get(newParent)!;
      nodes.set(newParent, { ...p, childIds: [...p.childIds, id] });
      nodes.set(id, { ...nodes.get(id)!, parentId: newParent });
    } else {
      const { parentId: _dropped, ...rest } = nodes.get(id)!;
      nodes.set(id, rest as ModelNode);
      roots.push(id);
    }
  }
  // Depths follow the new tree.
  const fix = (id: string, depth: number): void => {
    const n = nodes.get(id)!;
    nodes.set(id, { ...n, depth });
    for (const c of n.childIds) fix(c, depth + 1);
  };
  for (const r of roots) fix(r, 0);
  return { ...model, nodes, roots };
}

const STROKE_SIDE = RULES.sameLine;
const STROKE_GAP = RULES.strokeGap;

/** Two parallel segments on (nearly) one line that overlap or meet end to end across a short gap: drawn, they read as a single stroke. */
export function collinearTouch(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const ah = a1.y === a2.y && a1.x !== a2.x, bh = b1.y === b2.y && b1.x !== b2.x;
  const av = a1.x === a2.x && a1.y !== a2.y, bv = b1.x === b2.x && b1.y !== b2.y;
  const h = ah && bh && Math.abs(a1.y - b1.y) < STROKE_SIDE;
  const v = av && bv && Math.abs(a1.x - b1.x) < STROKE_SIDE;
  if (!h && !v) return false;
  const [a0, a9] = h ? [Math.min(a1.x, a2.x), Math.max(a1.x, a2.x)] : [Math.min(a1.y, a2.y), Math.max(a1.y, a2.y)];
  const [b0, b9] = h ? [Math.min(b1.x, b2.x), Math.max(b1.x, b2.x)] : [Math.min(b1.y, b2.y), Math.max(b1.y, b2.y)];
  return Math.min(a9, b9) - Math.max(a0, b0) > -STROKE_GAP;
}

/** Centre to centre, clipped to both borders: the line a hand draws between two boxes. */
export function straightLine(a: Rect, b: Rect): Point[] {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const clip = (r: Rect, from: Point, to: Point): Point => {
    const dx = to.x - from.x, dy = to.y - from.y;
    const sx = dx !== 0 ? (r.w / 2) / Math.abs(dx) : Infinity, sy = dy !== 0 ? (r.h / 2) / Math.abs(dy) : Infinity;
    const t = Math.min(sx, sy);
    return { x: from.x + dx * t, y: from.y + dy * t };
  };
  return [clip(a, ca, cb), clip(b, cb, ca)];
}

function selfLoop(r: Rect, margin: number): Point[] {
  const x0 = r.x + r.w * 0.7, x1 = r.x + r.w + margin;
  return simplify([
    { x: x0, y: r.y },
    { x: x0, y: r.y - margin },
    { x: x1, y: r.y - margin },
    { x: x1, y: r.y + r.h * 0.3 },
    { x: r.x + r.w, y: r.y + r.h * 0.3 },
  ]);
}

export function layoutRelationView(baseModel: Model, authored: ResolvedRelationView, style: LayoutStyle = DEFAULT_STYLE, anchors?: ReadonlyMap<string, Point>): Layout {
  const model = Object.keys(authored.reparent).length ? reparented(baseModel, authored.reparent) : baseModel;
  // A loop is drawn round; of the ways round, keep the one that reads best.
  const rings = loopCandidates(model, authored);
  if (rings.length) {
    const tries = rings.map((v) => layoutRelationView(baseModel, v, style, anchors));
    return tries.reduce((best, l) => (l.metrics.score > best.metrics.score ? l : best));
  }
  const view = authored;
  const visible = computeVisible(model, view);
  const composed = compose(model, view, visible, style, anchors);
  const boxes = composed.boxes;
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const bundles = bundle(liftSiblingHops(visible.hops, visible));

  const requests: PortRequest[] = [];
  const loops: Bundle[] = [];
  for (const b of bundles) {
    const from = byId.get(b.from), to = byId.get(b.to);
    if (!from || !to) continue;
    if (b.from === b.to) {
      loops.push(b);
      continue;
    }
    requests.push({ edgeId: b.id, from, to, fromId: b.from, toId: b.to, ...chips(from, to), ...focusOf(b, byId) });
  }
  const ports = assignPorts(requests, view.direction);
  // Notes are placed before routing so arrows go around them like any box, and off each arrow's direct path so they never force a detour.
  const direct = [...ports.values()].map((p) => directRoute(p.fromPoint, p.toPoint, p.fromSide, style.edgeMargin));
  const notes = placeNotes(collectNotes(model, view, boxes), boxes, style, direct);
  const obstacles: RouteObstacle[] = [
    ...boxes.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, hard: b.kind !== 'container', ghost: b.kind === 'container' && b.frame === 'none' })),
    // A container's title and facts are words: a line may cross the empty part of its header, never the text.
    ...boxes.flatMap((b) => (b.kind === 'container' ? headerText(b) : [])).map((r) => ({ ...r, hard: true, words: true })),
    ...notes.obstacles.map((r, i) => ({ id: `note-${i}`, ...r, hard: true })),
    // A leaf's count chip hangs past its corner: no line, its own box's included, runs through it.
    ...boxes.flatMap((b) => leafChip(b)).map((r) => ({ ...r, hard: true, priceOnly: true, words: true })),
  ];
  const portPoints = [...ports.values()].flatMap((p) => [p.fromPoint, p.toPoint]);
  const router = new OrthogonalRouter(obstacles, portPoints, { ...DEFAULT_ROUTER, margin: style.edgeMargin, lane: style.laneGap });
  router.reserve(composed.extras.flatMap((e) => (e.kind === 'line' ? [{ from: e.from, to: e.to }] : [])));

  // Route long edges first so short ones bend around them, which reads better than the reverse.
  const ordered = [...requests].sort((a, b) => {
    const da = Math.abs(a.from.x - a.to.x) + Math.abs(a.from.y - a.to.y);
    const db = Math.abs(b.from.x - b.to.x) + Math.abs(b.from.y - b.to.y);
    return db - da || a.edgeId.localeCompare(b.edgeId);
  });
  const edges: LayoutEdge[] = [];
  const labelRects: Rect[] = [];
  const routed = new Map<string, Point[]>();
  // Labels must stay off leaves, off container headers (title, subtitle, and facts, however many lines they wrap to), and off drawn frame lines.
  const leafRects: Rect[] = [...boxes.flatMap((b) => (b.kind === 'container' ? [containerHeaderBand(b, style)] : [b, ...leafChip(b)])), ...notes.obstacles];
  const frameRects: Rect[] = boxes.flatMap((b) => (b.kind === 'container' ? frameLines(b) : []));
  const transparentFor = (a: string, b: string): Set<string> => new Set([a, b, ...ancestorsOf(model, a), ...ancestorsOf(model, b)]);
  const commonFor = (a: string, b: string): Set<string> => {
    const bs = new Set(ancestorsOf(model, b));
    return new Set(ancestorsOf(model, a).filter((x) => bs.has(x)));
  };
  const off = composed.pinOffset ?? { x: 0, y: 0 };
  const pinnedEdge = (b: Bundle): Point[] | undefined => {
    const pts = view.pins?.edges?.[`${b.from}>${b.to}`];
    if (!pts) return undefined;
    const same = (id: string): boolean => {
      const pin = view.pins?.nodes[id], box = byId.get(id);
      return !!pin && !!box && Math.abs(pin.x + off.x - box.x) < 0.5 && Math.abs(pin.y + off.y - box.y) < 0.5 && Math.abs(pin.w - box.w) < 0.5 && Math.abs(pin.h - box.h) < 0.5;
    };
    return same(b.from) && same(b.to) ? pts.map((q) => ({ x: q.x + off.x, y: q.y + off.y })) : undefined;
  };
  const routedBy = new Map<string, RouteRequest>();
  for (const r of ordered) {
    const b = bundles.find((x) => x.id === r.edgeId)!;
    const kept = pinnedEdge(b);
    if (kept) {
      routed.set(b.id, kept);
      router.reserve(kept.slice(1).map((q, i) => ({ from: kept[i]!, to: q })));
      continue;
    }
    if (b.hops[0]!.relation.style === 'straight') {
      routed.set(b.id, straightLine(r.from, r.to));
      continue;
    }
    const p = ports.get(r.edgeId)!;
    const req: RouteRequest = { id: r.edgeId, from: p.fromPoint, to: p.toPoint, fromSide: p.fromSide, toSide: p.toSide, transparent: transparentFor(b.from, b.to), common: commonFor(b.from, b.to) };
    routedBy.set(b.id, req);
    routed.set(b.id, router.route(req));
  }
  // An edge routed early could not see the ones after it. Route each edge that crosses another, or lies on one line with
  // another (overlapping, or end to end so two relations read as one stroke), again knowing them all; keep it only if it is better.
  const conflictsOf = (id: string, pts: readonly Point[]): number => {
    let n = 0;
    for (const [k, other] of routed) {
      if (k === id) continue;
      for (let i = 0; i + 1 < pts.length; i++) {
        for (let j = 0; j + 1 < other.length; j++) {
          if (segmentsCross(pts[i]!, pts[i + 1]!, other[j]!, other[j + 1]!)) n++;
          if (collinearTouch(pts[i]!, pts[i + 1]!, other[j]!, other[j + 1]!)) n += 3;
        }
      }
    }
    return n;
  };
  for (const [id, req] of routedBy) {
    const old = routed.get(id)!;
    const before = conflictsOf(id, old);
    if (!before) continue;
    const next = router.reroute(req);
    if (conflictsOf(id, next) < before) routed.set(id, next);
    else router.keep(id, old);
  }
  // A route far longer than the distance it covers went the long way round its target: try the target's other sides, at their middles, and keep a clearly shorter or simpler route that conflicts no more.
  const titles = boxes.flatMap((x) => (x.kind === 'container' ? headerText(x) : []));
  // How many container frames a route passes through: a route that leaves a container only to come back in reads as lost.
  const frames = boxes.filter((x) => x.kind === 'container' && x.frame !== 'none');
  const frameCrossings = (pts: readonly Point[]): number => {
    let n = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      for (const f of frames) {
        const inA = pts[i]!.x > f.x && pts[i]!.x < f.x + f.w && pts[i]!.y > f.y && pts[i]!.y < f.y + f.h;
        const inB = pts[i + 1]!.x > f.x && pts[i + 1]!.x < f.x + f.w && pts[i + 1]!.y > f.y && pts[i + 1]!.y < f.y + f.h;
        if (inA !== inB) n++;
      }
    }
    return n;
  };
  const lengthOf = (pts: readonly Point[]): number => pts.slice(1).reduce((a, q, i) => a + Math.abs(q.x - pts[i]!.x) + Math.abs(q.y - pts[i]!.y), 0);
  for (const [id, req] of routedBy) {
    const old = routed.get(id)!;
    const direct = Math.abs(req.from.x - req.to.x) + Math.abs(req.from.y - req.to.y);
    // Also a route that winds (four bends or more) and runs well past the distance it covers, to reach a box it could meet more simply from another side.
    if (lengthOf(old) <= Math.max(RULES.legibility.detourMin, direct * DETOUR) && (old.length < 6 || lengthOf(old) < direct * 1.4)) continue;
    const b = bundles.find((x) => x.id === id)!;
    const target = byId.get(b.to)!;
    let best = old, bestLen = lengthOf(old), bestConflicts = conflictsOf(id, old);
    // The side facing away from the source can only be longer: leave it out.
    const sx = req.from.x - (target.x + target.w / 2), sy = req.from.y - (target.y + target.h / 2);
    const away = Math.abs(sx) > Math.abs(sy) ? (sx > 0 ? 'left' : 'right') : sy > 0 ? 'top' : 'bottom';
    for (const side of ['top', 'left', 'right', 'bottom'] as const) {
      if (side === req.toSide || side === away) continue;
      // The middle of the side, and the grid point a margin out from it (the grid already holds box centres and the lines a margin round every box): route there, then step in.
      const cx = Math.round(target.x + target.w / 2), cy = Math.round(target.y + target.h / 2), m = style.edgeMargin;
      const to = side === 'top' ? { x: cx, y: target.y } : side === 'bottom' ? { x: cx, y: target.y + target.h } : side === 'left' ? { x: target.x, y: cy } : { x: target.x + target.w, y: cy };
      const near = side === 'top' ? { x: cx, y: Math.round(target.y - m) } : side === 'bottom' ? { x: cx, y: Math.round(target.y + target.h + m) } : side === 'left' ? { x: Math.round(target.x - m), y: cy } : { x: Math.round(target.x + target.w + m), y: cy };
      const next = simplify([...router.reroute({ ...req, to: near, toSide: side }), to]);
      const len = lengthOf(next), c = conflictsOf(id, next);
      // A route the router could not find comes back as a straight line through whatever is in the way: never take it.
      // The new port must keep clear of every other line's end, or arrowheads pile up.
      const crowded = [...routed.entries()].some(([k, pts]) => k !== id && [pts[0]!, pts[pts.length - 1]!].some((q) => Math.abs(q.x - to.x) + Math.abs(q.y - to.y) < RL.crowdedEnd));
      const bad = crowded || frameCrossings(next) > frameCrossings(old) || next.slice(1).some((q, i) => {
        const p0 = next[i]!;
        if (p0.x !== q.x && p0.y !== q.y) return true;
        return titles.some((t) => segmentCrossesRect(p0, q, t)) || boxes.some((x) => x.kind !== 'container' && x.id !== b.from && x.id !== b.to && segmentCrossesRect(p0, q, { x: x.x + 1, y: x.y + 1, w: x.w - 2, h: x.h - 2 }));
      });
      if ((len < bestLen * 0.75 || (next.length < best.length && len <= bestLen * 1.1)) && c <= bestConflicts && !bad) {
        best = next;
        bestLen = len;
        bestConflicts = c;
      }
    }
    routed.set(id, best);
    router.keep(id, best);
  }
  // Short jogs left by spread ports read as kinks: slide a neighbouring run onto the other's line where nothing is in the way.
  const leaves = obstacles.filter((o) => o.hard);
  const straight = straighten([...routedBy.entries()].map(([id, req]) => {
    const b = bundles.find((x) => x.id === id)!;
    return { id, points: routed.get(id)!, from: byId.get(b.from)!, to: byId.get(b.to)!, transparent: req.transparent };
  }), leaves);
  for (const [id, pts] of straight) routed.set(id, pts);
  // Two relations on one line read as one stroke: slide an inner run of the later one a lane aside.
  separate(routed, new Map([...routedBy].map(([id, req]) => [id, req.transparent])), leaves);
  for (const b of loops) routed.set(b.id, selfLoop(byId.get(b.from)!, style.edgeMargin + RL.loopMargin));
  // Labels are placed after every route is known so they can avoid other edges too.
  const segmentsExcept = (id: string): Segment[] =>
    [...routed.entries()].filter(([k]) => k !== id).flatMap(([, pts]) => pts.slice(1).map((p, i) => ({ a: pts[i]!, b: p })));
  for (const b of bundles) {
    const points = routed.get(b.id);
    if (points) edges.push(makeEdge(b, points, composed.reversed, leafRects, frameRects, labelRects, style, segmentsExcept(b.id)));
  }
  // Second pass: a label placed early did not know about later ones; re-place any that collide now.
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    if (!e.label) continue;
    const others = edges.filter((o) => o !== e && o.label).map((o) => o.label!);
    const collides = others.some((o) => rectsOverlap(e.label!, o, 2)) || leafRects.some((r) => rectsOverlap(e.label!, r));
    if (!collides) continue;
    const label = placeLabel(e.label.text, e.points, leafRects, others, { size: style.labelSize, pad: style.labelPad, maxWidth: EL.maxWidth }, segmentsExcept(e.id), frameRects);
    edges[i] = { ...e, label };
  }
  // Last pass: a label still as near another line as its own is moved, whole route open, if that leaves it unambiguous and colliding with nothing.
  const ambiguous = (r: Rect, id: string): boolean => {
    const own = rectToLine(r, edges.find((x) => x.id === id)!.points);
    return own > LABEL_REACH || edges.some((o) => o.id !== id && o.label?.text !== edges.find((x) => x.id === id)!.label?.text && rectToLine(r, o.points) <= Math.max(own + 2, LABEL_CLEAR));
  };
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    const crossed = (r: Rect): boolean => edges.some((o) => o.id !== e.id && o.points.slice(1).some((q, k) => segmentCrossesRect(o.points[k]!, q, r)));
    if (!e.label || (!ambiguous(e.label, e.id) && !crossed(e.label))) continue;
    const others = edges.filter((o) => o !== e && o.label).map((o) => o.label!);
    const label = placeLabel(e.label.text, e.points, leafRects, others, { size: style.labelSize, pad: style.labelPad, maxWidth: EL.maxWidth }, segmentsExcept(e.id), frameRects);
    const clean = !others.some((o) => rectsOverlap(label, o, 2)) && !leafRects.some((r) => rectsOverlap(label, r));
    const better = (!ambiguous(label, e.id) || ambiguous(e.label, e.id)) && (!crossed(label) || crossed(e.label));
    if (clean && better && (label.x !== e.label.x || label.y !== e.label.y)) edges[i] = { ...e, label };
  }
  const badges = applyPaths(view, edges, style, boxes);
  const highlights = highlightExtras(view, boxes, style);
  const rects: Rect[] = [...edges.flatMap((e) => (e.label ? [e.label] : [])), ...notes.obstacles, ...highlights.flatMap((h) => (h.kind === 'highlight' ? [h.rect] : []))];
  // Notes and highlights may hang past the composed canvas; grow it (and shift everything when they hang past the origin).
  const minX = Math.min(0, ...rects.map((r) => r.x - style.canvasPad)), minY = Math.min(0, ...rects.map((r) => r.y - style.canvasPad));
  const width = Math.max(composed.size.w, ...rects.map((r) => r.x + r.w + style.canvasPad)) - minX;
  const pictureHeight = Math.max(composed.size.h, ...rects.map((r) => r.y + r.h + style.canvasPad)) - minY;
  const foot = footer(view, edges, width, pictureHeight, style);
  const height = pictureHeight + foot.height;
  // A narrow picture grows to hold what is written under it, as it does for notes that hang past it.
  const canvasW = Math.max(width, foot.width);
  const layout: Layout = {
    viewId: view.id,
    title: view.title,
    width: Math.ceil(canvasW),
    height: Math.ceil(height),
    ...(foot.height > 0 ? { figureHeight: Math.ceil(pictureHeight) } : {}),
    boxes,
    edges,
    extras: [...highlights, ...composed.extras, ...notes.extras, ...badges, ...foot.extras],
    metrics: withImplied(measureQuality(boxes, edges, width, pictureHeight, badges), visible.implied, model),
  };
  return minX < 0 || minY < 0 ? shiftLayout(layout, -minX, -minY) : layout;
}

/** The count chip ("3 inside") a leaf wears across its top-right corner, where it is drawn: 6 past the corner, 9 above and below the top edge. */
function leafChip(b: LayoutBox): (Rect & { id: string })[] {
  if (!b.badge || b.kind === 'container') return [];
  const w = chipWidth(b.badge);
  return [{ id: `${b.id}#chip`, x: b.x + b.w + CH.overhang - w, y: b.y - CH.rise, w, h: CH.height }];
}

/** An edge lifted to a container leaves it opposite the boxes it stands for: the middle of its members at that end. */
function focusOf(b: Bundle, byId: ReadonlyMap<string, LayoutBox>): { fromFocus?: Point; toFocus?: Point } {
  const members = b.hops.flatMap((h) => h.members.map((m) => m.split('>') as [string, string]));
  const middle = (ids: string[], end: string): Point | undefined => {
    const rs = ids.filter((id) => id !== end).map((id) => byId.get(id)).filter((r): r is LayoutBox => r !== undefined);
    if (!rs.length) return undefined;
    return { x: rs.reduce((a, r) => a + r.x + r.w / 2, 0) / rs.length, y: rs.reduce((a, r) => a + r.y + r.h / 2, 0) / rs.length };
  };
  const f = middle([...new Set(members.map((m) => m[0]))], b.from), t = middle([...new Set(members.map((m) => m[1]))], b.to);
  return { ...(f ? { fromFocus: f } : {}), ...(t ? { toFocus: t } : {}) };
}

/** How far the count chip ("3 inside") on a leaf's top-right corner reaches back along its top side; it hangs 6 pixels past the corner. */
function chips(from: LayoutBox, to: LayoutBox): { fromChip?: number; toChip?: number } {
  const w = (b: LayoutBox): number | undefined => (b.badge && b.kind !== 'container' ? chipWidth(b.badge) - CH.overhang : undefined);
  const f = w(from), t = w(to);
  return { ...(f ? { fromChip: f } : {}), ...(t ? { toChip: t } : {}) };
}

/** A container's header band: title, subtitle, and facts, however many lines they wrap to. A label must not cover it. */
export function containerHeaderBand(b: LayoutBox, style: LayoutStyle): Rect {
  return { x: b.x, y: b.y, w: b.w, h: b.inner ? Math.max(style.containerHeader, b.inner.y - b.y - RULES.container.headerInset) : style.containerHeader };
}

/** A drawn container's four frame lines as thin strips: a label on one hides only a line, so it is a softer miss than covering words. */
export function frameLines(b: LayoutBox): Rect[] {
  if (b.frame === 'none') return [];
  const t = RL.frameStrip;
  return [{ x: b.x - t, y: b.y - t, w: b.w + t * 2, h: t * 2 }, { x: b.x - t, y: b.y + b.h - t, w: b.w + t * 2, h: t * 2 }, { x: b.x - t, y: b.y - t, w: t * 2, h: b.h + t * 2 }, { x: b.x + b.w - t, y: b.y - t, w: t * 2, h: b.h + t * 2 }];
}

function withImplied(m: Layout['metrics'], implied: VisibleSet['implied'], model: Model): Layout['metrics'] {
  if (!implied.length) return m;
  const name = (id: string): string => model.nodes.get(id)?.name ?? id;
  const notes = implied.map((r) => `relation ${name(r.from)} -> ${name(r.to)}${r.label ? ` (${r.label})` : ''} connects a container to its own content; containment already shows it, so it is not drawn`);
  return { ...m, notes: [...m.notes, ...notes] };
}

function makeEdge(b: Bundle, points: Point[], reversed: Set<string>, leafRects: readonly Rect[], frameRects: readonly Rect[], labelRects: Rect[], style: LayoutStyle, others: readonly Segment[]): LayoutEdge {
  const first = b.hops[0]!;
  const rel: ModelRelation = first.relation;
  const labelText = bundleLabel(b.hops);
  const label = labelText ? placeLabel(labelText, points, leafRects, labelRects, { size: style.labelSize, pad: style.labelPad, maxWidth: EL.maxWidth }, others, frameRects) : undefined;
  if (label) labelRects.push(label);
  const kinds = new Set(b.hops.map((h) => h.relation.kind));
  return {
    id: b.id,
    relation: rel,
    from: b.from,
    to: b.to,
    kind: kinds.size === 1 ? first.relation.kind : 'sync',
    points,
    ...(label ? { label } : {}),
    both: b.hops.some((h) => h.relation.both),
    bundled: b.hops.reduce((a, h) => a + h.members.length, 0),
    members: b.hops.flatMap((h) => h.members),
    reversed: b.hops.some((h) => reversed.has(h.id)),
    style: rel.style,
    ...(rel.heads ? { heads: rel.heads } : {}),
  };
}

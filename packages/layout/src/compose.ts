/**
 * The compositor. Sizes every visible box bottom-up from its text and its
 * children, chooses an arrangement per container, and places children
 * top-down. No global graph layout: each container is its own small
 * problem, which is why nested boxes stay tidy at any size.
 */
import type { Model, ModelNode, ResolvedRelationView, Arrangement, Direction } from '@vantage/model';
import type { Rect, Size } from './geometry.ts';
import type { LayoutStyle } from './style.ts';
import type { Extra, LayoutBox } from './types.ts';
import { sizeLeaf, sizeContainer, type Sized, type Placement } from './compose-size.ts';
import { wrapText } from './text/measure.ts';
import { arrangeFlow, type FlowItem } from './arrange/flow.ts';
import { arrangeGrid } from './arrange/grid.ts';
import { crossingAfter, gutterWidth, type GutterEdge } from './arrange/gutter.ts';
import { placeLayers } from './arrange/place.ts';
import { arrangeMatrix, arrangeMirror, arrangeOutline, arrangeRing, type LocalExtra } from './arrange/gesture.ts';
import { liftTo, type VisibleSet } from './visible.ts';
import { composePinned } from './compose-pinned.ts';

export interface ComposeResult {
  readonly boxes: LayoutBox[];
  readonly size: Size;
  /** Hop ids whose direction was reversed to break a cycle, per container. */
  readonly reversed: Set<string>;
  /** Dividers and axis labels the arrangements asked for, in canvas coordinates. */
  readonly extras: Extra[];
  /** How far pinned geometry was moved to start at the canvas pad; pinned edges shift by the same amount. */
  readonly pinOffset?: { x: number; y: number };
}

interface Arranged {
  readonly placed: { id: string; rect: Rect }[];
  readonly size: Size;
  readonly extras: LocalExtra[];
}

const FLIP: Record<Direction, Direction> = { right: 'left', left: 'right', down: 'up', up: 'down' };

/** Hints as written, plus the ones a gesture implies for its children (a mirror flips every other half). */
function deriveHints(model: Model, view: ResolvedRelationView): Map<string, Arrangement> {
  const hints = new Map(view.arrange.map((a) => [a.node, a]));
  for (const [id, hint] of [...hints]) {
    if (hint.as !== 'mirror') continue;
    const all = id === 'root' ? model.roots : (model.nodes.get(id)?.childIds ?? []);
    const named = (hint.order ?? []).filter((c) => all.includes(c));
    const children = [...named, ...all.filter((c) => !named.includes(c))];
    const base = hint.direction ?? view.direction;
    children.forEach((c, i) => {
      const own = hints.get(c);
      const dir = i % 2 ? FLIP[base] : base;
      hints.set(c, own ? { ...own, direction: own.direction ?? dir } : { node: c, direction: dir });
    });
  }
  return hints;
}

export function compose(model: Model, view: ResolvedRelationView, visible: VisibleSet, style: LayoutStyle, anchors?: ReadonlyMap<string, { x: number; y: number }>): ComposeResult {
  if (view.pins && Object.keys(view.pins.nodes).length) return composePinned(model, view, visible, view.pins, style);
  const reversed = new Set<string>();
  const hints = deriveHints(model, view);
  const order = new Map<string, number>();
  let i = 0;
  for (const id of model.nodes.keys()) order.set(id, i++);
  const groups = view.highlights.map((h) => h.nodes);
  const decor = new Map<string, LocalExtra[]>();

  const sizeNode = (id: string): Sized => {
    const vn = visible.nodes.get(id)!;
    const node = model.nodes.get(id)!;
    if (vn.kind !== 'container') return sizeLeaf(node, vn.kind, vn.hiddenChildren, style);
    const children = vn.children.map(sizeNode);
    const placed = arrangeChildren(id, children, model, view, visible, hints.get(id), order, groups, style, reversed, anchors);
    decor.set(id, placed.extras);
    return sizeContainer(node, children, placed, vn.hiddenChildren, hints.get(id)?.as === 'outline', style);
  };

  const roots = visible.roots.map(sizeNode);
  const placedRoots = arrangeChildren(undefined, roots, model, view, visible, hints.get('root'), order, groups, style, reversed, anchors);
  const boxes: LayoutBox[] = [];
  const extras: Extra[] = [];
  const shift = (list: readonly LocalExtra[], ox: number, oy: number, owner: string): void => {
    list.forEach((e, n) => {
      const id = `${owner}-decor-${n}`;
      if (e.kind === 'line') extras.push({ kind: 'line', id, from: { x: e.from.x + ox, y: e.from.y + oy }, to: { x: e.to.x + ox, y: e.to.y + oy }, style: e.style });
      else extras.push({ kind: 'text', id, role: e.role, text: { ...e.text, x: e.text.x + ox, y: e.text.y + oy } });
    });
  };
  const emit = (p: Placement, ox: number, oy: number, parentId: string | undefined): void => {
    const x = ox + p.rect.x, y = oy + p.rect.y;
    const b = p.sized.box;
    boxes.push({
      ...b,
      x,
      y,
      ...(parentId !== undefined ? { parentId } : {}),
      ...(b.inner ? { inner: { x: x + b.inner.x, y: y + b.inner.y, w: b.inner.w, h: b.inner.h } } : {}),
    });
    if (b.inner) shift(decor.get(p.sized.id) ?? [], x + b.inner.x, y + b.inner.y, p.sized.id);
    for (const c of p.sized.children) emit(c, x, y, p.sized.id);
  };
  const rootById = new Map(roots.map((r) => [r.id, r]));
  for (const p of placedRoots.placed) emit({ sized: rootById.get(p.id)!, rect: p.rect }, style.canvasPad, style.canvasPad, undefined);
  shift(placedRoots.extras, style.canvasPad, style.canvasPad, 'root');
  return { boxes, size: { w: placedRoots.size.w + style.canvasPad * 2, h: placedRoots.size.h + style.canvasPad * 2 }, reversed, extras };
}

function arrangeChildren(
  container: string | undefined,
  children: Sized[],
  model: Model,
  view: ResolvedRelationView,
  visible: VisibleSet,
  hint: Arrangement | undefined,
  order: Map<string, number>,
  groups: readonly (readonly string[])[],
  style: LayoutStyle,
  reversed: Set<string>,
  anchors?: ReadonlyMap<string, { x: number; y: number }>,
): Arranged {
  const childIds = new Set(children.map((c) => c.id));
  const internal: { from: string; to: string; weight: number; id: string; label?: string }[] = [];
  const externalIn = new Map<string, number>();
  const externalOut = new Map<string, number>();
  for (const hop of visible.hops) {
    const a = liftTo(visible, container, hop.from);
    const b = liftTo(visible, container, hop.to);
    if (a !== undefined && b !== undefined && childIds.has(a) && childIds.has(b)) {
      if (a !== b) internal.push({ from: a, to: b, weight: hop.relation.weight, id: hop.id, ...(hop.relation.label !== undefined ? { label: hop.relation.label } : {}) });
    } else if (a !== undefined && childIds.has(a)) {
      externalOut.set(a, (externalOut.get(a) ?? 0) + 1);
    } else if (b !== undefined && childIds.has(b)) {
      externalIn.set(b, (externalIn.get(b) ?? 0) + 1);
    }
  }
  const direction = hint?.direction ?? view.direction;
  const mode = hint?.as ?? (internal.length ? 'flow' : children.length <= 4 ? (direction === 'right' || direction === 'left' ? 'column' : 'row') : 'grid');
  const gap = hint?.gap ?? style.gridGap;
  // The author's order wins; otherwise where these nodes sat in the previous view breaks ties, so views feel like one place.
  const explicit = hint?.order ?? anchorOrder(children.map((c) => c.id), anchors, direction);
  const items = children.map((c) => ({ id: c.id, size: c.size, tags: model.nodes.get(c.id)?.tags ?? [] }));
  const sorted = keepTogether([...items].sort((a, b) => rank(a.id, explicit, order) - rank(b.id, explicit, order)), groups);
  const horizontal = direction === 'right' || direction === 'left';
  const traffic: GutterEdge[] = internal.map((e) => {
    const lw = e.label ? wrapText(e.label, style.labelSize, 'regular', 160, 3) : undefined;
    return { from: e.from, to: e.to, label: { w: lw?.width ?? 0, h: lw?.height ?? 0 } };
  });

  switch (mode) {
    case 'grid':
    case 'row':
    case 'column':
      return { ...arrangeGrid(sorted, { mode, columns: hint?.columns, gap, aspect: container === undefined ? 1.8 : 1.4, traffic: { edges: traffic, style } }), extras: [] };
    case 'mirror':
      return arrangeMirror(sorted, direction, gap, hint?.divider ?? false);
    case 'ring':
      return arrangeRing(sorted, hint?.center ?? hub(sorted.map((s) => s.id), internal), gap);
    case 'outline':
      return arrangeOutline(sorted, style.indent, Math.max(8, gap - 8));
    case 'matrix':
      return arrangeMatrix(sorted, hint?.matrix ?? { rows: [] }, gap, hint?.divider ?? true, style.nameSize);
    case 'auto':
    case 'flow':
      break;
  }
  const flowItems: FlowItem[] = children.map((c) => {
    const node = model.nodes.get(c.id)!;
    return { id: c.id, role: node.role, order: order.get(c.id)!, externalIn: externalIn.get(c.id) ?? 0, externalOut: externalOut.get(c.id) ?? 0 };
  });
  const flow = arrangeFlow(flowItems, internal, explicit, hint?.layers ?? []);
  for (const e of internal) if (flow.reversed.has(`${e.from}>${e.to}`)) reversed.add(e.id);
  // Past the layer gap, a gutter takes the room its widest label needs, and more when many lines cross it.
  const layerGap = hint?.gap ?? style.layerGap;
  const labelRoom = new Map<number, number>();
  for (const e of internal) {
    if (!e.label) continue;
    const l = Math.min(flow.layer.get(e.from)!, flow.layer.get(e.to)!);
    const lw = wrapText(e.label, style.labelSize, 'regular', 160, 3);
    const room = horizontal ? lw.width + 36 : lw.height + 28;
    labelRoom.set(l, Math.max(labelRoom.get(l) ?? 0, room));
  }
  for (let l = 0; l + 1 < flow.layers.length; l++) {
    const need = gutterWidth(crossingAfter(traffic, flow.layer, l), horizontal ? 'x' : 'y', style) - layerGap;
    if (need > (labelRoom.get(l) ?? 0)) labelRoom.set(l, need);
  }
  const sizes = children.map((c) => ({ id: c.id, size: c.size }));
  return { ...placeLayers(flow, sizes, internal, { direction, siblingGap: style.siblingGap, layerGap, labelRoom, align: hint?.align ?? 'center' }), extras: [] };
}

/** The child with the most arrows is the hub of a ring when the author named none. */
function hub(ids: readonly string[], internal: readonly { from: string; to: string }[]): string {
  const degree = new Map(ids.map((id) => [id, 0]));
  for (const e of internal) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  return [...ids].sort((a, b) => degree.get(b)! - degree.get(a)!)[0] ?? ids[0]!;
}

/** Highlight members sit next to each other: each group moves to where its first member sorted. */
function keepTogether<T extends { id: string }>(sorted: T[], groups: readonly (readonly string[])[]): T[] {
  let out = sorted;
  for (const g of groups) {
    const members = new Set(g);
    const first = out.findIndex((x) => members.has(x.id));
    if (first < 0) continue;
    const inside = out.filter((x) => members.has(x.id));
    if (inside.length < 2) continue;
    const rest = out.filter((x) => !members.has(x.id));
    const at = Math.min(first, rest.length);
    out = [...rest.slice(0, at), ...inside, ...rest.slice(at)];
  }
  return out;
}

/** Children that have an anchor, sorted along the cross axis of the flow. */
function anchorOrder(ids: readonly string[], anchors: ReadonlyMap<string, { x: number; y: number }> | undefined, direction: Direction): string[] {
  if (!anchors) return [];
  const horizontal = direction === 'right' || direction === 'left';
  return ids.filter((id) => anchors.has(id)).sort((a, b) => (horizontal ? anchors.get(a)!.y - anchors.get(b)!.y : anchors.get(a)!.x - anchors.get(b)!.x));
}

function rank(id: string, explicit: readonly string[], order: Map<string, number>): number {
  const e = explicit.indexOf(id);
  return e >= 0 ? e - explicit.length : order.get(id)!;
}


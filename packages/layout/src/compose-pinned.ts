/**
 * Composition for a view with pins. Pinned boxes sit exactly where the pins
 * say; unpinned boxes are placed in free space nearest the boxes they talk
 * to; containers grow in place to hold what lands inside them. This is how
 * an imported drawing keeps its layout and still accepts new content.
 */
import type { Model, Pins, ResolvedRelationView } from '@vantage/model';
import type { Rect, Size } from './geometry.ts';
import { rectsOverlap, union, inflate } from './geometry.ts';
import type { LayoutStyle } from './style.ts';
import type { LayoutBox } from './types.ts';
import { containerHeader, sizeLeaf, sizeLeafFixed, type Sized } from './compose-size.ts';
import { arrangeGrid } from './arrange/grid.ts';
import type { ComposeResult } from './compose.ts';
import type { VisibleSet } from './visible.ts';

interface Placed {
  readonly id: string;
  rect: Rect;
  readonly pinned: boolean;
}

export function composePinned(model: Model, view: ResolvedRelationView, visible: VisibleSet, pins: Pins, style: LayoutStyle): ComposeResult {
  const rects = new Map<string, Placed>();
  const leaves = new Map<string, Sized>();
  const log: string[] = [];

  // Which nodes each node talks to, for anchoring unpinned boxes.
  const related = new Map<string, Set<string>>();
  for (const h of visible.hops) {
    related.set(h.from, (related.get(h.from) ?? new Set()).add(h.to));
    related.set(h.to, (related.get(h.to) ?? new Set()).add(h.from));
  }

  // Pass A, bottom up: pinned rects as given; unpinned containers get a natural size; unpinned leaves a natural size and no position yet.
  const natural = (id: string): Size => {
    const vn = visible.nodes.get(id)!;
    const node = model.nodes.get(id)!;
    const pin = pins.nodes[id];
    if (vn.kind !== 'container') {
      const sized = pin ? sizeLeafFixed(node, vn.kind, vn.hiddenChildren, style, pin) : sizeLeaf(node, vn.kind, vn.hiddenChildren, style);
      leaves.set(id, sized);
      if (pin) rects.set(id, { id, rect: { ...pin }, pinned: true });
      return sized.size;
    }
    const childSizes = vn.children.map((c) => ({ id: c, size: natural(c), tags: [] as string[] }));
    if (pin) {
      rects.set(id, { id, rect: { ...pin }, pinned: true });
      return { w: pin.w, h: pin.h };
    }
    const pinnedKids = vn.children.filter((c) => rects.get(c)?.pinned);
    const hd = containerHeader(node, vn.hiddenChildren, false, style);
    if (pinnedKids.length) {
      // A container with pinned children is as big as they are, plus room; it is positioned by them too.
      const u = inflate(union(pinnedKids.map((c) => rects.get(c)!.rect)), hd.pad);
      const rect: Rect = { x: u.x, y: u.y - hd.header, w: Math.max(u.w, hd.minWidth), h: u.h + hd.header };
      rects.set(id, { id, rect, pinned: true });
      log.push(`container ${id} framed from ${pinnedKids.length} pinned children`);
      return { w: rect.w, h: rect.h };
    }
    const g = arrangeGrid(childSizes, { mode: 'grid', gap: style.gridGap, aspect: 1.4 });
    return { w: Math.max(g.size.w + hd.pad * 2, hd.minWidth), h: g.size.h + hd.header + hd.pad * 2 };
  };
  const rootSizes = visible.roots.map((r) => ({ id: r, size: natural(r) }));

  // Pass B, top down: give every unpinned node a position inside its parent, growing the parent when needed.
  const placeChildren = (id: string): void => {
    const vn = visible.nodes.get(id)!;
    if (vn.kind !== 'container') return;
    const node = model.nodes.get(id)!;
    const hd = containerHeader(node, vn.hiddenChildren, false, style);
    const parent = rects.get(id)!;
    const content: Rect = { x: parent.rect.x + hd.pad, y: parent.rect.y + hd.header, w: parent.rect.w - hd.pad * 2, h: parent.rect.h - hd.header - hd.pad };
    const siblings = vn.children.filter((c) => rects.has(c)).map((c) => rects.get(c)!.rect);
    const placed: Rect[] = [];
    for (const c of vn.children) {
      if (rects.has(c)) continue;
      const size = sizeOf(c);
      const anchors = [...(related.get(c) ?? [])].map((r) => rects.get(r)?.rect).filter((r): r is Rect => r !== undefined);
      const rect = freeSpot(size, content, siblings, anchors, style.gridGap);
      rects.set(c, { id: c, rect, pinned: false });
      siblings.push(rect);
      placed.push(rect);
      log.push(`placed ${c} near ${anchors.length} anchors`);
    }
    // Grow the parent in place to cover what the engine put inside it; pinned children sit where the author drew them.
    if (placed.length) {
      const u = inflate(union(placed), hd.pad);
      const right = Math.max(parent.rect.x + parent.rect.w, u.x + u.w), bottom = Math.max(parent.rect.y + parent.rect.h, u.y + u.h);
      parent.rect = { x: parent.rect.x, y: parent.rect.y, w: right - parent.rect.x, h: bottom - parent.rect.y };
    }
    for (const c of vn.children) placeChildren(c);
  };
  const sizeOf = (id: string): Size => {
    const l = leaves.get(id);
    if (l) return l.size;
    const found = rootSizes.find((r) => r.id === id);
    return found ? found.size : natural(id);
  };

  // Roots: pinned ones first, then unpinned ones in free space on the canvas.
  const placedRoots: Rect[] = visible.roots.filter((r) => rects.get(r)?.pinned).map((r) => rects.get(r)!.rect);
  for (const r of visible.roots) {
    if (rects.has(r)) continue;
    const size = sizeOf(r);
    const anchors = [...(related.get(r) ?? [])].map((x) => rects.get(x)?.rect).filter((x): x is Rect => x !== undefined);
    const canvas: Rect = placedRoots.length ? inflate(union(placedRoots), 400) : { x: style.canvasPad, y: style.canvasPad, w: 4000, h: 4000 };
    const rect = freeSpot(size, canvas, placedRoots, anchors, style.layerGap);
    rects.set(r, { id: r, rect, pinned: false });
    placedRoots.push(rect);
  }
  for (const r of visible.roots) placeChildren(r);

  // Normalise so the picture starts at the canvas pad.
  const all = [...rects.values()].map((p) => p.rect);
  const minX = Math.min(...all.map((r) => r.x)) - style.canvasPad, minY = Math.min(...all.map((r) => r.y)) - style.canvasPad;
  const boxes: LayoutBox[] = [];
  const emit = (id: string, parentId: string | undefined): void => {
    const vn = visible.nodes.get(id)!;
    const node = model.nodes.get(id)!;
    const r = rects.get(id)!.rect;
    const x = r.x - minX, y = r.y - minY;
    if (vn.kind !== 'container') {
      const sized = leaves.get(id)!;
      const fitted = sized.size.w === r.w && sized.size.h === r.h ? sized : sizeLeafFixed(node, vn.kind, vn.hiddenChildren, style, r);
      boxes.push({ ...fitted.box, x, y, ...(parentId !== undefined ? { parentId } : {}) });
      return;
    }
    const hd = containerHeader(node, vn.hiddenChildren, false, style);
    const inner: Rect = { x: x + hd.pad, y: y + hd.header, w: r.w - hd.pad * 2, h: r.h - hd.header - hd.pad };
    boxes.push({ id, kind: 'container', depth: node.depth, node, shape: node.shape, frame: hd.frame, iconOnly: false, x, y, w: r.w, h: r.h, ...hd.parts, inner, ...(parentId !== undefined ? { parentId } : {}) });
    for (const c of vn.children) emit(c, id);
  };
  for (const r of visible.roots) emit(r, undefined);
  const size = union(boxes);
  void view;
  return { boxes, size: { w: size.x + size.w + style.canvasPad, h: size.y + size.h + style.canvasPad }, reversed: new Set(), extras: [], pinOffset: { x: -minX, y: -minY } };
}

/**
 * A spot for a box of `size` inside `area` that overlaps none of `taken`,
 * as close as possible to the centre of `anchors`. Tries beside each anchor
 * first, then scans the area; falls back to below everything.
 */
export function freeSpot(size: Size, area: Rect, taken: readonly Rect[], anchors: readonly Rect[], gap: number): Rect {
  const candidates: Rect[] = [];
  for (const a of anchors) {
    candidates.push({ x: a.x + a.w + gap, y: a.y, ...size });
    candidates.push({ x: a.x, y: a.y + a.h + gap, ...size });
    candidates.push({ x: a.x - gap - size.w, y: a.y, ...size });
    candidates.push({ x: a.x, y: a.y - gap - size.h, ...size });
  }
  const step = Math.max(24, gap);
  for (let y = area.y; y + size.h <= area.y + area.h + step; y += step) for (let x = area.x; x + size.w <= area.x + area.w + step; x += step) candidates.push({ x, y, ...size });
  const cx = anchors.length ? anchors.reduce((s, a) => s + a.x + a.w / 2, 0) / anchors.length : area.x;
  const cy = anchors.length ? anchors.reduce((s, a) => s + a.y + a.h / 2, 0) / anchors.length : area.y;
  let best: Rect | undefined, bestScore = Infinity;
  for (const c of candidates) {
    if (taken.some((t) => rectsOverlap(c, t, gap - 1))) continue;
    const inside = c.x >= area.x && c.y >= area.y && c.x + c.w <= area.x + area.w && c.y + c.h <= area.y + area.h;
    const d = Math.hypot(c.x + c.w / 2 - cx, c.y + c.h / 2 - cy) + (inside ? 0 : 600);
    if (d < bestScore) {
      bestScore = d;
      best = c;
    }
  }
  if (best) return best;
  const bottom = Math.max(area.y, ...taken.map((t) => t.y + t.h));
  return { x: area.x, y: bottom + gap, ...size };
}

/**
 * Gesture arrangements: the shapes a human reaches for when the picture is
 * about something other than flow. A mirror sets two halves face to face,
 * a ring puts one thing in the middle of the others, an outline indents
 * like a tree, and a matrix places children by two tags. Each returns
 * local coordinates plus the decorations (dividers, axis labels) the
 * gesture needs, so the compositor stays one loop.
 */
import type { Direction } from '@vantage/model';
import type { Point, Rect, Size } from '../geometry.ts';
import type { TextBlock } from '../types.ts';
import { textWidth } from '../text/measure.ts';
import { arrangeGrid, type Placed } from './grid.ts';
import { RULES } from '../style.ts';

export type LocalExtra =
  | { readonly kind: 'line'; readonly from: Point; readonly to: Point; readonly style: 'divider' | 'leader' }
  | { readonly kind: 'text'; readonly text: TextBlock; readonly role: 'axis' | 'caption' };

export interface GestureResult {
  readonly placed: Placed[];
  readonly size: Size;
  readonly extras: LocalExtra[];
}

export interface Item {
  readonly id: string;
  readonly size: Size;
  readonly tags: readonly string[];
}

/** Halves side by side across the flow; the compositor flips the direction of every other half so they face each other. */
export function arrangeMirror(items: readonly Item[], direction: Direction, gap: number, divider: boolean): GestureResult {
  const horizontal = direction === 'right' || direction === 'left';
  const g = arrangeGrid(items, { mode: horizontal ? 'row' : 'column', gap: gap * 2, aspect: 1 });
  const extras: LocalExtra[] = [];
  if (divider) {
    for (let i = 1; i < g.placed.length; i++) {
      const a = g.placed[i - 1]!.rect, b = g.placed[i]!.rect;
      if (horizontal) {
        const x = (a.x + a.w + b.x) / 2;
        extras.push({ kind: 'line', from: { x, y: 0 }, to: { x, y: g.size.h }, style: 'divider' });
      } else {
        const y = (a.y + a.h + b.y) / 2;
        extras.push({ kind: 'line', from: { x: 0, y }, to: { x: g.size.w, y }, style: 'divider' });
      }
    }
  }
  return { ...g, extras };
}

/** One child in the middle, the rest on an ellipse around it in author order, starting at the top. */
export function arrangeRing(items: readonly Item[], center: string, gap: number): GestureResult {
  const hub = items.find((i) => i.id === center) ?? items[0]!;
  const others = items.filter((i) => i !== hub);
  if (!others.length) return { placed: [{ id: hub.id, rect: { x: 0, y: 0, ...hub.size } }], size: hub.size, extras: [] };
  const maxW = Math.max(...others.map((i) => i.size.w)), maxH = Math.max(...others.map((i) => i.size.h));
  // The ring must clear the hub and give every spoke its own room along the circumference.
  const perimeterNeed = others.reduce((a, i) => a + Math.max(i.size.w, i.size.h) + gap * 2, 0);
  const rx = Math.max(hub.size.w / 2 + maxW / 2 + gap * 2.5, perimeterNeed / (2 * Math.PI) * 1.15);
  const ry = Math.max(hub.size.h / 2 + maxH / 2 + gap * 2.5, rx * 0.72);
  const rects = new Map<string, Rect>();
  others.forEach((it, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / others.length;
    const cx = Math.cos(angle) * rx, cy = Math.sin(angle) * ry;
    rects.set(it.id, { x: cx - it.size.w / 2, y: cy - it.size.h / 2, w: it.size.w, h: it.size.h });
  });
  const hubRect = { x: -hub.size.w / 2, y: -hub.size.h / 2, w: hub.size.w, h: hub.size.h };
  // A wide hub reaches past the ellipse at the diagonals: push each spoke out along its own angle until it clears the hub, and its earlier neighbours, by two gaps.
  const clearOf = (r: Rect, o: Rect): boolean => r.x + r.w + gap * 2 <= o.x || o.x + o.w + gap * 2 <= r.x || r.y + r.h + gap * 2 <= o.y || o.y + o.h + gap * 2 <= r.y;
  const placedSoFar: Rect[] = [hubRect];
  for (const it of others) {
    let r = rects.get(it.id)!;
    for (let k = 0; k < 40 && placedSoFar.some((o) => !clearOf(r, o)); k++) {
      const cx = (r.x + r.w / 2) * 1.06, cy = (r.y + r.h / 2) * 1.06;
      r = { x: cx - r.w / 2, y: cy - r.h / 2, w: r.w, h: r.h };
    }
    rects.set(it.id, r);
    placedSoFar.push(r);
  }
  rects.set(hub.id, hubRect);
  const minX = Math.min(...[...rects.values()].map((r) => r.x)), minY = Math.min(...[...rects.values()].map((r) => r.y));
  const placed = items.map((it) => {
    const r = rects.get(it.id)!;
    return { id: it.id, rect: { x: Math.round(r.x - minX), y: Math.round(r.y - minY), w: r.w, h: r.h } };
  });
  const w = Math.max(...placed.map((p) => p.rect.x + p.rect.w)), h = Math.max(...placed.map((p) => p.rect.y + p.rect.h));
  return { placed, size: { w, h }, extras: [] };
}

/** A stacked list with every child indented, the way a file tree reads. */
export function arrangeOutline(items: readonly Item[], indent: number, gap: number): GestureResult {
  const g = arrangeGrid(items, { mode: 'column', gap, aspect: 1 });
  const placed = g.placed.map((p) => ({ id: p.id, rect: { ...p.rect, x: indent } }));
  const w = Math.max(...placed.map((p) => p.rect.x + p.rect.w));
  return { placed, size: { w, h: g.size.h }, extras: [] };
}

export interface MatrixSpec {
  readonly rows: readonly string[];
  readonly columns?: readonly string[] | undefined;
}

/** Children land in the cell whose row tag and column tag they carry; a child with no matching tag goes to an extra row named Other. */
export function arrangeMatrix(items: readonly Item[], spec: MatrixSpec, gap: number, divider: boolean, labelSize: number): GestureResult {
  const allCols = spec.columns?.length ? [...spec.columns] : [''];
  const allRows = [...spec.rows];
  const cellItems = new Map<string, Item[]>();
  for (const it of items) {
    const r = allRows.find((t) => it.tags.includes(t));
    const c = allCols.length === 1 && allCols[0] === '' ? '' : allCols.find((t) => it.tags.includes(t));
    const rowKey = r ?? 'Other';
    if (r === undefined && !allRows.includes('Other')) allRows.push('Other');
    const colKey = c ?? allCols[0]!;
    const k = `${rowKey}|${colKey}`;
    cellItems.set(k, [...(cellItems.get(k) ?? []), it]);
  }
  // Empty rows and columns are dropped so the author can list every tag without paying for the unused ones.
  const rows = allRows.filter((r) => allCols.some((c) => cellItems.has(`${r}|${c}`)));
  const cols = allCols.filter((c) => allRows.some((r) => cellItems.has(`${r}|${c}`)));
  const rowHead = Math.max(0, ...rows.map((r) => textWidth(r, labelSize, 'semibold'))) + (rows.some((r) => r) ? gap : 0);
  const colHead = cols.some((c) => c) ? labelSize * 1.6 + gap / 2 : 0;
  const cell = new Map<string, ReturnType<typeof arrangeGrid>>();
  const colW = cols.map(() => 0), rowH = rows.map(() => 0);
  rows.forEach((r, ri) => cols.forEach((c, ci) => {
    const list = cellItems.get(`${r}|${c}`) ?? [];
    const g = arrangeGrid(list, { mode: 'grid', gap, aspect: 1.2 });
    cell.set(`${ri}|${ci}`, g);
    colW[ci] = Math.max(colW[ci]!, g.size.w);
    rowH[ri] = Math.max(rowH[ri]!, g.size.h);
  }));
  // Cells sit well clear of the dividers so a route in the gap never traces a divider.
  const pad = Math.max(gap, RULES.gesture.matrixPadMin);
  const xs: number[] = [];
  let x = rowHead;
  cols.forEach((_, ci) => { xs.push(x); x += colW[ci]! + pad * 2; });
  const ys: number[] = [];
  let y = colHead;
  rows.forEach((_, ri) => { ys.push(y); y += rowH[ri]! + pad * 2; });
  const placed: Placed[] = [];
  const extras: LocalExtra[] = [];
  rows.forEach((r, ri) => cols.forEach((c, ci) => {
    const g = cell.get(`${ri}|${ci}`)!;
    const ox = xs[ci]! + pad + (colW[ci]! - g.size.w) / 2, oy = ys[ri]! + pad + (rowH[ri]! - g.size.h) / 2;
    for (const p of g.placed) placed.push({ id: p.id, rect: { x: ox + p.rect.x, y: oy + p.rect.y, w: p.rect.w, h: p.rect.h } });
    if (ri === 0 && c) extras.push({ kind: 'text', role: 'axis', text: { lines: [c], size: labelSize, weight: 'semibold', x: xs[ci]! + pad + colW[ci]! / 2, y: 0, lineHeight: labelSize * 1.25, anchor: 'middle' } });
    if (ci === 0 && r) extras.push({ kind: 'text', role: 'axis', text: { lines: [r], size: labelSize, weight: 'semibold', x: 0, y: ys[ri]! + pad + rowH[ri]! / 2 - labelSize * 0.6, lineHeight: labelSize * 1.25, anchor: 'start' } });
  }));
  if (divider) {
    for (let ri = 1; ri < rows.length; ri++) extras.push({ kind: 'line', from: { x: rowHead, y: ys[ri]! }, to: { x, y: ys[ri]! }, style: 'divider' });
    for (let ci = 1; ci < cols.length; ci++) extras.push({ kind: 'line', from: { x: xs[ci]!, y: colHead }, to: { x: xs[ci]!, y }, style: 'divider' });
  }
  return { placed, size: { w: x, h: y }, extras };
}

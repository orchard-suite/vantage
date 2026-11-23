/**
 * Grid, row, and column arrangements for children with no flow between
 * them. Cells are uniform per column and row, the way Lucidscale packs cloud
 * resources, because equal cells read as "these are peers".
 */
import type { Size, Rect } from '../geometry.ts';
import { crossingAfter, gutterWidth, type GutterEdge, type GutterStyle } from './gutter.ts';

export interface GridOptions {
  readonly mode: 'grid' | 'row' | 'column';
  readonly columns?: number | undefined;
  readonly gap: number;
  /** Target width over height for a free grid. */
  readonly aspect: number;
  /** Lines between the items: a gutter they cross widens past `gap` to hold them. */
  readonly traffic?: { readonly edges: readonly GutterEdge[]; readonly style: GutterStyle } | undefined;
}

export interface Placed {
  readonly id: string;
  readonly rect: Rect;
}

export function arrangeGrid(items: readonly { id: string; size: Size }[], opts: GridOptions): { placed: Placed[]; size: Size } {
  const n = items.length;
  if (!n) return { placed: [], size: { w: 0, h: 0 } };
  const cols = opts.mode === 'row' ? n : opts.mode === 'column' ? 1 : (opts.columns ?? bestColumns(items, opts));
  const rows = Math.ceil(n / cols);
  const colW: number[] = Array.from({ length: cols }, () => 0);
  const rowH: number[] = Array.from({ length: rows }, () => 0);
  items.forEach((it, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    colW[c] = Math.max(colW[c]!, it.size.w);
    rowH[r] = Math.max(rowH[r]!, it.size.h);
  });
  // Uniform cells when sizes are close; peers should look like peers.
  const maxW = Math.max(...colW), minW = Math.min(...colW);
  if (opts.mode === 'grid' && maxW / Math.max(1, minW) < 1.6) colW.fill(maxW);
  const colOf = new Map(items.map((it, i) => [it.id, i % cols]));
  const rowOf = new Map(items.map((it, i) => [it.id, Math.floor(i / cols)]));
  const gutter = (slot: ReadonlyMap<string, number>, at: number, across: 'x' | 'y'): number =>
    opts.traffic ? Math.max(opts.gap, gutterWidth(crossingAfter(opts.traffic.edges, slot, at), across, opts.traffic.style)) : opts.gap;
  const xs: number[] = [];
  let x = 0;
  for (let c = 0; c < cols; c++) {
    xs.push(x);
    x += colW[c]! + (c + 1 < cols ? gutter(colOf, c, 'x') : 0);
  }
  const ys: number[] = [];
  let y = 0;
  for (let r = 0; r < rows; r++) {
    ys.push(y);
    y += rowH[r]! + (r + 1 < rows ? gutter(rowOf, r, 'y') : 0);
  }
  const placed = items.map((it, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const cellW = colW[c]!, cellH = rowH[r]!;
    return { id: it.id, rect: { x: xs[c]! + (cellW - it.size.w) / 2, y: ys[r]!, w: it.size.w, h: it.size.h } };
  });
  return { placed, size: { w: x, h: y } };
}

function bestColumns(items: readonly { id: string; size: Size }[], opts: GridOptions): number {
  const n = items.length;
  const avgW = items.reduce((a, i) => a + i.size.w, 0) / n + opts.gap;
  const avgH = items.reduce((a, i) => a + i.size.h, 0) / n + opts.gap;
  let best = 1;
  let bestScore = Infinity;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = cols * avgW, h = rows * avgH;
    const ratio = w / h;
    const score = Math.abs(Math.log(ratio / opts.aspect)) + (cols * rows - n) * 0.05;
    if (score < bestScore) {
      bestScore = score;
      best = cols;
    }
  }
  return best;
}

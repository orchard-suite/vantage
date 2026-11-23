/**
 * Page layout: panels of heading, prose, and an embedded view, composed
 * on one canvas in columns. The poster form: several small pictures that
 * together make one argument.
 */
import type { Model, ResolvedPageView, ResolvedView } from '@vantage/model';
import type { Extra, Layout, LayoutBox, LayoutEdge } from './types.ts';
import { DEFAULT_STYLE, type LayoutStyle } from './style.ts';
import { wrapText } from './text/measure.ts';
import { shiftLayout } from './shift.ts';
import { measureQuality } from './metrics.ts';

interface PanelSized {
  readonly heading?: ReturnType<typeof wrapText>;
  readonly text?: ReturnType<typeof wrapText>;
  readonly layout?: Layout;
  readonly w: number;
  readonly h: number;
  readonly span: number;
}

/** Widest a page may be and still read on a laptop screen; wider, it drops a column. */
export const PAGE_MAX_WIDTH = 2400;

export function layoutPageView(model: Model, view: ResolvedPageView, layoutInner: (v: ResolvedView) => Layout, style: LayoutStyle = DEFAULT_STYLE): Layout {
  const pad = style.containerPad;
  const sized: PanelSized[] = view.panels.map((p) => {
    const inner = p.view !== undefined ? model.views.find((v) => v.id === p.view) : undefined;
    const layout = inner && inner.kind !== 'page' ? layoutInner(inner) : undefined;
    const textW = Math.max(320, Math.min(style.proseWidth, layout?.width ?? 480));
    const heading = p.heading ? wrapText(p.heading, style.headingSize, 'semibold', textW, 3, 1.3) : undefined;
    const text = p.text ? wrapText(p.text, style.proseSize, 'regular', textW, 60, 1.45) : undefined;
    const w = Math.max(layout?.width ?? 0, heading?.width ?? 0, text?.width ?? 0) + pad * 2;
    const h = pad + (heading ? heading.height + 8 : 0) + (text ? text.height + 12 : 0) + (layout?.height ?? 0) + pad;
    return { ...(heading ? { heading } : {}), ...(text ? { text } : {}), ...(layout ? { layout } : {}), w, h, span: p.span ?? 1 };
  });
  // The author's columns, fewer when that many panels side by side would be too wide to read: a long page scrolls, a wide one shrinks.
  let columns = view.columns ?? 1;
  while (columns > 1 && pageWidth(sized, columns, pad, style) > PAGE_MAX_WIDTH) columns--;
  return placePanels(view, sized.map((p) => ({ ...p, span: Math.min(columns, p.span) })), columns, style);
}

/** Column widths for panels flowed left to right into rows of this many columns. */
function columnWidths(sized: readonly PanelSized[], columns: number, pad: number): { rows: { panels: number[]; cols: number[] }[]; colW: number[] } {
  // Rows fill left to right; a panel that does not fit the remaining columns starts a new row.
  const rows: { panels: number[]; cols: number[] }[] = [];
  let used = 0;
  sized.forEach((p, i) => {
    if (!rows.length || used + p.span > columns) {
      rows.push({ panels: [], cols: [] });
      used = 0;
    }
    rows[rows.length - 1]!.panels.push(i);
    rows[rows.length - 1]!.cols.push(used);
    used += p.span;
  });
  const colW: number[] = Array.from({ length: columns }, () => 0);
  for (const r of rows) r.panels.forEach((pi, k) => { const p = sized[pi]!; if (p.span === 1) colW[r.cols[k]!] = Math.max(colW[r.cols[k]!]!, p.w); });
  for (const r of rows) r.panels.forEach((pi, k) => {
    const p = sized[pi]!;
    if (p.span === 1) return;
    const c0 = r.cols[k]!;
    const have = colW.slice(c0, c0 + p.span).reduce((a, b) => a + b, 0) + (p.span - 1) * pad;
    if (have < p.w) colW[c0 + p.span - 1] = colW[c0 + p.span - 1]! + (p.w - have);
  });
  return { rows, colW };
}

function pageWidth(sized: readonly PanelSized[], columns: number, pad: number, style: LayoutStyle): number {
  const { colW } = columnWidths(sized.map((p) => ({ ...p, span: Math.min(columns, p.span) })), columns, pad);
  return colW.reduce((a, b) => a + b, 0) + (columns - 1) * pad + style.canvasPad * 2;
}

function placePanels(view: ResolvedPageView, sized: readonly PanelSized[], columns: number, style: LayoutStyle): Layout {
  const pad = style.containerPad;
  const { rows, colW } = columnWidths(sized, columns, pad);
  const colX: number[] = [];
  let x = style.canvasPad;
  for (const w of colW) { colX.push(x); x += w + pad; }
  const width = x - pad + style.canvasPad;

  const boxes: LayoutBox[] = [];
  const edges: LayoutEdge[] = [];
  const extras: Extra[] = [];
  let y = style.canvasPad;
  rows.forEach((r, ri) => {
    const rowH = Math.max(...r.panels.map((pi) => sized[pi]!.h));
    r.panels.forEach((pi, k) => {
      const p = sized[pi]!;
      const c0 = r.cols[k]!;
      const px = colX[c0]!;
      const pw = colW.slice(c0, c0 + p.span).reduce((a, b) => a + b, 0) + (p.span - 1) * pad;
      extras.push({ kind: 'panel', id: `panel-${ri}-${k}`, rect: { x: px, y, w: pw, h: rowH } });
      let cy = y + pad;
      if (p.heading) {
        extras.push({ kind: 'text', id: `panel-${pi}-heading`, role: 'heading', text: { lines: p.heading.lines, size: style.headingSize, weight: 'semibold', x: px + pad, y: cy, lineHeight: p.heading.lineHeight, anchor: 'start' } });
        cy += p.heading.height + 8;
      }
      if (p.text) {
        extras.push({ kind: 'text', id: `panel-${pi}-text`, role: 'prose', text: { lines: p.text.lines, size: style.proseSize, weight: 'regular', x: px + pad, y: cy, lineHeight: p.text.lineHeight, anchor: 'start' } });
        cy += p.text.height + 12;
      }
      if (p.layout) {
        const l = shiftLayout(p.layout, px + pad + (pw - pad * 2 - p.layout.width) / 2, cy);
        boxes.push(...l.boxes);
        edges.push(...l.edges);
        extras.push(...(l.extras ?? []));
      }
    });
    y += rowH + pad;
  });
  const height = y - pad + style.canvasPad;
  const m = measureQuality(boxes, edges, width, height);
  return { viewId: view.id, title: view.title, width: Math.ceil(width), height: Math.ceil(height), boxes, edges, extras, metrics: { ...m, notes: m.notes.filter((n) => !n.startsWith('no relations')) } };
}

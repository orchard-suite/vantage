/** Moves every coordinate of a layout by an offset; used when notes hang past the origin and when pages embed views. */
import type { Point, Rect } from './geometry.ts';
import type { Extra, Layout, LayoutBox, LayoutEdge } from './types.ts';

const pt = (p: Point, dx: number, dy: number): Point => ({ x: p.x + dx, y: p.y + dy });
const rc = (r: Rect, dx: number, dy: number): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });

export function shiftExtra(e: Extra, dx: number, dy: number): Extra {
  switch (e.kind) {
    case 'lifeline':
      return { ...e, x: e.x + dx, y0: e.y0 + dy, y1: e.y1 + dy };
    case 'activation':
    case 'panel':
    case 'legend':
      return { ...e, rect: rc(e.rect, dx, dy) };
    case 'fragment':
      return { ...e, rect: rc(e.rect, dx, dy), dividers: e.dividers.map((y) => y + dy) };
    case 'note':
    case 'lane':
      return { ...e, rect: rc(e.rect, dx, dy) };
    case 'highlight':
      return { ...e, rect: rc(e.rect, dx, dy), ...(e.label ? { label: { ...e.label, x: e.label.x + dx, y: e.label.y + dy } } : {}) };
    case 'message':
      return { ...e, from: pt(e.from, dx, dy), to: pt(e.to, dx, dy), label: { ...e.label, x: e.label.x + dx, y: e.label.y + dy } };
    case 'badge':
      return { ...e, at: pt(e.at, dx, dy) };
    case 'text':
      return { ...e, text: { ...e.text, x: e.text.x + dx, y: e.text.y + dy } };
    case 'line':
      return { ...e, from: pt(e.from, dx, dy), to: pt(e.to, dx, dy) };
  }
}

export function shiftLayout(l: Layout, dx: number, dy: number): Layout {
  const boxes: LayoutBox[] = l.boxes.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy, ...(b.inner ? { inner: rc(b.inner, dx, dy) } : {}) }));
  const edges: LayoutEdge[] = l.edges.map((e) => ({ ...e, points: e.points.map((p) => pt(p, dx, dy)), ...(e.label ? { label: { ...e.label, x: e.label.x + dx, y: e.label.y + dy } } : {}) }));
  return { ...l, width: l.width + dx, height: l.height + dy, boxes, edges, ...(l.extras ? { extras: l.extras.map((e) => shiftExtra(e, dx, dy)) } : {}) };
}

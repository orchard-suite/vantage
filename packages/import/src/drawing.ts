/**
 * The format-neutral picture both readers produce: pages of shapes and
 * connectors in absolute pixel coordinates, with the style facts the
 * builder needs and nothing format specific. The draw.io and VSDX readers
 * fill this in; the builder turns it into a Vantage document.
 */
import type { Head, EdgeStyle } from '@vantage/model';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type ShapeForm = 'box' | 'rounded' | 'pill' | 'cylinder' | 'hexagon' | 'parallelogram' | 'triangle' | 'document' | 'cloud' | 'ellipse' | 'circle' | 'diamond' | 'person';

export interface RawShape {
  readonly id: string;
  /** Explicit parent shape from the file, when the format records one. */
  readonly parentId?: string;
  readonly rect: Rect;
  /** Plain text lines, already stripped of markup. */
  readonly lines: readonly string[];
  readonly form: ShapeForm;
  /** The file says this is a container (swimlane, container=1, a Visio group with a title). */
  readonly container: boolean;
  /** A group cell with no visual of its own; children fall through to its parent. */
  readonly group: boolean;
  readonly fill?: string;
  readonly stroke?: string;
  readonly dashed: boolean;
  /** Free text with no box around it. */
  readonly text: boolean;
  /** A box drawn without fill or border. */
  readonly frameless: boolean;
  readonly note: boolean;
  /** Embedded picture as a data URL. */
  readonly image?: string;
  /** A vendor library icon the shape draws, as `<vendor>/<category>/<Name>`; the import matches it to an icon id. */
  readonly iconHint?: string;
  /** Raw style tokens the reader could not map, for the report. */
  readonly unmapped: readonly string[];
}

export interface RawEdge {
  readonly id: string;
  readonly source?: string;
  readonly target?: string;
  readonly lines: readonly string[];
  readonly style: EdgeStyle;
  readonly dashed: boolean;
  readonly heads: { readonly from: Head; readonly to: Head };
  /** Start point, bends, and end point in absolute pixels; empty when the file gives no geometry. */
  readonly points: readonly Point[];
  /** True when the reader had to invent the end points from the terminal boxes. */
  readonly syntheticEnds: boolean;
  readonly unmapped: readonly string[];
}

export interface RawPage {
  readonly name: string;
  readonly shapes: readonly RawShape[];
  readonly edges: readonly RawEdge[];
}

export interface Drawing {
  readonly pages: readonly RawPage[];
  readonly warnings: readonly string[];
}

export function center(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function contains(outer: Rect, inner: Rect, tolerance = 1): boolean {
  return inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance && inner.x + inner.w <= outer.x + outer.w + tolerance && inner.y + inner.h <= outer.y + outer.h + tolerance;
}

export function area(r: Rect): number {
  return r.w * r.h;
}

/** Where a line from the centre of `r` toward `toward` leaves the rectangle. */
export function borderPoint(r: Rect, toward: Point): Point {
  const c = center(r);
  const dx = toward.x - c.x, dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const sx = dx === 0 ? Infinity : (r.w / 2) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (r.h / 2) / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

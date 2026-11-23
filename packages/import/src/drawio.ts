/**
 * draw.io reader. An mxfile holds diagrams; each diagram is an
 * mxGraphModel, inline or compressed (base64 of raw deflate of a URL
 * encoded string). Vertices become shapes with absolute geometry (child
 * geometry is relative to the parent), edges become connectors with their
 * waypoints.
 */
import { inflateSync, strFromU8 } from 'fflate';
import type { Drawing, Point, RawEdge, RawPage, RawShape, Rect } from './drawing.ts';
import { borderPoint, center } from './drawing.ts';
import { drawioIconHint } from './icons.ts';
import { edgeForm, flag, imageDataUrl, isContainer, isFrameless, isGroup, isTextOnly, parseStyle, vertexForm, type MxStyle } from './mx-style.ts';
import { htmlToLines, splitLines } from './text.ts';
import { childElements, firstChild, parseXml, textOf, type XmlElement } from './xml.ts';

interface Cell {
  readonly id: string;
  readonly parent: string;
  readonly value: string;
  readonly style: MxStyle;
  readonly vertex: boolean;
  readonly edge: boolean;
  readonly source?: string;
  readonly target?: string;
  readonly geometry?: XmlElement;
}

export function isDrawio(text: string): boolean {
  return /<mxfile|<mxGraphModel/.test(text.slice(0, 4000));
}

/** The mxGraphModel of a diagram element, inflating a compressed payload when needed. */
function modelOf(diagram: XmlElement): XmlElement | undefined {
  const inline = firstChild(diagram, 'mxGraphModel');
  if (inline) return inline;
  const payload = textOf(diagram).trim();
  if (!payload) return undefined;
  const bytes = Uint8Array.from(Buffer.from(payload, 'base64'));
  const inflated = strFromU8(inflateSync(bytes));
  return parseXml(decodeURIComponent(inflated));
}

function cellsOf(model: XmlElement, warnings: string[], page: string): Cell[] {
  const root = firstChild(model, 'root');
  if (!root) return [];
  const cells: Cell[] = [];
  // Ids must be unique; a repeated one is renamed and later cells that name it as parent or end follow the rename.
  const seen = new Set<string>();
  const renamed = new Map<string, string>();
  const unique = (id: string): string => {
    if (!seen.has(id)) {
      seen.add(id);
      renamed.delete(id);
      return id;
    }
    let next = id;
    for (let i = 2; seen.has(next); i++) next = `${id}~${i}`;
    seen.add(next);
    renamed.set(id, next);
    warnings.push(`page ${page}: cell id ${id} repeats; the later one is read as ${next}`);
    return next;
  };
  const ref = (id: string | undefined): string | undefined => (id === undefined ? undefined : renamed.get(id) ?? id);
  for (const el of childElements(root)) {
    // UserObject and object wrappers carry the label and hold the real mxCell.
    const inner = el.name === 'mxCell' ? el : firstChild(el, 'mxCell');
    if (!inner) continue;
    const a: Record<string, string> = { ...inner.attrs };
    if (el !== inner) {
      a['id'] = el.attrs['id'] ?? inner.attrs['id'] ?? '';
      a['value'] = el.attrs['label'] ?? inner.attrs['value'] ?? '';
    }
    const geometry = firstChild(inner, 'mxGeometry');
    const source = ref(a['source']), target = ref(a['target']);
    cells.push({
      id: unique(a['id'] ?? ''),
      parent: ref(a['parent']) ?? '',
      value: a['value'] ?? '',
      style: parseStyle(a['style']),
      vertex: a['vertex'] === '1',
      edge: a['edge'] === '1',
      ...(source !== undefined ? { source } : {}),
      ...(target !== undefined ? { target } : {}),
      ...(geometry ? { geometry } : {}),
    });
  }
  return cells;
}

const num = (v: string | undefined, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function labelLines(value: string, style: MxStyle): string[] {
  return flag(style, 'html') || /<[a-z][^>]*>/i.test(value) ? htmlToLines(value) : splitLines(value);
}

function readPage(name: string, model: XmlElement, warnings: string[]): RawPage {
  const cells = cellsOf(model, warnings, name);
  const byId = new Map(cells.map((c) => [c.id, c]));
  const vertices = cells.filter((c) => c.vertex && c.geometry);
  const absRect = new Map<string, Rect>();
  const rectOf = (c: Cell): Rect => {
    const cached = absRect.get(c.id);
    if (cached) return cached;
    const g = c.geometry!;
    let x = num(g.attrs['x']), y = num(g.attrs['y']);
    const parent = byId.get(c.parent);
    if (parent?.vertex && parent.geometry) {
      const pr = rectOf(parent);
      x += pr.x;
      y += pr.y;
    }
    const r = { x, y, w: num(g.attrs['width']), h: num(g.attrs['height']) };
    absRect.set(c.id, r);
    return r;
  };

  const edgeLabels = new Map<string, string[]>();
  const shapes: RawShape[] = [];
  for (const c of vertices) {
    const parent = byId.get(c.parent);
    if (parent?.edge) {
      // A label cell on an edge.
      const lines = labelLines(c.value, c.style);
      if (lines.length) edgeLabels.set(parent.id, [...(edgeLabels.get(parent.id) ?? []), ...lines]);
      continue;
    }
    const rect = rectOf(c);
    const lines = labelLines(c.value, c.style);
    const vf = vertexForm(c.style, rect.w, rect.h);
    const rawImage = c.style['image'];
    const image = imageDataUrl(rawImage);
    const iconHint = drawioIconHint(c.style);
    const fill = c.style['fillColor'], stroke = c.style['strokeColor'];
    shapes.push({
      id: c.id,
      ...(parent?.vertex ? { parentId: parent.id } : {}),
      rect,
      lines,
      form: vf.form,
      container: isContainer(c.style),
      group: isGroup(c.style) && lines.length === 0,
      ...(fill !== undefined ? { fill } : {}),
      ...(stroke !== undefined ? { stroke } : {}),
      dashed: flag(c.style, 'dashed') && c.style['shape'] !== 'note',
      text: isTextOnly(c.style) && rawImage === undefined,
      frameless: isFrameless(c.style),
      note: c.style['shape'] === 'note',
      ...(image !== undefined ? { image } : {}),
      ...(iconHint !== undefined ? { iconHint } : {}),
      // A vendor stencil is understood as its icon, not reported as an unknown shape.
      unmapped: iconHint !== undefined ? vf.unmapped.filter((u) => !u.startsWith('shape=mxgraph.')) : vf.unmapped,
    });
    if (rawImage !== undefined && image === undefined && iconHint === undefined) warnings.push(`page ${name}: image ${c.id} points at ${rawImage.slice(0, 60)}; only embedded pictures and vendor library icons are kept`);
  }

  const edges: RawEdge[] = [];
  for (const c of cells.filter((x) => x.edge)) {
    const ef = edgeForm(c.style);
    const g = c.geometry;
    const way: Point[] = [];
    let sourcePoint: Point | undefined, targetPoint: Point | undefined;
    if (g) {
      for (const p of childElements(g, 'mxPoint')) {
        const pt = { x: num(p.attrs['x']), y: num(p.attrs['y']) };
        if (p.attrs['as'] === 'sourcePoint') sourcePoint = pt;
        else if (p.attrs['as'] === 'targetPoint') targetPoint = pt;
      }
      const arr = childElements(g, 'Array').find((a) => a.attrs['as'] === 'points');
      for (const p of arr ? childElements(arr, 'mxPoint') : []) way.push({ x: num(p.attrs['x']), y: num(p.attrs['y']) });
    }
    const from = c.source !== undefined ? byId.get(c.source) : undefined;
    const to = c.target !== undefined ? byId.get(c.target) : undefined;
    const fromRect = from?.vertex && from.geometry ? rectOf(from) : undefined;
    const toRect = to?.vertex && to.geometry ? rectOf(to) : undefined;
    const start = portPoint(c.style, 'exit', fromRect) ?? (fromRect ? undefined : sourcePoint);
    const end = portPoint(c.style, 'entry', toRect) ?? (toRect ? undefined : targetPoint);
    // Without a fixed port the edge leaves the box where a line toward its next point crosses the border.
    const first = start ?? (fromRect ? borderPoint(fromRect, way[0] ?? end ?? (toRect ? center(toRect) : center(fromRect))) : undefined);
    const last = end ?? (toRect ? borderPoint(toRect, way[way.length - 1] ?? first ?? center(toRect)) : undefined);
    const synthetic = (start === undefined && fromRect !== undefined) || (end === undefined && toRect !== undefined);
    const points: Point[] = [...(first ? [first] : []), ...way, ...(last ? [last] : [])];
    const lines = [...labelLines(c.value, c.style), ...(edgeLabels.get(c.id) ?? [])];
    edges.push({
      id: c.id,
      ...(c.source !== undefined ? { source: c.source } : {}),
      ...(c.target !== undefined ? { target: c.target } : {}),
      lines,
      style: ef.style,
      dashed: ef.dashed,
      heads: ef.heads,
      points,
      syntheticEnds: synthetic,
      unmapped: ef.unmapped,
    });
  }
  return { name, shapes, edges };
}

/** The exit or entry port of an edge as an absolute point, when the style fixes it. */
function portPoint(style: MxStyle, side: 'exit' | 'entry', rect: Rect | undefined): Point | undefined {
  if (!rect) return undefined;
  const fx = style[`${side}X`], fy = style[`${side}Y`];
  if (fx === undefined || fy === undefined) return undefined;
  return { x: rect.x + rect.w * num(fx) + num(style[`${side}Dx`]), y: rect.y + rect.h * num(fy) + num(style[`${side}Dy`]) };
}

export function readDrawio(text: string): Drawing {
  const root = parseXml(text);
  const warnings: string[] = [];
  const pages: RawPage[] = [];
  if (root.name === 'mxGraphModel') {
    pages.push(readPage('Page 1', root, warnings));
    return { pages, warnings };
  }
  const diagrams = childElements(root, 'diagram');
  diagrams.forEach((d, i) => {
    const model = modelOf(d);
    const name = d.attrs['name'] ?? `Page ${i + 1}`;
    if (!model) {
      warnings.push(`page ${name}: no diagram content`);
      return;
    }
    pages.push(readPage(name, model, warnings));
  });
  return { pages, warnings };
}

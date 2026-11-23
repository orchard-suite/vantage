/**
 * From a classified page to the pieces of a Vantage document: nodes with
 * their text parts, relations from connectors, and one relation view per
 * page that pins every box where the drawing had it and carries the
 * inferred gestures as hints.
 */
import type { Arrangement, DocumentInput, Head, NodeInput, RelationInput } from '@vantage/model';
import { slug } from '@vantage/model';
import { classifyPage, type Classified, type PageClassification } from './classify.ts';
import { matchFamily } from './color.ts';
import type { Point, RawEdge, RawPage, Rect } from './drawing.ts';
import { borderPoint, center } from './drawing.ts';
import { inferArrangements, type InferNode } from './infer.ts';
import { partsOf } from './text.ts';
import { ICON_MAX, Pictures } from './pictures.ts';

type ViewInput = NonNullable<DocumentInput['views']>[number];
/** The relation view as written: the one view kind whose `kind` may be left out. */
export type RelationViewInput = Extract<ViewInput, { kind?: 'relation' | undefined }>;

export interface PageBuild {
  readonly nodes: NodeInput[];
  readonly relations: RelationInput[];
  readonly view: RelationViewInput;
  readonly report: PageReport;
}

export interface PageReport {
  readonly name: string;
  readonly index: number;
  readonly shapes: number;
  readonly edges: number;
  readonly nodes: number;
  readonly containers: number;
  readonly relations: number;
  readonly dropped: readonly string[];
  readonly hints: readonly string[];
  readonly unmappedStyles: readonly string[];
  readonly warnings: readonly string[];
}

const ID_MAX = 40;

/** Shared across pages so ids stay unique in the document. */
export class IdPool {
  private readonly used = new Set<string>();
  take(preferred: string, fallback: string): string {
    const base = (slug(preferred) || fallback).slice(0, ID_MAX).replace(/[-.]+$/, '') || fallback;
    let id = /^[A-Za-z0-9_]/.test(base) ? base : `n-${base}`;
    for (let i = 2; this.used.has(id); i++) id = `${base}-${i}`;
    this.used.add(id);
    return id;
  }
}

const DEFAULT_HEADS: { from: Head; to: Head } = { from: 'none', to: 'filled' };
const SNAP = 10;

function nodeOf(c: Classified, id: string, isContainer: boolean, unmapped: string[], pictures: Pictures): NodeInput {
  const s = c.shape;
  // Free text is one paragraph; a box has a name line and parts below it.
  const parts = c.kind === 'text' ? { name: c.lines.join(' '), facts: [], bullets: [] } : partsOf(c.lines.length ? c.lines : [c.kind === 'image' ? 'Image' : 'Shape']);
  const node: NodeInput = { id, name: parts.name };
  if (parts.subtitle !== undefined) node.subtitle = parts.subtitle;
  if (parts.description !== undefined) node.description = parts.description;
  if (parts.facts.length) node.facts = [...parts.facts];
  if (parts.bullets.length) node.bullets = [...parts.bullets];
  if (c.kind === 'text') node.type = 'text';
  if (c.kind === 'note') node.type = 'note';
  if (c.kind === 'image') {
    // A vendor icon or a small picture reads as an icon with its caption; a large picture stays a picture.
    const small = s.rect.w <= ICON_MAX && s.rect.h <= ICON_MAX;
    const icon = s.iconHint !== undefined || small ? pictures.icon(s, parts.name) : undefined;
    const file = icon === undefined ? pictures.file(s, parts.name) : undefined;
    if (icon !== undefined) {
      node.icon = icon;
      node.size = 'icon';
    } else if (file !== undefined) {
      node.type = 'image';
      node.image = file;
      node.imageWidth = Math.round(s.rect.w);
      node.imageHeight = Math.round(s.rect.h);
    }
  } else {
    // A box that draws a vendor icon, or holds a picture, wears it as its icon.
    const own = Pictures.has(s) ? pictures.icon(s, parts.name) : undefined;
    const icon = own ?? (c.icon ? pictures.icon(c.icon, parts.name) : undefined);
    if (icon !== undefined) node.icon = icon;
  }
  if (c.kind === 'node' && !isContainer && s.form !== 'rounded') node.shape = s.form;
  const style: NonNullable<NodeInput['style']> = {};
  const color = matchFamily(s.fill ?? '') ?? (s.stroke !== undefined ? matchFamily(s.stroke) : undefined);
  if (color && c.kind !== 'text' && node.size !== 'icon') {
    node.color = color.family;
    if (color.exact !== undefined && s.fill !== undefined && matchFamily(s.fill)) style.fill = color.exact;
  }
  if (s.dashed) style.dashed = true;
  if (s.frameless && c.kind === 'node') style.frame = 'none';
  if (Object.keys(style).length) node.style = style;
  unmapped.push(...s.unmapped);
  return node;
}

/** An icon node's pin: the drawn picture plus room for its caption below, which the drawing kept outside the shape. */
function iconPin(r: Rect, name: string): Rect {
  const w = Math.max(r.w, name.length * 7 + 12);
  return { x: r.x - (w - r.w) / 2, y: r.y, w, h: r.h + 22 };
}

function headsOf(e: RawEdge): RelationInput['heads'] | undefined {
  if (e.heads.from === DEFAULT_HEADS.from && e.heads.to === DEFAULT_HEADS.to) return undefined;
  return { from: e.heads.from, to: e.heads.to };
}

/** The kept node whose border the point sits on, for connectors the file left unglued. */
function snapTo(p: Point | undefined, rects: ReadonlyMap<string, Rect>): string | undefined {
  if (!p) return undefined;
  let best: string | undefined, bestD = SNAP;
  for (const [id, r] of rects) {
    const inside = p.x >= r.x - SNAP && p.x <= r.x + r.w + SNAP && p.y >= r.y - SNAP && p.y <= r.y + r.h + SNAP;
    if (!inside) continue;
    const d = Math.min(Math.abs(p.x - r.x), Math.abs(p.x - r.x - r.w), Math.abs(p.y - r.y), Math.abs(p.y - r.y - r.h));
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

export function buildPage(page: RawPage, index: number, ids: IdPool, viewIds: IdPool, warnings: readonly string[], pictures: Pictures): PageBuild {
  const cls: PageClassification = classifyPage(page);
  const unmapped: string[] = [];
  const idOf = new Map<string, string>();
  const childrenOf = new Map<string | undefined, Classified[]>();
  for (const c of cls.nodes) childrenOf.set(c.parentId, [...(childrenOf.get(c.parentId) ?? []), c]);
  const isContainer = (c: Classified): boolean => (childrenOf.get(c.shape.id)?.length ?? 0) > 0;
  const ordered = (list: Classified[] | undefined): Classified[] => [...(list ?? [])].sort((a, b) => readingOrder(a.shape.rect, b.shape.rect));
  let containers = 0;
  const iconNodes = new Map<string, string>();
  const build = (c: Classified): NodeInput => {
    const id = ids.take(c.lines[0] ?? '', `${c.kind}-${c.shape.id}`.toLowerCase().replace(/[^a-z0-9_.-]/g, '-'));
    idOf.set(c.shape.id, id);
    const container = isContainer(c);
    if (container) containers++;
    const node = nodeOf(c, id, container, unmapped, pictures);
    if (node.size === 'icon') iconNodes.set(c.shape.id, node.name);
    if (container) node.children = ordered(childrenOf.get(c.shape.id)).map(build);
    return node;
  };
  const nodes = ordered(childrenOf.get(undefined)).map(build);

  // Relations: both ends must be kept nodes; an unglued end snaps to the box it touches.
  const rects = new Map<string, Rect>();
  for (const c of cls.nodes) rects.set(c.shape.id, c.shape.rect);
  const viewId = viewIds.take(page.name, `page-${index + 1}`);
  const relations: RelationInput[] = [];
  const pinnedEdges: Record<string, Point[]> = {};
  const dropped = cls.dropped.map((d) => `${d.id}: ${d.reason}`);
  for (const e of page.edges) {
    const first = e.points[0], last = e.points[e.points.length - 1];
    const fromShape = e.source !== undefined && idOf.has(e.source) ? e.source : snapTo(first, rects);
    const toShape = e.target !== undefined && idOf.has(e.target) ? e.target : snapTo(last, rects);
    const from = fromShape !== undefined ? idOf.get(fromShape) : undefined;
    const to = toShape !== undefined ? idOf.get(toShape) : undefined;
    if (from === undefined || to === undefined) {
      dropped.push(`${e.id}: ${e.lines.length ? `line "${e.lines.join(' ')}"` : 'line'} with ${from === undefined && to === undefined ? 'no ends' : 'one loose end'}`);
      continue;
    }
    if (from === to) {
      dropped.push(`${e.id}: loop on ${from}`);
      continue;
    }
    const rel: RelationInput = { from, to, tags: [viewId] };
    if (e.lines.length) rel.label = e.lines.join(' ');
    if (e.style !== 'orthogonal') rel.style = e.style;
    if (e.dashed) rel.kind = 'async';
    const heads = headsOf(e);
    if (heads) rel.heads = heads;
    relations.push(rel);
    unmapped.push(...e.unmapped);
    const key = `${from}>${to}`;
    const bends = e.points.length > 2;
    if ((bends || e.style !== 'orthogonal') && e.points.length >= 2 && !(key in pinnedEdges)) {
      const fr = rects.get(fromShape!)!, tr = rects.get(toShape!)!;
      // Ends the reader invented are recomputed against the kept boxes so the pin matches them exactly.
      const pts = [...e.points];
      if (e.syntheticEnds || e.source !== fromShape) pts[0] = borderPoint(fr, pts[1] ?? center(tr));
      if (e.syntheticEnds || e.target !== toShape) pts[pts.length - 1] = borderPoint(tr, pts[pts.length - 2] ?? center(fr));
      pinnedEdges[key] = pts.map((p) => ({ x: round(p.x), y: round(p.y) }));
    }
  }

  // Pins for every box, and the gestures the picture suggests.
  const pins: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const c of cls.nodes) {
    const caption = iconNodes.get(c.shape.id);
    const r = caption !== undefined ? iconPin(c.shape.rect, caption) : c.shape.rect;
    pins[idOf.get(c.shape.id)!] = { x: round(r.x), y: round(r.y), w: Math.max(1, round(r.w)), h: Math.max(1, round(r.h)) };
  }
  const inferTree = (list: Classified[] | undefined): InferNode[] => ordered(list).map((c) => ({ id: idOf.get(c.shape.id)!, rect: c.shape.rect, children: inferTree(childrenOf.get(c.shape.id)) }));
  const canvas = union(cls.nodes.map((c) => c.shape.rect));
  const inferred = inferArrangements(inferTree(childrenOf.get(undefined)), canvas, relations.map((r) => ({ from: String(r.from), to: String(r.to) })));
  const hints = [...inferred.notes];
  const highlights = cls.highlights.map((h) => {
    const members = h.members.map((m) => idOf.get(m)!);
    hints.push(`highlight around ${members.join(', ')}${h.label ? ` labelled "${h.label}"` : ''}`);
    return { nodes: members, ...(h.label !== undefined ? { label: h.label } : {}) };
  });
  const arrange: Arrangement[] = [...inferred.arrange];
  const view: RelationViewInput = {
    id: viewId,
    title: page.name,
    // Every box on the page by id, so a node another page adds children to shows here only what this page drew.
    include: { tags: [viewId], nodes: cls.nodes.map((c) => idOf.get(c.shape.id)!) },
    ...(cls.legend ? { legend: true } : {}),
    ...(arrange.length ? { arrange } : {}),
    ...(highlights.length ? { highlights } : {}),
    pins: { nodes: pins, ...(Object.keys(pinnedEdges).length ? { edges: pinnedEdges } : {}) },
  };
  return {
    nodes,
    relations,
    view,
    report: {
      name: page.name,
      index,
      shapes: page.shapes.length,
      edges: page.edges.length,
      nodes: cls.nodes.length,
      containers,
      relations: relations.length,
      dropped,
      hints,
      unmappedStyles: [...new Set(unmapped)],
      warnings: [...warnings],
    },
  };
}

/** Top to bottom, then left to right; boxes whose centres share a band read as one row. */
function readingOrder(a: Rect, b: Rect): number {
  const ca = center(a), cb = center(b);
  const band = Math.min(a.h, b.h) / 2;
  return Math.abs(ca.y - cb.y) <= band ? ca.x - cb.x : ca.y - cb.y;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function union(rects: readonly Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 1, h: 1 };
  const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
  const r = Math.max(...rects.map((q) => q.x + q.w)), b = Math.max(...rects.map((q) => q.y + q.h));
  return { x, y, w: r - x, h: b - y };
}


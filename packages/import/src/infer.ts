/**
 * Gesture inference. Given the boxes of a page as a tree with their
 * rectangles, and who talks to whom, name the arrangements an author would
 * have written: a row, a column, a grid, a mirror, a ring. Every hint is
 * conservative and comes with a sentence for the report.
 */
import type { Arrangement } from '@vantage/model';
import type { Point, Rect } from './drawing.ts';
import { center } from './drawing.ts';

export interface InferNode {
  readonly id: string;
  readonly rect: Rect;
  readonly children: readonly InferNode[];
}

export interface InferRelation {
  readonly from: string;
  readonly to: string;
}

export interface Inferred {
  readonly arrange: readonly Arrangement[];
  readonly notes: readonly string[];
}

const MIN_LINE = 3;
const MIN_GRID = 4;
const MIN_RING = 4;
const RING_SHARE = 0.7;
const MIRROR_TOLERANCE = 0.12;

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function tolerance(children: readonly InferNode[], axis: 'w' | 'h'): number {
  return Math.max(8, 0.2 * median(children.map((c) => c.rect[axis])));
}

/** Groups sorted values into clusters split where the gap exceeds the tolerance. */
function clusters(values: readonly number[], tol: number): number {
  const s = [...values].sort((a, b) => a - b);
  let count = s.length ? 1 : 0;
  for (let i = 1; i < s.length; i++) if (s[i]! - s[i - 1]! > tol) count++;
  return count;
}

function overlapsOnAxis(children: readonly InferNode[], axis: 'x' | 'y'): boolean {
  const size = axis === 'x' ? 'w' : 'h';
  const s = [...children].sort((a, b) => a.rect[axis] - b.rect[axis]);
  for (let i = 1; i < s.length; i++) if (s[i]!.rect[axis] < s[i - 1]!.rect[axis] + s[i - 1]!.rect[size] - 1) return true;
  return false;
}

function lineOrGrid(node: InferNode): { hint: Arrangement; note: string } | undefined {
  const kids = node.children;
  if (kids.length < MIN_LINE) return undefined;
  const centers = kids.map((k) => center(k.rect));
  const rows = clusters(centers.map((c) => c.y), tolerance(kids, 'h'));
  const cols = clusters(centers.map((c) => c.x), tolerance(kids, 'w'));
  if (rows === 1 && !overlapsOnAxis(kids, 'x')) return { hint: { node: node.id, as: 'row' }, note: `${node.id}: ${kids.length} children share one centre line, as: row` };
  if (cols === 1 && !overlapsOnAxis(kids, 'y')) return { hint: { node: node.id, as: 'column' }, note: `${node.id}: ${kids.length} children share one centre column, as: column` };
  if (kids.length >= MIN_GRID && rows >= 2 && cols >= 2 && kids.length <= rows * cols && kids.length > (rows - 1) * cols) {
    return { hint: { node: node.id, as: 'grid', columns: cols }, note: `${node.id}: ${kids.length} children sit on ${rows} rows and ${cols} columns, as: grid` };
  }
  return undefined;
}

function relative(child: InferNode, parent: InferNode): Point {
  const c = center(child.rect);
  return { x: (c.x - parent.rect.x) / parent.rect.w, y: (c.y - parent.rect.y) / parent.rect.h };
}

/** Two sibling containers side by side whose children sit at mirrored positions. */
function mirror(node: InferNode): { hint: Arrangement; note: string } | undefined {
  const kids = node.children;
  if (kids.length !== 2) return undefined;
  const [a, b] = kids as [InferNode, InferNode];
  if (a.children.length < 2 || a.children.length !== b.children.length) return undefined;
  const ca = center(a.rect), cb = center(b.rect);
  if (Math.abs(ca.y - cb.y) > tolerance(kids, 'h') || overlapsOnAxis(kids, 'x')) return undefined;
  const left = ca.x < cb.x ? a : b, right = left === a ? b : a;
  const used = new Set<string>();
  for (const la of left.children) {
    const ra = relative(la, left);
    const match = right.children.find((rb) => {
      if (used.has(rb.id)) return false;
      const rr = relative(rb, right);
      return Math.abs(ra.y - rr.y) <= MIRROR_TOLERANCE && Math.abs(ra.x - (1 - rr.x)) <= MIRROR_TOLERANCE;
    });
    if (!match) return undefined;
    used.add(match.id);
  }
  return { hint: { node: node.id, as: 'mirror', order: [left.id, right.id] }, note: `${node.id}: ${left.id} and ${right.id} hold mirrored children, as: mirror` };
}

/** One child connected to most of the others and sitting among them. */
function ring(node: InferNode, relations: readonly InferRelation[]): { hint: Arrangement; note: string } | undefined {
  const kids = node.children;
  if (kids.length < MIN_RING) return undefined;
  const ids = new Set(kids.map((k) => k.id));
  const degree = new Map<string, Set<string>>();
  for (const r of relations) {
    if (!ids.has(r.from) || !ids.has(r.to) || r.from === r.to) continue;
    degree.set(r.from, (degree.get(r.from) ?? new Set()).add(r.to));
    degree.set(r.to, (degree.get(r.to) ?? new Set()).add(r.from));
  }
  const needed = Math.ceil(RING_SHARE * (kids.length - 1));
  const hubs = kids.filter((k) => (degree.get(k.id)?.size ?? 0) >= needed);
  if (hubs.length !== 1) return undefined;
  const hub = hubs[0]!;
  const others = kids.filter((k) => k !== hub).map((k) => center(k.rect));
  const centroid = { x: others.reduce((s, p) => s + p.x, 0) / others.length, y: others.reduce((s, p) => s + p.y, 0) / others.length };
  const spread = Math.max(...others.map((p) => Math.hypot(p.x - centroid.x, p.y - centroid.y)));
  const hc = center(hub.rect);
  if (Math.hypot(hc.x - centroid.x, hc.y - centroid.y) > 0.35 * spread) return undefined;
  return { hint: { node: node.id, as: 'ring', center: hub.id }, note: `${node.id}: ${hub.id} talks to ${degree.get(hub.id)!.size} of ${kids.length - 1} siblings and sits among them, as: ring with center ${hub.id}` };
}

export function inferArrangements(roots: readonly InferNode[], canvas: Rect, relations: readonly InferRelation[]): Inferred {
  const arrange: Arrangement[] = [];
  const notes: string[] = [];
  const visit = (node: InferNode): void => {
    if (node.children.length) {
      const found = ring(node, relations) ?? mirror(node) ?? lineOrGrid(node);
      if (found) {
        arrange.push(found.hint);
        notes.push(found.note);
      }
    }
    for (const c of node.children) visit(c);
  };
  visit({ id: 'root', rect: canvas, children: roots });
  return { arrange, notes };
}

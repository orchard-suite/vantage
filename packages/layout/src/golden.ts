/** Golden layout signatures: what the test compares and what the refresh script writes. */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Layout } from './types.ts';

export const GOLDEN_SETS = ['shop/shop.vantage.yaml', 'harbor/harbor.vantage.yaml', 'requests/requests.vantage.yaml'] as const;

export function goldenPath(root: string, set: string): string {
  return join(root, 'packages', 'layout', 'goldens', `${set.split('/')[0]}.json`);
}

/** A short hash of every box rect and edge polyline, rounded to the pixel. */
export function signature(l: Layout): string {
  const r = (n: number): number => Math.round(n);
  const boxes = l.boxes.map((b) => `${b.id}:${r(b.x)},${r(b.y)},${r(b.w)},${r(b.h)}`).sort();
  const edges = l.edges.map((e) => `${e.id}:${e.points.map((p) => `${r(p.x)},${r(p.y)}`).join(';')}`).sort();
  return createHash('sha256').update(`${l.width}x${l.height}|${boxes.join('|')}|${edges.join('|')}`).digest('hex').slice(0, 16);
}

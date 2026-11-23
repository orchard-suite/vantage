/**
 * Taste as search. Lays one relation view out several ways (direction,
 * gesture of the biggest container, a collapse) and scores each, so an
 * agent can look at the candidates side by side and choose instead of
 * guessing. Every candidate is expressed as the `arrange` and `collapse`
 * hints an author would paste into the view.
 */
import type { Arrangement, Model, ResolvedRelationView } from '@vantage/model';
import { layoutRelationView } from './relation.ts';
import { computeVisible } from './visible.ts';
import { DEFAULT_STYLE, type LayoutStyle } from './style.ts';
import type { Layout } from './types.ts';

export interface Candidate {
  readonly name: string;
  /** What to write in the view to get this picture. */
  readonly hints: { arrange?: Arrangement[]; collapse?: string[]; direction?: 'right' | 'down' };
  readonly layout: Layout;
  readonly score: number;
}

function withHints(view: ResolvedRelationView, c: Candidate['hints']): ResolvedRelationView {
  const own = new Map(view.arrange.map((a) => [a.node, a]));
  for (const a of c.arrange ?? []) own.set(a.node, { ...(own.get(a.node) ?? { node: a.node }), ...a });
  return { ...view, arrange: [...own.values()], collapse: [...new Set([...view.collapse, ...(c.collapse ?? [])])], direction: c.direction ?? view.direction };
}

export function exploreLayouts(model: Model, view: ResolvedRelationView, limit = 4, style: LayoutStyle = DEFAULT_STYLE): Candidate[] {
  const visible = computeVisible(model, view);
  const containers = [...visible.nodes.values()].filter((n) => n.kind === 'container').sort((a, b) => b.children.length - a.children.length);
  const biggest = containers[0];
  const roots = visible.roots;
  const proposals: { name: string; hints: Candidate['hints'] }[] = [
    { name: 'as written', hints: {} },
    { name: `flow ${view.direction === 'right' ? 'down' : 'right'}`, hints: { direction: view.direction === 'right' ? 'down' : 'right' } },
  ];
  if (biggest) {
    const other = view.direction === 'right' ? 'down' : 'right';
    proposals.push({ name: `${model.nodes.get(biggest.id)?.name ?? biggest.id} flows ${other}`, hints: { arrange: [{ node: biggest.id, direction: other }] } });
    if (biggest.children.length >= 4) proposals.push({ name: `${model.nodes.get(biggest.id)?.name ?? biggest.id} as grid`, hints: { arrange: [{ node: biggest.id, as: 'grid' }] } });
    if (biggest.children.length === 2) proposals.push({ name: `${model.nodes.get(biggest.id)?.name ?? biggest.id} mirrored`, hints: { arrange: [{ node: biggest.id, as: 'mirror', divider: true }] } });
    if (hasHub(biggest.children, visible)) proposals.push({ name: `${model.nodes.get(biggest.id)?.name ?? biggest.id} as ring`, hints: { arrange: [{ node: biggest.id, as: 'ring' }] } });
    const alone = roots.length === 1 && roots[0] === biggest.id;
    if (containers.length > 1 && biggest.children.length >= 3 && !alone) proposals.push({ name: `collapse ${model.nodes.get(biggest.id)?.name ?? biggest.id}`, hints: { collapse: [biggest.id] } });
  }
  if (roots.length === 2) proposals.push({ name: 'roots mirrored', hints: { arrange: [{ node: 'root', as: 'mirror', divider: true }] } });
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const p of proposals) {
    const layout = layoutRelationView(model, withHints(view, p.hints), style);
    const key = `${layout.width}x${layout.height}:${layout.metrics.score}:${layout.boxes.map((b) => `${b.id}@${b.x},${b.y}`).join('|')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: p.name, hints: p.hints, layout, score: layout.metrics.score });
  }
  return out.sort((a, b) => b.score - a.score || a.layout.width * a.layout.height - b.layout.width * b.layout.height).slice(0, limit);
}

/** A ring reads well when one child talks to most of the others and the others barely talk among themselves. */
function hasHub(children: readonly string[], visible: ReturnType<typeof computeVisible>): boolean {
  if (children.length < 4) return false;
  const set = new Set(children);
  const degree = new Map(children.map((c) => [c, 0]));
  let internal = 0;
  for (const h of visible.hops) {
    if (!set.has(h.from) || !set.has(h.to)) continue;
    internal++;
    degree.set(h.from, degree.get(h.from)! + 1);
    degree.set(h.to, degree.get(h.to)! + 1);
  }
  const top = Math.max(0, ...degree.values());
  return internal >= 3 && top >= internal * 0.6;
}

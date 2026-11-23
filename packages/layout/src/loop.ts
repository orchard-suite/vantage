/**
 * A story that goes round comes back where it started. When a view's first
 * path closes on itself through four or more top-level boxes and the author
 * gave the canvas no arrangement, the canvas is laid out as that circle:
 * the box the path passes through clearly most often sits in the middle,
 * and the rest go round it in the order the path visits them. A loop drawn as a line reads
 * as a pipeline; drawn round, it reads as the cycle it is.
 */
import { ancestorsOf, type Model, type ResolvedRelationView } from '@vantage/model/resolved';

/** The fewest top-level boxes a path must go round before it is drawn as a loop. */
export const LOOP_MIN = 4;

function topOf(model: Model, id: string): string {
  const up = ancestorsOf(model, id);
  return up.length ? up[up.length - 1]! : id;
}

/**
 * The loop layouts worth trying for a view, or none when it is not a loop:
 * the ring may start at any of its boxes and run either way round, and
 * which reads best depends on where each box's lines must go.
 */
export function loopCandidates(model: Model, view: ResolvedRelationView): ResolvedRelationView[] {
  const loop = autoLoop(model, view);
  if (loop === view) return [];
  const ring = loop.arrange[loop.arrange.length - 1]!;
  const hub = ring.center!;
  const around = ring.order!.slice(1);
  const out: ResolvedRelationView[] = [];
  for (const turn of [around, [...around].reverse()]) {
    for (let k = 0; k < turn.length; k++) {
      const order = [hub, ...turn.slice(k), ...turn.slice(0, k)];
      out.push({ ...view, arrange: [...view.arrange, { ...ring, order }] });
    }
  }
  return out;
}

export function autoLoop(model: Model, view: ResolvedRelationView): ResolvedRelationView {
  if (view.arrange.some((a) => a.node === 'root')) return view;
  const path = view.paths[0];
  if (!path || path.steps.length < LOOP_MIN) return view;
  const first = path.steps[0]!, last = path.steps[path.steps.length - 1]!;
  if (!model.nodes.has(first.from) || !model.nodes.has(last.to)) return view;
  if (topOf(model, first.from) !== topOf(model, last.to)) return view;
  // The top-level boxes in the order the path reaches them, and how often it passes through each.
  const visits = new Map<string, number>();
  const order: string[] = [];
  for (const s of path.steps) {
    for (const id of [s.from, s.to]) {
      if (!model.nodes.has(id)) return view;
      const t = topOf(model, id);
      visits.set(t, (visits.get(t) ?? 0) + 1);
      if (!order.includes(t)) order.push(t);
    }
  }
  if (order.length < LOOP_MIN) return view;
  const ranked = [...visits.entries()].sort((a, b) => b[1] - a[1]);
  // The middle goes to the box that clearly carries the loop; a loop with no such box keeps the author's layout.
  if (ranked.length < 2 || ranked[0]![1] < ranked[1]![1] + 2) return view;
  const hub = ranked[0]![0];
  return { ...view, arrange: [...view.arrange, { node: 'root', as: 'ring', order: [hub, ...order.filter((id) => id !== hub)], center: hub }] };
}

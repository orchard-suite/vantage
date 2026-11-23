/**
 * How a reader reshapes a relation view without changing the document:
 * groups opened or shut where they stand, a detail depth, and a zoom into
 * one container. Each is a new resolved view, laid out as any other.
 */
import { ancestorsOf, descendantsOf, type Model, type ResolvedRelationView } from '@vantage/model/resolved';
import { computeVisible } from './visible.ts';

/** The reader's changes to a relation view; empty lists and no depth mean the view as authored. */
export interface ViewScope {
  readonly detail?: number;
  /** Containers opened where they stand. */
  readonly open: readonly string[];
  /** Containers shut to one box where they stand. */
  readonly shut: readonly string[];
}

const DEPTH_CAP = 6;

/** The view with the reader's depth and their opened and shut groups; everything else stays as authored. */
export function scopedView(view: ResolvedRelationView, scope: ViewScope): ResolvedRelationView {
  const open = new Set(scope.open);
  const shut = new Set(scope.shut);
  return {
    ...view,
    ...(scope.detail !== undefined ? { detail: scope.detail } : {}),
    expand: [...new Set([...view.expand.filter((id) => !shut.has(id)), ...open])],
    collapse: [...new Set([...view.collapse.filter((id) => !open.has(id)), ...shut])],
  };
}

/** The view with `containerId` opened and every other container collapsed to a stub. */
export function openedView(model: Model, view: ResolvedRelationView, containerId: string): ResolvedRelationView {
  const visible = computeVisible(model, view);
  const keep = new Set([containerId, ...ancestorsOf(model, containerId), ...descendantsOf(model, containerId)]);
  const collapse = new Set(view.collapse.filter((c) => !keep.has(c)));
  for (const n of visible.nodes.values()) {
    if (keep.has(n.id)) continue;
    if ((model.nodes.get(n.id)?.childIds.length ?? 0) > 0) collapse.add(n.id);
  }
  return {
    ...view,
    expand: [...new Set([...view.expand, containerId])],
    collapse: [...collapse],
  };
}

/** Zoomed into one container: opened alone at the reader's depth, keeping what the reader opened or shut inside it. */
export function zoomedView(model: Model, view: ResolvedRelationView, scope: ViewScope, containerId: string): ResolvedRelationView {
  const opened = openedView(model, scopedView(view, { ...scope, open: [], shut: [] }), containerId);
  const inside = new Set(descendantsOf(model, containerId));
  return scopedView(opened, { open: scope.open.filter((id) => inside.has(id)), shut: scope.shut.filter((id) => inside.has(id)) });
}

/** The detail depths that change which boxes the view draws, in order, the authored depth among them. */
export function depthStops(model: Model, view: ResolvedRelationView): number[] {
  const authored = view.detail ?? 0;
  const signature = (detail: number): string => [...computeVisible(model, { ...view, detail }).nodes.keys()].sort().join('|');
  const out = new Set([authored]);
  let prev: string | undefined;
  for (let d = 0; d <= DEPTH_CAP; d++) {
    const sig = signature(d);
    if (prev !== undefined && sig === prev) break;
    prev = sig;
    out.add(d);
  }
  // A depth that only repeats the authored picture is noise.
  const base = signature(authored);
  return [...out].filter((d) => d === authored || signature(d) !== base).sort((a, b) => a - b);
}

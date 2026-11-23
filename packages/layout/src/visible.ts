/**
 * Decides what a relation view shows. The rule is Ilograph's, kept because it
 * is what makes views clean: the participants of the view's relations and
 * their ancestors, nothing else. Collapse, expand, detail, and hide then
 * adjust that set, and every relation is retargeted to its visible endpoints.
 */
import { ancestorsOf, descendantsOf, type Model, type ModelRelation, type ResolvedRelationView } from '@vantage/model/resolved';
import type { BoxKind } from './types.ts';

export interface VisibleNode {
  readonly id: string;
  readonly kind: BoxKind;
  readonly parentId?: string;
  readonly children: string[];
  /** Model children not shown in this view. */
  readonly hiddenChildren: number;
  readonly participant: boolean;
}

/** One drawn hop of a relation; a relation with `via` contributes several. */
export interface Hop {
  readonly id: string;
  readonly relation: ModelRelation;
  readonly from: string;
  readonly to: string;
  readonly hopIndex: number;
  readonly hopCount: number;
}

export interface VisibleSet {
  readonly nodes: Map<string, VisibleNode>;
  readonly roots: string[];
  readonly hops: Hop[];
  /** Relation id to the visible endpoint ids it was retargeted to. */
  readonly retargeted: Map<string, { from: string; to: string }>;
  /** Relations between a container and its own content: implied by containment, not drawn. */
  readonly implied: { from: string; to: string; label?: string }[];
}

export function computeVisible(model: Model, view: ResolvedRelationView): VisibleSet {
  const hidden = new Set<string>();
  for (const h of view.hide) {
    hidden.add(h);
    for (const d of descendantsOf(model, h)) hidden.add(d);
  }
  const collapsed = new Set(view.collapse);
  const retarget = (id: string): string => {
    const chain = [id, ...ancestorsOf(model, id)];
    for (let i = chain.length - 1; i >= 0; i--) if (collapsed.has(chain[i]!)) return chain[i]!;
    return id;
  };

  const participants = new Set<string>();
  const hops: Hop[] = [];
  const retargeted = new Map<string, { from: string; to: string }>();
  const implied: VisibleSet['implied'] = [];
  const contains = (a: string, b: string): boolean => ancestorsOf(model, b).includes(a);
  for (const r of view.relations) {
    const chain = [r.from, ...r.via, r.to];
    if (chain.some((n) => hidden.has(n))) continue;
    const mapped = chain.map(retarget);
    const compact: string[] = [];
    for (const m of mapped) if (compact[compact.length - 1] !== m) compact.push(m);
    if (compact.length < 2) {
      if (r.from === r.to) compact.push(compact[0]!);
      else continue;
    }
    for (const n of compact) participants.add(n);
    retargeted.set(r.id, { from: compact[0]!, to: compact[compact.length - 1]! });
    for (let i = 0; i < compact.length - 1; i++) {
      const from = compact[i]!, to = compact[i + 1]!;
      if (contains(from, to) || contains(to, from)) {
        implied.push({ from, to, ...(r.label !== undefined ? { label: r.label } : {}) });
        continue;
      }
      hops.push({ id: compact.length > 2 ? `${r.id}#${i}` : r.id, relation: r, from, to, hopIndex: i, hopCount: compact.length - 1 });
    }
  }
  for (const n of view.extraNodes) if (!hidden.has(n)) participants.add(retarget(n));
  // An outline is a tree listing: asking for it means asking for the whole subtree.
  const outlines = view.arrange.filter((a) => a.as === 'outline' && a.node !== 'root' && model.nodes.has(a.node)).map((a) => a.node);
  for (const s of [...view.subtree, ...outlines]) {
    if (hidden.has(s)) continue;
    participants.add(retarget(s));
    if (!isUnderCollapsed(s, collapsed, model)) for (const d of descendantsOf(model, s)) if (!hidden.has(d) && !isUnderCollapsed(d, collapsed, model)) participants.add(d);
  }

  const detail = view.detail ?? 0;
  if (detail > 0) {
    for (const p of [...participants]) {
      if (collapsed.has(p)) continue;
      addDescendants(model, p, detail, hidden, collapsed, participants);
    }
  }
  for (const e of view.expand) {
    if (hidden.has(e) || collapsed.has(e)) continue;
    participants.add(e);
    for (const c of model.nodes.get(e)?.childIds ?? []) if (!hidden.has(c)) participants.add(c);
  }

  const visible = new Set<string>();
  for (const p of participants) {
    visible.add(p);
    for (const a of ancestorsOf(model, p)) visible.add(a);
  }

  const nodes = new Map<string, VisibleNode>();
  const roots: string[] = [];
  const build = (id: string, parentId: string | undefined): void => {
    const node = model.nodes.get(id)!;
    const shownChildren = collapsed.has(id) ? [] : node.childIds.filter((c) => visible.has(c));
    const kind: BoxKind = collapsed.has(id) && node.childIds.length ? 'collapsed' : shownChildren.length ? 'container' : 'leaf';
    nodes.set(id, {
      id,
      kind,
      ...(parentId !== undefined ? { parentId } : {}),
      children: shownChildren,
      hiddenChildren: kind === 'collapsed' ? descendantsOf(model, id).length : node.childIds.length - shownChildren.length,
      participant: participants.has(id),
    });
    for (const c of shownChildren) build(c, id);
  };
  for (const r of model.roots) {
    if (visible.has(r)) {
      roots.push(r);
      build(r, undefined);
    }
  }
  return { nodes, roots, hops, retargeted, implied };
}

function isUnderCollapsed(id: string, collapsed: Set<string>, model: Model): boolean {
  return ancestorsOf(model, id).some((a) => collapsed.has(a));
}

function addDescendants(model: Model, id: string, levels: number, hidden: Set<string>, collapsed: Set<string>, out: Set<string>): void {
  if (levels <= 0) return;
  for (const c of model.nodes.get(id)?.childIds ?? []) {
    if (hidden.has(c)) continue;
    out.add(c);
    if (!collapsed.has(c)) addDescendants(model, c, levels - 1, hidden, collapsed, out);
  }
}

/**
 * The child of `container` that contains `id` (or `id` itself when it is a
 * direct child). Undefined when `id` is not inside the container.
 */
export function liftTo(visible: VisibleSet, container: string | undefined, id: string): string | undefined {
  let cur: string | undefined = id;
  while (cur !== undefined) {
    const n = visible.nodes.get(cur);
    if (!n) return undefined;
    if (n.parentId === container) return cur;
    cur = n.parentId;
  }
  return undefined;
}

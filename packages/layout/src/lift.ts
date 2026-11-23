/**
 * Sibling edge lifting. When several children of one container all talk to
 * the same outside box with the same label, a human draws one arrow from
 * the container. So do we: the hops are replaced by one hop from (or to)
 * the container, and the drawn edge remembers its members.
 */
import type { Hop, VisibleSet } from './visible.ts';

export interface LiftedHop extends Hop {
  readonly members: readonly string[];
  /** "3 of 4" when not every child of the lifted container takes part. */
  readonly note?: string;
}

function isAncestor(visible: VisibleSet, ancestor: string, id: string): boolean {
  let cur = visible.nodes.get(id)?.parentId;
  while (cur !== undefined) {
    if (cur === ancestor) return true;
    cur = visible.nodes.get(cur)?.parentId;
  }
  return false;
}

export function liftSiblingHops(hops: readonly Hop[], visible: VisibleSet): LiftedHop[] {
  let current: LiftedHop[] = hops.map((h) => ({ ...h, members: [`${h.from}>${h.to}`] }));
  // Repeat so a lift can cascade one level up when the parent's siblings also agree.
  for (let round = 0; round < 3; round++) {
    const next = liftOnce(current, visible, 'from');
    const after = liftOnce(next, visible, 'to');
    if (after.length === current.length) break;
    current = after;
  }
  return current;
}

function liftOnce(hops: readonly LiftedHop[], visible: VisibleSet, end: 'from' | 'to'): LiftedHop[] {
  const other = end === 'from' ? 'to' : 'from';
  const groups = new Map<string, LiftedHop[]>();
  for (const h of hops) {
    const parent = visible.nodes.get(h[end])?.parentId;
    if (parent === undefined) continue;
    if (isAncestor(visible, parent, h[other]) || parent === h[other]) continue;
    const k = `${parent}|${h[other]}|${h.relation.label ?? ''}|${h.relation.kind}|${end}`;
    groups.set(k, [...(groups.get(k) ?? []), h]);
  }
  const replaced = new Set<LiftedHop>();
  const added: LiftedHop[] = [];
  for (const [k, group] of groups) {
    const parent = k.split('|')[0]!;
    const distinct = new Set(group.map((h) => h[end]));
    const vn = visible.nodes.get(parent)!;
    const children = vn.children;
    // The count is against every child in the model, so the reader is not told "all" when some are hidden.
    const total = children.length + vn.hiddenChildren;
    // Lift when the siblings are a real group: at least half of the container, or three or more.
    if (distinct.size < 2 || (distinct.size * 2 < children.length && distinct.size < 3)) continue;
    for (const h of group) replaced.add(h);
    const first = group[0]!;
    const note = distinct.size < total ? `${distinct.size} of ${total}` : undefined;
    added.push({
      ...first,
      id: `${first.id}~${parent}`,
      [end]: parent,
      members: group.flatMap((h) => h.members),
      ...(note !== undefined ? { note } : {}),
    });
  }
  return [...hops.filter((h) => !replaced.has(h)), ...added];
}

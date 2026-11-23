/**
 * Policy coverage for an `observe` block: which policies apply to each of
 * the innermost boxes, by the directions they govern. A member with no
 * policy for the guarded direction is red; a container holding such members
 * is amber, or red when none are covered. The view's text lists the gaps per
 * direction. Built from the policies' own relations, so it shows intent, not
 * traffic.
 */
import type { Annotation, Observe } from '@vantage/model';
import type { ObservedModel } from './observed.ts';

/** How many names a gap line lists before it says how many more. */
const LIST_MAX = 12;
/** How many policy names a member's subtitle shows. */
const NAMES_MAX = 3;

export interface BoundaryBox {
  readonly key: string;
  readonly name: string;
  readonly members: readonly { readonly key: string; readonly name: string }[];
}

export interface Boundary {
  /** Color and subtitle per entity key, for members and their containers. */
  readonly marks: ReadonlyMap<string, { readonly color?: string; readonly subtitle: string }>;
  readonly notes: readonly Annotation[];
}

function names(list: readonly string[], max: number): string {
  const shown = list.slice(0, max).join(', ');
  return list.length > max ? `${shown}, and ${list.length - max} more` : shown;
}

/** `containers` are the boxes that hold members; a member outside any container stands alone. */
export function boundaryOf(o: Observe, containers: readonly BoundaryBox[], loose: readonly { key: string; name: string }[], model: ObservedModel): Boundary {
  const b = o.boundary!;
  const applies = new Map<string, { name: string; dirs: string[] }[]>();
  for (const r of Object.values(model.relations)) {
    if (r.source !== o.source || r.label !== b.relation || r.missingSince !== undefined) continue;
    const policy = model.entities[`${o.source}:${r.from}`];
    if (!policy || policy.type !== b.policy || policy.missingSince !== undefined) continue;
    const v = policy.facts[b.fact];
    const dirs = Array.isArray(v) ? v.map(String) : v === undefined ? [] : [String(v)];
    const to = `${o.source}:${r.to}`;
    applies.set(to, [...(applies.get(to) ?? []), { name: policy.name, dirs }]);
  }
  const all = [...containers.flatMap((c) => c.members), ...loose];
  const directions = [...new Set([b.guard, ...[...applies.values()].flat().flatMap((p) => p.dirs)])];
  const covered = (key: string, dir: string): boolean => (applies.get(key) ?? []).some((p) => p.dirs.includes(dir));
  const marks = new Map<string, { color?: string; subtitle: string }>();
  for (const m of all) {
    const ps = applies.get(m.key) ?? [];
    const subtitle = covered(m.key, b.guard) ? names(ps.map((p) => p.name).sort(), NAMES_MAX) : `no ${b.guard} policy`;
    marks.set(m.key, { ...(covered(m.key, b.guard) ? {} : { color: 'red' }), subtitle });
  }
  for (const c of containers) {
    const open = c.members.filter((m) => !covered(m.key, b.guard)).length;
    const color = open === 0 ? undefined : open === c.members.length ? 'red' : 'amber';
    marks.set(c.key, { ...(color ? { color } : {}), subtitle: open ? `${open} of ${c.members.length} with no ${b.guard} policy` : `${c.members.length} covered` });
  }
  const notes: Annotation[] = directions.map((dir) => {
    const gaps = all.filter((m) => !covered(m.key, dir)).map((m) => m.name).sort();
    return { text: gaps.length ? `${gaps.length} of ${all.length} have no ${dir} policy: ${names(gaps, LIST_MAX)}.` : `All ${all.length} have a ${dir} policy.` };
  });
  return { marks, notes };
}

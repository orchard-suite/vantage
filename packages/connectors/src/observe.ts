/**
 * Fills `observe` nodes from the observed layer. Each drawn entity becomes a
 * node bound to it, so the overlay gives it facts, freshness, and drift like
 * any bound node. Entities nest by their observed parent, or for a type the
 * block names in `nest`, by the target of a relation, so one source draws
 * several trees; ancestors of types that are not drawn are skipped. The block can add a placement view, and one
 * view per failure domain that tints what its loss takes down and says what
 * it costs a voting group and data kept in copies, and a boundaries view
 * that colors what no policy guards. The relations it names are drawn as
 * arrows between the boxes, in a color of their own where it asks.
 */
import { RelationSchema, RelationViewSchema, type Annotation, type Document, type NodeOutput, type Observe, type Relation, type View } from '@vantage/model';
import { boundaryOf, type Boundary } from './observe-boundary.ts';
import type { ObservedEntity, ObservedModel, ObservedRelation } from './observed.ts';

/** How many names a narrative line lists before it says how many more. */
const LIST_MAX = 12;

interface Drawn {
  /** The entity the box is drawn as and bound to. */
  readonly entity: ObservedEntity;
  /** Entities folded into this box: a VM and the node it runs are one box. */
  readonly also: readonly ObservedEntity[];
  readonly id: string;
  readonly children: Drawn[];
}

function nodeId(base: string, e: ObservedEntity): string {
  return `${base}.${e.id.replace(/[^A-Za-z0-9_.-]/g, '.')}`;
}

function word(o: Observe, type: string): string {
  return o.names?.[type] ?? type.replace(/_/g, ' ');
}

function plural(o: Observe, type: string, n: number): string {
  const w = word(o, type);
  return `${n} ${n === 1 ? w : `${w}s`}`;
}

/** Counts of what is inside, in the order the block lists the types, without the box's own type. */
function countsOf(o: Observe, d: Drawn): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (x: Drawn): void => {
    for (const c of x.children) {
      for (const t of typesOf(c)) out.set(t, (out.get(t) ?? 0) + 1);
      walk(c);
    }
  };
  walk(d);
  return new Map(o.types.filter((t) => out.has(t)).map((t) => [t, out.get(t)!]));
}

function countText(o: Observe, counts: Map<string, number>): string {
  return [...counts].map(([t, n]) => plural(o, t, n)).join(', ');
}

function colorOf(o: Observe, e: ObservedEntity): string | undefined {
  if (!o.health) return undefined;
  const v = e.facts[o.health];
  return v === 'red' || v === 'amber' ? v : undefined;
}

interface Arrow {
  /** Keys of the entities the arrow starts and ends at. */
  readonly from: string;
  readonly to: string;
  readonly label: string;
  readonly kind?: string;
  readonly color?: string;
  readonly description?: string;
  readonly only: boolean;
}

/** The name a block uses for an observed relation: its label, or one of its tags (a source tags an arrow by the kind of record it came from). */
function namedBy(r: ObservedRelation): string[] {
  return r.label === undefined ? [...r.tags] : [r.label, ...r.tags];
}

/** Every observed relation the block names, by label or tag, with the color and `only` its entry asks for. */
function arrowsOf(o: Observe, model: ObservedModel): Arrow[] {
  const asked = new Map<string, { color?: string | undefined; only?: boolean | undefined }>((o.relations ?? []).map((r) => (typeof r === 'string' ? [r, {}] : [r.label, r])));
  const out: Arrow[] = [];
  for (const r of Object.values(model.relations)) {
    if (r.source !== o.source) continue;
    const rule = namedBy(r).map((n) => asked.get(n)).find((x) => x !== undefined);
    if (!rule) continue;
    out.push({
      from: `${o.source}:${r.from}`,
      to: `${o.source}:${r.to}`,
      label: r.label ?? '',
      ...(r.kind ? { kind: r.kind } : {}),
      ...(rule.color ? { color: rule.color } : {}),
      ...(r.description ? { description: r.description } : {}),
      only: rule.only === true,
    });
  }
  return out;
}

/**
 * Each entity's way up: for a type named in `nest`, the target of that
 * relation (the first by key, so a refresh keeps it); for the rest, its
 * observed parent. An entity of a nested type with no such relation stands
 * at the top.
 */
function upOf(o: Observe, model: ObservedModel): (key: string) => string | undefined {
  const nest = o.nest ?? {};
  const via = new Map<string, string>();
  if (Object.keys(nest).length) {
    for (const r of Object.values(model.relations).sort((a, b) => a.key.localeCompare(b.key))) {
      if (r.source !== o.source || r.missingSince !== undefined) continue;
      const from = `${o.source}:${r.from}`;
      const type = model.entities[from]?.type;
      const want = type === undefined ? undefined : nest[type];
      if (want === undefined || via.has(from) || !namedBy(r).includes(want)) continue;
      via.set(from, `${o.source}:${r.to}`);
    }
  }
  return (key) => {
    const e = model.entities[key];
    if (!e) return undefined;
    if (nest[e.type] !== undefined) return via.get(key);
    return e.parent === undefined ? undefined : `${o.source}:${e.parent}`;
  };
}

/** Whether an entity carries every fact `where` names, with one of the values it lists; text compares case-insensitively. */
export function matchesWhere(where: NonNullable<Observe['where']>, e: ObservedEntity): boolean {
  return Object.entries(where).every(([fact, want]) => {
    const have = e.facts[fact];
    if (have === undefined || have === null || typeof have === 'object') return false;
    const value = String(have).toLowerCase();
    return (Array.isArray(want) ? want : [want]).some((w) => w.toLowerCase() === value);
  });
}

/** The drawn tree under one observe block, sorted by name so a refresh keeps the order. */
function drawTree(o: Observe, base: string, model: ObservedModel): Drawn[] {
  const drawn = new Map<string, ObservedEntity>();
  for (const e of Object.values(model.entities)) if (e.source === o.source && o.types.includes(e.type)) drawn.set(e.key, e);
  const up = upOf(o, model);
  const parentOf = (e: ObservedEntity): string | undefined => {
    let key = up(e.key);
    const seen = new Set<string>([e.key]);
    while (key !== undefined) {
      if (seen.has(key)) return undefined;
      seen.add(key);
      if (drawn.has(key)) return key;
      key = up(key);
    }
    return undefined;
  };
  // With `where`, keep the boxes whose facts match and what holds them.
  if (o.where) {
    const keep = new Set<string>();
    for (const [key, e] of drawn) {
      if (!matchesWhere(o.where, e)) continue;
      for (let k: string | undefined = key; k && drawn.has(k) && !keep.has(k); k = parentOf(drawn.get(k)!)) keep.add(k);
    }
    for (const key of [...drawn.keys()]) if (!keep.has(key)) drawn.delete(key);
  }
  // With a relation marked `only`, keep what its arrows touch and what holds it.
  const only = arrowsOf(o, model).filter((a) => a.only);
  if (only.length) {
    const keep = new Set<string>();
    for (const a of only) {
      if (!drawn.has(a.from) || !drawn.has(a.to) || a.from === a.to) continue;
      for (const end of [a.from, a.to]) for (let k: string | undefined = end; k && drawn.has(k) && !keep.has(k); k = parentOf(drawn.get(k)!)) keep.add(k);
    }
    for (const key of [...drawn.keys()]) if (!keep.has(key)) drawn.delete(key);
  }
  // Drop pruned types that hold nothing, until nothing changes: removing one can empty its parent.
  const prune = new Set(o.prune ?? []);
  for (;;) {
    const held = new Set<string>();
    for (const e of drawn.values()) {
      const p = parentOf(e);
      if (p) held.add(p);
    }
    const empty = [...drawn.values()].filter((e) => prune.has(e.type) && !held.has(e.key));
    if (!empty.length) break;
    for (const e of empty) drawn.delete(e.key);
  }
  const kids = new Map<string | undefined, ObservedEntity[]>();
  for (const e of drawn.values()) {
    const p = parentOf(e);
    kids.set(p, [...(kids.get(p) ?? []), e]);
  }
  const build = (parent: string | undefined): Drawn[] =>
    (kids.get(parent) ?? [])
      .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
      .map((e) => ({ entity: e, also: [], id: nodeId(base, e), children: build(e.key) }));
  return build(undefined).map(fold);
}

/** A box whose only child carries its name is one thing seen twice (a VM and the node it runs); it is drawn once, as the inner one, and keeps the outer one in `also`. */
function fold(d: Drawn): Drawn {
  const children = d.children.map(fold);
  const only = children.length === 1 ? children[0]! : undefined;
  if (only && only.entity.name === d.entity.name) return { ...only, id: d.id, also: [d.entity, ...d.also, ...only.also] };
  return { ...d, children };
}

function typesOf(d: Drawn): string[] {
  return [d.entity.type, ...d.also.map((e) => e.type)];
}

/** `marks` (policy coverage) win over the health color and the counts. */
function toNode(o: Observe, d: Drawn, marks?: Boundary['marks']): NodeOutput {
  const mark = marks?.get(d.entity.key);
  const color = mark ? mark.color : colorOf(o, d.entity);
  const subtitle = mark?.subtitle ?? countText(o, countsOf(o, d));
  return {
    id: d.id,
    name: d.entity.name,
    bind: d.entity.key,
    ...(subtitle ? { subtitle } : {}),
    ...(color ? { color } : {}),
    ...(d.children.length ? { children: d.children.map((c) => toNode(o, c, marks)) } : {}),
  };
}

/** Coverage of the innermost boxes by the block's policies. */
function boundaryFor(o: Observe, tree: readonly Drawn[], model: ObservedModel): Boundary {
  const inner = o.types[o.types.length - 1]!;
  const isMember = (d: Drawn): boolean => typesOf(d).includes(inner);
  const member = (d: Drawn) => ({ key: d.entity.key, name: d.entity.name });
  const containers = flatten(tree)
    .filter((d) => !isMember(d) && d.children.some(isMember))
    .map((d) => ({ key: d.entity.key, name: d.entity.name, members: d.children.filter(isMember).map(member) }));
  return boundaryOf(o, containers, tree.filter(isMember).map(member), model);
}

function flatten(ds: readonly Drawn[]): Drawn[] {
  return ds.flatMap((d) => [d, ...flatten(d.children)]);
}

function listed(names: readonly string[]): string {
  const shown = names.slice(0, LIST_MAX).join(', ');
  return names.length > LIST_MAX ? `${shown}, and ${names.length - LIST_MAX} more` : shown;
}

/** What losing one domain costs, as notes and paragraphs. */
function failureNotes(o: Observe, domain: Drawn, model: ObservedModel): Annotation[] {
  const f = o.failure!;
  const lost = new Set(flatten([domain]).flatMap((d) => [d.entity.key, ...d.also.map((e) => e.key)]));
  const out: Annotation[] = [];
  // What the box itself folded in falls with it too: a server and the node it runs.
  const counts = countsOf(o, domain);
  const own = typesOf(domain);
  const domainType = own.find((t) => f.domains.includes(t));
  for (const t of own.filter((t) => t !== domainType)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const took = countText(o, new Map(o.types.filter((t) => counts.has(t)).map((t) => [t, counts.get(t)!])));
  out.push({ text: took ? `Takes down ${took}.` : 'Holds nothing else drawn here.', at: domain.id, kind: 'note' });
  // A member under a lost box is lost too, even when its own type is not drawn.
  const isLost = (key: string): boolean => {
    let k: string | undefined = key;
    const seen = new Set<string>();
    while (k !== undefined && !seen.has(k)) {
      if (lost.has(k)) return true;
      seen.add(k);
      const p: string | undefined = model.entities[k]?.parent;
      k = p !== undefined ? `${o.source}:${p}` : undefined;
    }
    return false;
  };
  if (f.quorum) {
    const q = f.quorum;
    const members = Object.values(model.entities).filter((e) => {
      if (e.source !== o.source || e.type !== q.type || e.missingSince !== undefined) return false;
      const v = e.facts[q.fact];
      return Array.isArray(v) ? v.map(String).includes(q.contains) : String(v) === q.contains;
    });
    const gone = members.filter((m) => isLost(m.key));
    const left = members.length - gone.length;
    const name = q.name ?? 'quorum';
    if (members.length) {
      out.push({
        text: left * 2 > members.length
          ? gone.length
            ? `${name} keeps ${left} of ${members.length} members, losing ${listed(gone.map((g) => g.name))}: it still has a majority.`
            : `${name} keeps all ${members.length} members.`
          : `${name} drops to ${left} of ${members.length} members: it loses its majority and stops.`,
      });
    }
  }
  if (f.copies) {
    const c = f.copies;
    const holders = new Map<string, string[]>();
    for (const r of Object.values(model.relations)) {
      if (r.source !== o.source || r.label !== c.relation || r.missingSince !== undefined) continue;
      const from = `${o.source}:${r.from}`;
      if (model.entities[from]?.type !== c.type) continue;
      holders.set(from, [...(holders.get(from) ?? []), `${o.source}:${r.to}`]);
    }
    const none: string[] = [];
    const one: string[] = [];
    for (const [key, hs] of holders) {
      const left = hs.filter((h) => !isLost(h)).length;
      const name = model.entities[key]?.name ?? key;
      if (left === 0) none.push(name);
      else if (left === 1 && hs.length > 1) one.push(name);
    }
    const what = word(o, c.type);
    out.push({ text: none.length ? `${plural(o, c.type, none.length)} ${none.length === 1 ? 'loses' : 'lose'} every copy: ${listed(none.sort())}.` : `No ${what} loses every copy.` });
    if (one.length) out.push({ text: `${plural(o, c.type, one.length)} ${one.length === 1 ? 'keeps' : 'keep'} one copy: ${listed(one.sort())}.` });
  }
  return out;
}

/** Fills every `observe` node in the document from the observed model and adds the views each asks for. Everything else passes through. */
export function expandObserved(doc: Document, model: ObservedModel): Document {
  const views: View[] = [];
  const relations: Relation[] = [];
  const fill = (n: NodeOutput, path: string): NodeOutput => {
    const children = n.children?.map((c, i) => fill(c, `${path}.${c.id ?? i}`));
    const base = n.id ?? path;
    if (!n.observe) return children ? { ...n, children } : n;
    const o = n.observe;
    const tree = drawTree(o, base, model);
    const all = flatten(tree);
    const closed = new Set(o.closed ?? o.types.slice(-2, -1));
    const collapse = all.filter((d) => typesOf(d).some((t) => closed.has(t)) && d.children.length).map((d) => d.id);
    const ids = new Map(all.flatMap((d) => [d.entity, ...d.also].map((e) => [e.key, d.id] as const)));
    // The block's own arrows carry its tag, so the views it adds draw them.
    const tag = `observed.${base}`;
    for (const a of arrowsOf(o, model)) {
      const from = ids.get(a.from);
      const to = ids.get(a.to);
      if (from && to && from !== to)
        relations.push(
          RelationSchema.parse({ from, to, ...(a.label ? { label: a.label } : {}), tags: [tag], ...(a.kind ? { kind: a.kind } : {}), ...(a.color ? { color: a.color } : {}), ...(a.description ? { description: a.description } : {}) }),
        );
    }
    const group = o.group;
    const view = (id: string, title: string, extra: Record<string, unknown>): View =>
      RelationViewSchema.parse({ id, title, ...(group ? { group } : {}), include: { subtree: [base], tags: [tag] }, ...(collapse.length ? { collapse } : {}), ...extra });
    if (o.view) views.push(view(`${base}-placement`, o.view.title ?? `${n.name}: placement`, {}));
    const boundary = o.boundary ? boundaryFor(o, tree, model) : undefined;
    if (o.boundary && boundary) views.push(view(`${base}-boundaries`, o.boundary.title ?? `${n.name}: boundaries`, { annotations: boundary.notes }));
    if (o.failure) {
      for (const d of all.filter((x) => typesOf(x).some((t) => o.failure!.domains.includes(t)))) {
        views.push(
          view(`${base}-if-${d.id.slice(base.length + 1)}`, `If ${d.entity.name} goes down`, {
            ...(group ? { group: `${group} / Failure domains` } : { group: 'Failure domains' }),
            highlights: [{ nodes: [d.id], style: 'tint', color: 'red', label: 'goes down' }],
            annotations: failureNotes(o, d, model),
          }),
        );
      }
    }
    return { ...n, children: [...(children ?? []), ...tree.map((d) => toNode(o, d, boundary?.marks))] };
  };
  const nodes = doc.nodes.map((n, i) => fill(n, String(n.id ?? `observed-${i}`)));
  return { ...doc, nodes, ...(relations.length ? { relations: [...(doc.relations ?? []), ...relations] } : {}), views: [...doc.views, ...views] };
}

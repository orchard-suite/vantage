/**
 * Where the observed layer meets the declared one. `overlayObserved` fills
 * bound nodes from the observed model, and gives them what is open against
 * them, without touching anything the author wrote; `freshness` grades each observed entity; `drift` lists where the
 * two layers disagree, as plain data a layout can draw.
 */
import { typeForSource, type Document, type Fact, type NodeOutput, type Provenance } from '@vantage/model';
import type { ObservedEntity, ObservedModel } from './observed.ts';
import { factCarries, itemsFor, nodeOpenItem, type ItemFreshness, type ObservedItem } from './open-items.ts';
import { stringify } from './template.ts';

export type Freshness = 'fresh' | 'stale' | 'missing';

/** The facts a bound box shows, each with the fact it shows: the source's labelled, formatted list when it sent one, else every fact by its key. */
function observedFacts(e: ObservedEntity): (Fact & { readonly fact: string })[] {
  if (e.display) return e.display.filter((d) => d.value !== '');
  return Object.entries(e.facts)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([fact, value]) => ({ fact, label: fact, value: stringify(value) }));
}

/** What the source says for a fact a document declares: by its key, or by the label the source shows it under. */
function observedValue(e: ObservedEntity, label: string): string | undefined {
  const raw = e.facts[label];
  if (raw !== undefined && raw !== null) return stringify(raw);
  return e.display?.find((d) => d.label === label)?.value;
}

function overlayNode(node: NodeOutput, model: ObservedModel, profiles: readonly string[], fresh: ItemFreshness | undefined): NodeOutput {
  const children = node.children?.map((c) => overlayNode(c, model, profiles, fresh));
  const withChildren: NodeOutput = children ? { ...node, children } : node;
  if (node.bind === undefined) return withChildren;
  const entity = model.entities[node.bind];
  const open = itemsFor(model.items, node.bind, entity?.facts).map((i) => nodeOpenItem(i, fresh));
  const withOpen: NodeOutput = open.length ? { ...withChildren, openItems: open } : withChildren;
  if (!entity) return withOpen;
  const own = new Set((node.facts ?? []).map((f) => f.label));
  // An author fact wins over the observed one it names, by key or by the label the source shows.
  const added = observedFacts(entity)
    .filter((f) => !own.has(f.label) && !own.has(f.fact))
    .map(({ label, value }) => ({ label, value }));
  const facts = [...(node.facts ?? []), ...added];
  const provenance: Provenance = { ...entity.provenance };
  // An untyped bound node draws the icon of what it is bound to.
  const icon = node.type === undefined && node.icon === undefined && node.image === undefined ? typeForSource(entity.type, profiles)?.icon : undefined;
  return {
    ...withOpen,
    ...(icon !== undefined ? { icon } : {}),
    ...(facts.length ? { facts } : {}),
    ...(node.subtitle === undefined && entity.subtitle !== undefined ? { subtitle: entity.subtitle } : {}),
    ...(node.url === undefined && entity.url !== undefined ? { url: entity.url } : {}),
    ...(node.description === undefined && entity.description !== undefined ? { description: entity.description } : {}),
    provenance,
  };
}

/**
 * Fills facts, subtitle, url, description (each only when missing), the
 * icon of an untyped node, provenance, and open items on bound nodes.
 * Unbound nodes and everything else pass through untouched. With
 * `fresh`, an open item last reported past the threshold is marked stale.
 */
export function overlayObserved(doc: Document, model: ObservedModel, fresh?: ItemFreshness): Document {
  return { ...doc, nodes: doc.nodes.map((n) => overlayNode(n, model, doc.profiles ?? [], fresh)) };
}

export function freshnessOf(entity: ObservedEntity, now: Date, thresholdDays: number): Freshness {
  if (entity.missingSince !== undefined) return 'missing';
  const age = now.getTime() - Date.parse(entity.observed);
  return age > thresholdDays * 86_400_000 ? 'stale' : 'fresh';
}

/** Per observed entity key. */
export function freshness(model: ObservedModel, now: Date, thresholdDays: number): Record<string, Freshness> {
  const out: Record<string, Freshness> = {};
  for (const [key, e] of Object.entries(model.entities)) out[key] = freshnessOf(e, now, thresholdDays);
  return out;
}

export interface DriftUnobserved {
  readonly kind: 'declared-not-observed';
  readonly nodeId: string;
  readonly bind: string;
  /** Present when the entity exists but a full batch stopped reporting it. */
  readonly missingSince?: string;
}

export interface DriftUndeclared {
  readonly kind: 'observed-not-declared';
  /** The declared container whose bound entity holds the undeclared one. */
  readonly containerId: string;
  readonly containerBind: string;
  readonly key: string;
  readonly name: string;
  readonly type: string;
}

export interface DriftFact {
  readonly kind: 'fact-mismatch';
  readonly nodeId: string;
  readonly bind: string;
  readonly label: string;
  readonly declared: string;
  readonly observed: string;
}

export type DriftItem = DriftUnobserved | DriftUndeclared | DriftFact;

export interface Drift {
  readonly items: readonly DriftItem[];
  readonly counts: { readonly declaredNotObserved: number; readonly observedNotDeclared: number; readonly factMismatch: number };
}

interface BoundNode {
  readonly id: string;
  readonly node: NodeOutput;
  readonly isContainer: boolean;
}

function slugOf(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function collectBound(nodes: readonly NodeOutput[], out: BoundNode[]): void {
  for (const n of nodes) {
    if (n.bind !== undefined) out.push({ id: n.id ?? slugOf(n.name), node: n, isContainer: (n.children?.length ?? 0) > 0 });
    if (n.children) collectBound(n.children, out);
  }
}

/** Disagreements between what the document declares and what the sources report. */
export function drift(declared: Document, observed: ObservedModel): Drift {
  const bound: BoundNode[] = [];
  collectBound(declared.nodes, bound);
  const boundKeys = new Set(bound.map((b) => b.node.bind));
  const items: DriftItem[] = [];
  for (const b of bound) {
    const bind = b.node.bind ?? '';
    const entity = observed.entities[bind];
    if (!entity || entity.missingSince !== undefined) {
      items.push({ kind: 'declared-not-observed', nodeId: b.id, bind, ...(entity?.missingSince !== undefined ? { missingSince: entity.missingSince } : {}) });
      continue;
    }
    for (const f of b.node.facts ?? []) {
      const seen = observedValue(entity, f.label);
      if (seen === undefined) continue;
      if (seen !== f.value) items.push({ kind: 'fact-mismatch', nodeId: b.id, bind, label: f.label, declared: f.value, observed: seen });
    }
    if (!b.isContainer) continue;
    for (const child of Object.values(observed.entities)) {
      if (child.source !== entity.source || child.parent !== entity.id || child.missingSince !== undefined) continue;
      if (boundKeys.has(child.key)) continue;
      items.push({ kind: 'observed-not-declared', containerId: b.id, containerBind: bind, key: child.key, name: child.name, type: child.type });
    }
  }
  return {
    items,
    counts: {
      declaredNotObserved: items.filter((i) => i.kind === 'declared-not-observed').length,
      observedNotDeclared: items.filter((i) => i.kind === 'observed-not-declared').length,
      factMismatch: items.filter((i) => i.kind === 'fact-mismatch').length,
    },
  };
}

/**
 * The part of an observed model a set of documents reads: every entity and
 * relation of a source an `observe` node draws, and for each bound node its
 * entity and that entity's direct children, which drift lists when they
 * are not declared. The overlay, the observe expansion, and drift read
 * nothing outside it, so a document bound to three boxes of a large source
 * carries three boxes and their children, not the source. Open items come
 * with it when they point at a bound box.
 */
export function observedNeeded(docs: readonly Document[], model: ObservedModel): ObservedModel {
  const observeSources = new Set<string>();
  const binds = new Set<string>();
  const walk = (nodes: readonly NodeOutput[]): void => {
    for (const n of nodes) {
      if (n.observe) observeSources.add(n.observe.source);
      if (n.bind !== undefined) binds.add(n.bind);
      if (n.children) walk(n.children);
    }
  };
  for (const d of docs) walk(d.nodes);
  const entities: Record<string, ObservedEntity> = {};
  for (const [key, e] of Object.entries(model.entities)) {
    if (observeSources.has(e.source) || binds.has(key) || (e.parent !== undefined && binds.has(`${e.source}:${e.parent}`))) entities[key] = e;
  }
  const relations: ObservedModel['relations'] = {};
  if (observeSources.size) for (const [key, r] of Object.entries(model.relations)) if (observeSources.has(r.source)) relations[key] = r;
  const items = itemsNeeded(binds, entities, model.items);
  return { entities, relations, ...(Object.keys(items).length ? { items } : {}) };
}

/** Every key a set of documents binds, in the documents and every node inside them. */
export function bindsOf(docs: readonly Document[]): Set<string> {
  const binds = new Set<string>();
  const walk = (nodes: readonly NodeOutput[]): void => {
    for (const n of nodes) {
      if (n.bind !== undefined) binds.add(n.bind);
      if (n.children) walk(n.children);
    }
  };
  for (const d of docs) walk(d.nodes);
  return binds;
}

/**
 * The open items a set of binds can show: those pointed at a bound key, and
 * those pointed at a fact a bound entity carries. Items may come from any
 * source; `entities` must hold the bound entities whose facts are matched.
 */
export function itemsNeeded(binds: ReadonlySet<string>, entities: Readonly<Record<string, ObservedEntity>>, items: Readonly<Record<string, ObservedItem>> | undefined): Record<string, ObservedItem> {
  const out: Record<string, ObservedItem> = {};
  if (!items) return out;
  const bound = [...binds].map((b) => entities[b]).filter((e): e is ObservedEntity => e !== undefined);
  for (const [key, i] of Object.entries(items)) {
    const t = i.target;
    if ('key' in t ? binds.has(t.key) : bound.some((e) => factCarries(e.facts[t.fact], t.value))) out[key] = i;
  }
  return out;
}

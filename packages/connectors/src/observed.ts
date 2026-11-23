/**
 * The observed layer as plain data the hub can persist as JSON: entities
 * and relations keyed by `source:id`, each with when it was last seen, when
 * it went missing, and where it came from, plus what is open against them.
 * `mergeObserved` folds one batch into it and reports what changed.
 */
import type { Batch, BatchEntity, BatchRelation, DisplayFact, FactValue, RelationKind } from './batch.ts';
import { entityKey, relationKey } from './batch.ts';
import type { Logger } from './connector.ts';
import { mergeItems, type ItemChanges, type ObservedItem } from './open-items.ts';

export interface ObservedProvenance {
  readonly source: string;
  readonly sourceId: string;
  /** Last time the source reported it. */
  readonly observed: string;
  readonly url?: string;
}

export interface ObservedEntity {
  readonly key: string;
  readonly source: string;
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly parent?: string;
  readonly facts: Record<string, FactValue>;
  readonly url?: string;
  readonly tags: readonly string[];
  readonly subtitle?: string;
  readonly description?: string;
  /** The facts a box shows, labelled and formatted by the source; absent, a box shows every fact by its key. */
  readonly display?: readonly DisplayFact[];
  readonly firstObserved: string;
  readonly observed: string;
  /** Set when a full batch from its source left it out; cleared when it returns. */
  readonly missingSince?: string;
  readonly provenance: ObservedProvenance;
}

export interface ObservedRelation {
  readonly key: string;
  readonly source: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly kind?: RelationKind;
  readonly tags: readonly string[];
  readonly description?: string;
  readonly firstObserved: string;
  readonly observed: string;
  readonly missingSince?: string;
  readonly provenance: ObservedProvenance;
}

export interface ObservedModel {
  readonly entities: Record<string, ObservedEntity>;
  readonly relations: Record<string, ObservedRelation>;
  /** What is open against entities now, keyed by source:id@target; absent means none. */
  readonly items?: Record<string, ObservedItem>;
}

export interface FactChange {
  readonly key: string;
  readonly fact: string;
  readonly before: FactValue | undefined;
  readonly after: FactValue | undefined;
}

export interface FieldChange {
  readonly key: string;
  readonly field: 'name' | 'type' | 'parent' | 'subtitle' | 'url' | 'description';
  readonly before: string | undefined;
  readonly after: string | undefined;
}

export interface ObservedChanges {
  readonly appeared: readonly string[];
  readonly vanished: readonly string[];
  /** Entities that had gone missing and came back. */
  readonly returned: readonly string[];
  readonly facts: readonly FactChange[];
  readonly fields: readonly FieldChange[];
  readonly relations: { readonly appeared: readonly string[]; readonly vanished: readonly string[]; readonly returned: readonly string[] };
  readonly items: ItemChanges;
}

export function emptyObserved(): ObservedModel {
  return { entities: {}, relations: {}, items: {} };
}

function same(a: FactValue | undefined, b: FactValue | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffFacts(key: string, before: Record<string, FactValue>, after: Record<string, FactValue>, out: FactChange[]): void {
  for (const fact of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!same(before[fact], after[fact])) out.push({ key, fact, before: before[fact], after: after[fact] });
  }
}

function diffFields(key: string, before: ObservedEntity, after: BatchEntity, out: FieldChange[]): void {
  const fields: FieldChange['field'][] = ['name', 'type', 'parent', 'subtitle', 'url', 'description'];
  for (const field of fields) {
    if (before[field] !== after[field]) out.push({ key, field, before: before[field], after: after[field] });
  }
}

function toEntity(source: string, e: BatchEntity, observed: string, previous: ObservedEntity | undefined): ObservedEntity {
  return {
    key: entityKey(source, e.id),
    source,
    id: e.id,
    type: e.type,
    name: e.name,
    ...(e.parent !== undefined ? { parent: e.parent } : {}),
    facts: e.facts ?? {},
    ...(e.url !== undefined ? { url: e.url } : {}),
    tags: e.tags ?? [],
    ...(e.subtitle !== undefined ? { subtitle: e.subtitle } : {}),
    ...(e.description !== undefined ? { description: e.description } : {}),
    ...(e.display !== undefined ? { display: e.display } : {}),
    firstObserved: previous?.firstObserved ?? observed,
    observed,
    provenance: { source, sourceId: e.id, observed, ...(e.url !== undefined ? { url: e.url } : {}) },
  };
}

function toRelation(source: string, r: BatchRelation, observed: string, previous: ObservedRelation | undefined): ObservedRelation {
  return {
    key: relationKey(source, r),
    source,
    from: r.from,
    to: r.to,
    ...(r.label !== undefined ? { label: r.label } : {}),
    ...(r.kind !== undefined ? { kind: r.kind } : {}),
    tags: r.tags ?? [],
    ...(r.description !== undefined ? { description: r.description } : {}),
    firstObserved: previous?.firstObserved ?? observed,
    observed,
    provenance: { source, sourceId: `${r.from}>${r.to}`, observed },
  };
}

export interface MergeResult {
  readonly model: ObservedModel;
  readonly changes: ObservedChanges;
}

export interface MergeOptions {
  /**
   * Days an entity or relation of the batch's source stays after it went
   * missing; past it, a full batch drops it. Sources whose items come and
   * go (job pods, autoscaled nodes) would otherwise grow without end.
   * Unset keeps everything.
   */
  readonly retainMissingDays?: number;
}

/**
 * Folds a batch into the observed model. Entities from other sources are
 * untouched. A full batch marks entities and relations of its source that
 * it left out as missing since this observation, and drops the ones
 * missing longer than the retention; a partial batch leaves them as they
 * were. The previous model is not mutated.
 */
export function mergeObserved(previous: ObservedModel, batch: Batch, log?: Logger, opts: MergeOptions = {}): MergeResult {
  const observed = batch.observed;
  const entities: Record<string, ObservedEntity> = { ...previous.entities };
  const relations: Record<string, ObservedRelation> = { ...previous.relations };
  const appeared: string[] = [];
  const returned: string[] = [];
  const facts: FactChange[] = [];
  const fields: FieldChange[] = [];
  const seen = new Set<string>();
  for (const e of batch.entities) {
    const key = entityKey(batch.source, e.id);
    seen.add(key);
    const before = previous.entities[key];
    if (!before) appeared.push(key);
    else {
      if (before.missingSince !== undefined) returned.push(key);
      diffFacts(key, before.facts, e.facts ?? {}, facts);
      diffFields(key, before, e, fields);
    }
    entities[key] = toEntity(batch.source, e, observed, before);
  }
  const relAppeared: string[] = [];
  const relReturned: string[] = [];
  const seenRel = new Set<string>();
  for (const r of batch.relations) {
    const key = relationKey(batch.source, r);
    seenRel.add(key);
    const before = previous.relations[key];
    if (!before) relAppeared.push(key);
    else if (before.missingSince !== undefined) relReturned.push(key);
    relations[key] = toRelation(batch.source, r, observed, before);
  }
  const vanished: string[] = [];
  const relVanished: string[] = [];
  if (!batch.partial) {
    for (const [key, e] of Object.entries(previous.entities)) {
      if (e.source !== batch.source || seen.has(key)) continue;
      if (e.missingSince === undefined) {
        vanished.push(key);
        entities[key] = { ...e, missingSince: observed };
      }
    }
    for (const [key, r] of Object.entries(previous.relations)) {
      if (r.source !== batch.source || seenRel.has(key)) continue;
      if (r.missingSince === undefined) {
        relVanished.push(key);
        relations[key] = { ...r, missingSince: observed };
      }
    }
  }
  let dropped = 0;
  if (!batch.partial && opts.retainMissingDays !== undefined) {
    const cutoff = Date.parse(observed) - opts.retainMissingDays * 86_400_000;
    const expired = (e: { source: string; missingSince?: string }): boolean => e.source === batch.source && e.missingSince !== undefined && Date.parse(e.missingSince) < cutoff;
    for (const [key, e] of Object.entries(entities)) if (expired(e)) (delete entities[key], dropped++);
    for (const [key, r] of Object.entries(relations)) if (expired(r)) (delete relations[key], dropped++);
  }
  const merged = mergeItems(previous.items ?? {}, batch);
  const changes: ObservedChanges = { appeared, vanished, returned, facts, fields, relations: { appeared: relAppeared, vanished: relVanished, returned: relReturned }, items: merged.changes };
  log?.info('observed merge', {
    dropped,
    source: batch.source,
    partial: batch.partial ?? false,
    entitiesBefore: Object.keys(previous.entities).length,
    entitiesAfter: Object.keys(entities).length,
    appeared: appeared.length,
    vanished: vanished.length,
    returned: returned.length,
    factChanges: facts.length,
    fieldChanges: fields.length,
    relationsAppeared: relAppeared.length,
    relationsVanished: relVanished.length,
    itemsOpen: Object.keys(merged.items).length,
    itemsOpened: merged.changes.opened.length,
    itemsClosed: merged.changes.closed.length,
  });
  return { model: { entities, relations, items: merged.items }, changes };
}

/** Entities of one source that are currently present (not missing). */
export function presentEntities(model: ObservedModel, source?: string): ObservedEntity[] {
  return Object.values(model.entities).filter((e) => e.missingSince === undefined && (source === undefined || e.source === source));
}

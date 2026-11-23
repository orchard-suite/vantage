/**
 * Open items in the observed layer: what is open against an entity right
 * now. A source reports them on its own entities or points them at any
 * entity by key or by fact; here they become one list keyed by
 * `source:id@target`, merged per batch, and matched to bound nodes.
 *
 * Items do not go missing the way entities do. An item a full batch no
 * longer reports is closed, and it is gone.
 */
import { ITEM_SEVERITIES, type NodeOpenItem, type OpenItemKind, type ItemSeverity } from '@vantage/model';
import type { Batch, ItemTarget } from './batch.ts';
import { batchItemKey, entityKey } from './batch.ts';
import type { FactValue } from './batch.ts';

export interface ObservedItem {
  readonly key: string;
  readonly source: string;
  readonly id: string;
  readonly kind: OpenItemKind;
  readonly title: string;
  readonly url?: string | undefined;
  readonly severity?: ItemSeverity | undefined;
  readonly status?: string | undefined;
  readonly updated?: string | undefined;
  /** An observed entity key, or a fact every matching entity carries. */
  readonly target: ItemTarget;
  /** Last time the source reported it. */
  readonly observed: string;
}

export interface ItemChanges {
  readonly opened: readonly string[];
  readonly closed: readonly string[];
}

/** Every item a batch reports, entity items pointed at their entity's key. */
export function itemsOfBatch(batch: Batch): ObservedItem[] {
  const out: ObservedItem[] = [];
  const add = (item: Omit<ObservedItem, 'key' | 'source' | 'observed'>): void => {
    out.push({ ...item, key: batchItemKey(batch.source, item), source: batch.source, observed: batch.observed });
  };
  for (const e of batch.entities) {
    for (const i of e.items ?? []) add({ ...i, target: { key: entityKey(batch.source, e.id) } });
  }
  for (const i of batch.items ?? []) add(i);
  return out;
}

/**
 * Folds a batch's items into the previous ones. A full batch replaces every
 * item of its source. A partial batch adds or refreshes what it reports and
 * closes the items of the entities it carries that it no longer lists.
 */
export function mergeItems(previous: Readonly<Record<string, ObservedItem>>, batch: Batch): { items: Record<string, ObservedItem>; changes: ItemChanges } {
  const reported = itemsOfBatch(batch);
  const items: Record<string, ObservedItem> = {};
  const carried = new Set(batch.entities.map((e) => entityKey(batch.source, e.id)));
  const fresh = new Set(reported.map((i) => i.key));
  const closed: string[] = [];
  for (const [key, item] of Object.entries(previous)) {
    const replaced = item.source === batch.source && (!batch.partial || ('key' in item.target && carried.has(item.target.key)));
    if (!replaced) items[key] = item;
    else if (!fresh.has(key)) closed.push(key);
  }
  const opened: string[] = [];
  for (const i of reported) {
    if (!previous[i.key]) opened.push(i.key);
    items[i.key] = i;
  }
  return { items, changes: { opened, closed } };
}

/** A value as a fact match compares it: lower case, without a trailing slash or .git. */
function norm(v: string): string {
  return v.trim().toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '');
}

/**
 * Whether a fact carries a value: equal, or a URL or path that ends in it
 * (`https://github.com/acme/shop` carries `acme/shop`). A list carries a
 * value when any of its entries does.
 */
export function factCarries(fact: FactValue | undefined, value: string): boolean {
  if (Array.isArray(fact)) return fact.some((f) => factCarries(f, value));
  if (typeof fact !== 'string' && typeof fact !== 'number') return false;
  const a = norm(String(fact));
  const b = norm(value);
  return a === b || a.endsWith(`/${b}`);
}

/** Worst first, then the most recently changed. */
function order(a: ObservedItem, b: ObservedItem): number {
  const s = ITEM_SEVERITIES.indexOf(a.severity ?? 'info') - ITEM_SEVERITIES.indexOf(b.severity ?? 'info');
  if (s !== 0) return s;
  return (b.updated ?? '').localeCompare(a.updated ?? '') || a.key.localeCompare(b.key);
}

/**
 * The items that point at one bound key: by that key, or by a fact the
 * entity under it carries. `facts` is that entity's facts, when observed.
 */
export function itemsFor(items: Readonly<Record<string, ObservedItem>> | undefined, bind: string, facts: Readonly<Record<string, FactValue>> | undefined): ObservedItem[] {
  if (!items) return [];
  return Object.values(items)
    .filter((i) => ('key' in i.target ? i.target.key === bind : facts !== undefined && factCarries(facts[i.target.fact], i.target.value)))
    .sort(order);
}

export interface ItemFreshness {
  readonly now: Date;
  readonly thresholdDays: number;
}

/** An item as a node carries it, marked stale when its last report is older than the threshold. */
export function nodeOpenItem(i: ObservedItem, fresh?: ItemFreshness): NodeOpenItem {
  const stale = fresh !== undefined && fresh.now.getTime() - Date.parse(i.observed) > fresh.thresholdDays * 86_400_000;
  return {
    kind: i.kind,
    title: i.title,
    ...(i.url !== undefined ? { url: i.url } : {}),
    ...(i.severity !== undefined ? { severity: i.severity } : {}),
    ...(i.status !== undefined ? { status: i.status } : {}),
    ...(i.updated !== undefined ? { updated: i.updated } : {}),
    source: i.source,
    observed: i.observed,
    ...(stale ? { stale: true } : {}),
  };
}

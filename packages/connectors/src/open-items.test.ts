import { describe, expect, test } from 'bun:test';
import { DocumentSchema } from '@vantage/model';
import type { Batch } from './batch.ts';
import { batchItemKey, mergeBatches } from './batch.ts';
import { emptyObserved, mergeObserved } from './observed.ts';
import { factCarries, itemsFor, itemsOfBatch, mergeItems, nodeOpenItem } from './open-items.ts';
import { itemsNeeded, observedNeeded, overlayObserved } from './overlay.ts';

const t1 = '2026-10-28T10:00:00Z';
const t2 = '2026-10-29T10:00:00Z';

const orrery: Batch = {
  source: 'home',
  observed: t1,
  entities: [
    { id: 'svc:relay', type: 'service', name: 'Relay', facts: { repository: 'https://github.com/acme/relay.git', service: 'relay' }, items: [{ id: 'a1', kind: 'alert', title: 'Relay down', severity: 'critical' }] },
    { id: 'svc:shop', type: 'service', name: 'Shop', facts: { repository: ['acme/shop'] } },
  ],
  relations: [],
};

const github: Batch = {
  source: 'gh',
  observed: t1,
  entities: [],
  relations: [],
  items: [
    { id: 'acme/relay#7', kind: 'pr', title: '#7 Ports', updated: '2026-10-27T09:00:00Z', target: { fact: 'repository', value: 'acme/relay' } },
    { id: 'acme/relay#9', kind: 'issue', title: '#9 Leak', severity: 'high', updated: '2026-10-26T09:00:00Z', target: { fact: 'repository', value: 'acme/relay' } },
    { id: 'OPS-1', kind: 'issue', title: 'OPS-1 Shop', target: { key: 'home:svc:shop' } },
  ],
};

describe('open items in the observed layer', () => {
  test('entity items point at their own key; batch items keep their target', () => {
    const items = itemsOfBatch(orrery);
    expect(items).toEqual([{ id: 'a1', kind: 'alert', title: 'Relay down', severity: 'critical', target: { key: 'home:svc:relay' }, key: 'home:a1@home:svc:relay', source: 'home', observed: t1 }]);
    expect(itemsOfBatch(github).map((i) => i.key)).toEqual(['gh:acme/relay#7@repository=acme/relay', 'gh:acme/relay#9@repository=acme/relay', 'gh:OPS-1@home:svc:shop']);
  });

  test('a full batch replaces every item of its source and leaves other sources alone', () => {
    let m = mergeObserved(emptyObserved(), orrery).model;
    m = mergeObserved(m, github).model;
    expect(Object.keys(m.items ?? {})).toHaveLength(4);
    const next = mergeObserved(m, { ...github, observed: t2, items: [github.items![0]!] });
    expect(next.changes.items).toEqual({ opened: [], closed: ['gh:acme/relay#9@repository=acme/relay', 'gh:OPS-1@home:svc:shop'] });
    expect(Object.keys(next.model.items ?? {}).sort()).toEqual(['gh:acme/relay#7@repository=acme/relay', 'home:a1@home:svc:relay']);
    expect(next.model.items?.['gh:acme/relay#7@repository=acme/relay']?.observed).toBe(t2);
  });

  test('a partial batch closes only the items of the entities it carries', () => {
    const first = mergeItems({}, orrery).items;
    const partial: Batch = { ...orrery, partial: true, observed: t2, entities: [{ ...orrery.entities[0]!, items: [] }] };
    const after = mergeItems({ ...first, ...mergeItems({}, github).items }, partial);
    expect(after.changes.closed).toEqual(['home:a1@home:svc:relay']);
    expect(Object.keys(after.items)).toHaveLength(3);
  });

  test('mergeBatches keeps every item once', () => {
    const merged = mergeBatches([{ ...github, partial: true }, { ...github, partial: true, items: [github.items![0]!] }], t2);
    expect(merged.items?.map((i) => batchItemKey('gh', i))).toHaveLength(3);
  });

  test('a fact carries a value when equal or when a URL or path ends in it', () => {
    expect(factCarries('acme/relay', 'acme/relay')).toBe(true);
    expect(factCarries('https://github.com/Acme/Relay.git', 'acme/relay')).toBe(true);
    expect(factCarries('github.com/acme/relay/', 'acme/relay')).toBe(true);
    expect(factCarries(['x', 'acme/relay'], 'acme/relay')).toBe(true);
    expect(factCarries('acme/relay-old', 'acme/relay')).toBe(false);
    expect(factCarries('notacme/relay', 'acme/relay')).toBe(false);
    expect(factCarries(undefined, 'acme/relay')).toBe(false);
  });

  test('items for a bind come worst first, then newest', () => {
    const m = mergeObserved(mergeObserved(emptyObserved(), orrery).model, github).model;
    const relay = itemsFor(m.items, 'home:svc:relay', m.entities['home:svc:relay']!.facts);
    expect(relay.map((i) => i.id)).toEqual(['a1', 'acme/relay#9', 'acme/relay#7']);
    expect(itemsFor(m.items, 'home:svc:shop', m.entities['home:svc:shop']!.facts).map((i) => i.id)).toEqual(['OPS-1']);
  });

  test('a node item is stale past the threshold', () => {
    const [i] = itemsOfBatch(orrery);
    expect(nodeOpenItem(i!, { now: new Date('2026-10-29T09:00:00Z'), thresholdDays: 1 }).stale).toBeUndefined();
    expect(nodeOpenItem(i!, { now: new Date('2026-11-05T09:00:00Z'), thresholdDays: 1 }).stale).toBe(true);
    expect(nodeOpenItem(i!)).toEqual({ kind: 'alert', title: 'Relay down', severity: 'critical', source: 'home', observed: t1 });
  });
});

describe('open items on bound nodes', () => {
  const m = mergeObserved(mergeObserved(emptyObserved(), orrery).model, github).model;
  const doc = DocumentSchema.parse({
    title: 'Shop',
    nodes: [
      { id: 'relay', name: 'Relay', bind: 'home:svc:relay' },
      { id: 'shop', name: 'Shop', bind: 'home:svc:shop' },
      { id: 'plain', name: 'Plain' },
      { id: 'later', name: 'Later', bind: 'home:svc:later' },
    ],
  });

  test('the overlay copies the matching items onto each bound node, stale ones marked', () => {
    const out = overlayObserved(doc, m, { now: new Date('2026-11-05T10:00:00Z'), thresholdDays: 3 });
    const [relay, shop, plain, later] = out.nodes;
    expect(relay!.openItems?.map((i) => [i.kind, i.severity, i.source, i.stale])).toEqual([
      ['alert', 'critical', 'home', true],
      ['issue', 'high', 'gh', true],
      ['pr', undefined, 'gh', true],
    ]);
    expect(shop!.openItems?.map((i) => i.title)).toEqual(['OPS-1 Shop']);
    expect(plain!.openItems).toBeUndefined();
    expect(later!.openItems).toBeUndefined();
  });

  test('items pointed at a key show on a box whose entity is not observed yet', () => {
    const extra = mergeObserved(m, { ...github, partial: true, items: [{ id: 'OPS-2', kind: 'issue', title: 'Later', target: { key: 'home:svc:later' } }] }).model;
    expect(overlayObserved(doc, extra).nodes[3]!.openItems?.map((i) => i.title)).toEqual(['Later']);
  });

  test('the narrowed model keeps only items a bound box can show', () => {
    const noise = mergeObserved(m, { ...github, partial: true, items: [{ id: 'x', kind: 'issue', title: 'Elsewhere', target: { fact: 'repository', value: 'acme/other' } }] }).model;
    expect(Object.keys(observedNeeded([doc], noise).items ?? {})).toHaveLength(4);
    expect(Object.keys(itemsNeeded(new Set(['home:svc:shop']), noise.entities, noise.items))).toEqual(['gh:OPS-1@home:svc:shop']);
  });
});

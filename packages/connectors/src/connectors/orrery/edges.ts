/**
 * Edge blueprints: a blueprint whose records say that one thing reaches
 * another (an app reaching a database, as one reader saw it) is drawn as
 * arrows, not boxes. Each record runs from the first of its `from`
 * relations that has a target to every target of its `to` relations.
 * Records between the same pair fold into one arrow: its label lists every
 * value of the label field, and its description each described field over
 * all of them, numbers summed. A record that reaches nothing the catalog
 * holds, or whose health is amber or red, runs to an unresolved stub named
 * by what it tried to reach, so the gap shows in the picture. A record that
 * reaches only what the reader may not see is left out, as such a relation
 * is everywhere else.
 */
import { z } from 'zod';
import type { BatchEntity, BatchRelation, FactValue, RelationKind } from '../../batch.ts';
import { fieldLabel, valueText, type OrreryFieldDef } from './display.ts';
import { orreryEntityId, visibleRefs, type OrreryEntity } from './entity.ts';

export const OrreryEdgeSchema = z
  .object({
    from: z.array(z.string()).min(1).describe('Relations naming where the arrow starts, tried in order; the first with a target wins, and a record with none is left out'),
    to: z.array(z.string()).min(1).describe('Relations naming where the arrow ends; every target of every one gets an arrow'),
    label: z.string().optional().describe('Field whose value labels the arrow, such as kind; folded records list each value'),
    health: z.string().optional().describe('Field whose value amber or red sends the record to the unresolved stub'),
    unresolved: z.string().optional().describe('Field naming what a record tried to reach, such as host; each value gets its own stub'),
  })
  .strict();

export type OrreryEdge = z.output<typeof OrreryEdgeSchema>;

/** The type of the stub an unresolved record runs to; an observe block lists it among its types to draw it. */
export const UNRESOLVED_TYPE = 'unresolved';

export interface FoldedEdges {
  readonly entities: BatchEntity[];
  readonly relations: BatchRelation[];
  readonly counts: { readonly records: number; readonly skipped: number; readonly arrows: number; readonly unresolved: number };
}

interface Pair {
  readonly from: string;
  readonly to: string;
  readonly labels: Set<string>;
  readonly records: Record<string, unknown>[];
}

/** One field over every folded record: numbers summed, anything else listed once each, in order. */
function foldValues(values: readonly unknown[]): FactValue | undefined {
  const present = values.filter((v) => v !== undefined && v !== null && v !== '');
  if (!present.length) return undefined;
  if (present.every((v) => typeof v === 'number')) return present.reduce<number>((a, b) => a + (b as number), 0);
  const seen = new Set<string>();
  for (const v of present.flatMap((v) => (Array.isArray(v) ? v : [v]))) seen.add(typeof v === 'string' ? v : JSON.stringify(v));
  return [...seen].sort();
}

function describe(records: readonly Record<string, unknown>[], fields: readonly string[], defs: Record<string, OrreryFieldDef>): string | undefined {
  const lines: string[] = [];
  for (const f of fields) {
    const v = foldValues(records.map((r) => r[f]));
    if (v === undefined) continue;
    const text = valueText(v, defs[f]);
    if (text !== '') lines.push(`${fieldLabel(f, defs[f])}: ${text}.`);
  }
  return lines.length ? lines.join(' ') : undefined;
}

function textOf(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' ? String(v) : undefined;
}

/**
 * Folds every record of one edge blueprint into arrows and the stubs the
 * unresolved ones run to. `described` are the fields its descriptions
 * list; without them, every field the records carry.
 */
export function foldEdges(blueprint: string, edge: OrreryEdge, records: readonly OrreryEntity[], described: readonly string[] | undefined, defs: Record<string, OrreryFieldDef>, kind: RelationKind | undefined): FoldedEdges {
  const pairs = new Map<string, Pair>();
  const stubs = new Map<string, BatchEntity>();
  const healthFact = edge.health ?? 'health';
  let skipped = 0;
  let unresolved = 0;
  for (const r of records) {
    const fromRef = edge.from.map((rel) => visibleRefs(r, rel)[0]).find((x) => x !== undefined);
    if (!fromRef) {
      skipped++;
      continue;
    }
    const from = orreryEntityId(fromRef);
    const health = edge.health === undefined ? undefined : r.fields[edge.health];
    const targets = [...new Set(edge.to.flatMap((rel) => visibleRefs(r, rel).map(orreryEntityId)))];
    if (!targets.length && edge.to.some((rel) => r.relations[rel]?.some((x) => x.restricted))) {
      skipped++;
      continue;
    }
    let ends = targets;
    if (!targets.length || health === 'amber' || health === 'red') {
      unresolved++;
      const reached = edge.unresolved === undefined ? undefined : textOf(r.fields[edge.unresolved]);
      const id = reached === undefined ? UNRESOLVED_TYPE : `${UNRESOLVED_TYPE}:${reached}`;
      if (!stubs.has(id)) stubs.set(id, { id, type: UNRESOLVED_TYPE, name: reached ?? 'Unresolved', subtitle: 'unresolved', facts: { [healthFact]: 'amber' }, tags: [blueprint, UNRESOLVED_TYPE], description: 'Nothing in the catalog matches what this reaches yet.' });
      ends = [id];
    }
    const label = edge.label === undefined ? undefined : textOf(r.fields[edge.label]);
    for (const to of ends) {
      const key = `${from}>${to}`;
      const pair = pairs.get(key) ?? { from, to, labels: new Set<string>(), records: [] };
      if (label !== undefined) pair.labels.add(label);
      pair.records.push(r.fields);
      pairs.set(key, pair);
    }
  }
  const relations: BatchRelation[] = [];
  for (const p of [...pairs.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))) {
    const fields = described ?? [...new Set(p.records.flatMap((r) => Object.keys(r)))];
    const description = describe(p.records, fields, defs);
    const label = [...p.labels].sort().join(', ');
    relations.push({ from: p.from, to: p.to, ...(label ? { label } : {}), ...(kind !== undefined ? { kind } : {}), tags: [blueprint], ...(description !== undefined ? { description } : {}) });
  }
  return { entities: [...stubs.values()], relations, counts: { records: records.length, skipped, arrows: relations.length, unresolved } };
}

/**
 * An item's plan in time. `start` and `end` are date labels the roadmap
 * item and its kin carry; `promised` stays a date someone promised. A
 * parent's span is worked out from its parts when it is read, the earliest
 * start to the latest end of every item under it, and never stored as the
 * parent's own labels.
 */
import type { Db } from '../db/db.ts';
import { badRequest } from '../http.ts';
import type { KindDef } from './kinds.ts';
import type { LabelValue } from './state.ts';

/** A span worked out from an item's parts: either end may be unknown when no part gives it. */
export interface Span {
  readonly start: string | null;
  readonly end: string | null;
  readonly parts: number;
}

/** Refuses labels that end before they start, when the kind has both. */
export function checkDates(def: KindDef, labels: Readonly<Record<string, LabelValue>>): void {
  const has = (n: string): boolean => def.labels.some((l) => l.name === n && l.type === 'date');
  if (!has('start') || !has('end')) return;
  const start = labels['start'], end = labels['end'];
  if (typeof start === 'string' && typeof end === 'string' && end < start) throw badRequest(`end ${end} is before start ${start}; an item ends on or after the day it starts`);
}

const DATE = "'^\\d{4}-\\d{2}-\\d{2}$'";

/** The SQL for the span of the item whose id is `idSql`, as json {start, end, parts}, or null when it has no parts. */
export function spanSql(idSql: string): string {
  return `(with recursive d(id, labels) as (select c.id, c.labels from items c where c.parent_id = ${idSql} union select c.id, c.labels from items c join d on c.parent_id = d.id)
     select case when count(*) = 0 then null else jsonb_build_object('start', min(d.labels ->> 'start') filter (where d.labels ->> 'start' ~ ${DATE}), 'end', max(d.labels ->> 'end') filter (where d.labels ->> 'end' ~ ${DATE}), 'parts', count(*)) end from d)`;
}

/** The span of one item's parts, or undefined when no part has a date to give it. */
export async function spanOf(db: Db, itemId: string): Promise<Span | undefined> {
  const row = (await db.query<{ span: Span | null }>(`select ${spanSql('$1')} as span`, [itemId]))[0];
  return spanFrom(row?.span ?? null);
}

/** A span as the query answered it, kept only when a part gives it a date. */
export function spanFrom(raw: Span | null): Span | undefined {
  if (!raw || (raw.start === null && raw.end === null)) return undefined;
  return { start: raw.start, end: raw.end, parts: Number(raw.parts) };
}

/** A span in one line: `2026-01-05 to 2026-03-20, from 3 parts`. */
export function spanText(s: Span): string {
  return `${s.start ?? 'no start'} to ${s.end ?? 'no end'}, from ${s.parts} part${s.parts === 1 ? '' : 's'}`;
}

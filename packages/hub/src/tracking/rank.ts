/**
 * An item's place among the items of its kind (VAN-3006). A rank is a
 * fraction written in base-36 digits with no trailing zero, so a rank
 * always fits between any two others and a move rewrites one row. Ranks
 * compare byte by byte, in SQL (`collate "C"`) and here. Items show by
 * horizon, in the label's choice order, then by rank, then newest first;
 * an item with no rank shows after the ranked ones.
 */
import type { Db } from '../db/db.ts';
import { badRequest } from '../http.ts';
import type { KindDef } from './kinds.ts';
import type { LabelValue } from './state.ts';

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Where an item goes: first or last in its horizon, or beside another item there. */
export type Place = 'first' | 'last' | { readonly before: string } | { readonly after: string };

/** A rank strictly between `a` (or the start, '') and `b` (or the end, null). */
export function rankBetween(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`no rank between ${a} and ${b}`);
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + rankBetween(a.slice(n), b.slice(n));
  }
  const lo = a ? DIGITS.indexOf(a[0]!) : 0;
  const hi = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (hi - lo > 1) return DIGITS[Math.round((lo + hi) / 2)]!;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[lo]! + rankBetween(a.slice(1), null);
}

/** The label a kind's items are grouped by, when it has one: a choice named horizon. */
export function horizonOf(def: KindDef): readonly string[] | undefined {
  const l = def.labels.find((x) => x.name === 'horizon' && x.type === 'choice');
  return l?.choices;
}

/** The SQL that orders one kind's items (aliased `i`) as every list shows them; `$n` holds the horizon's choices. */
export function orderSql(n: number | undefined): string {
  return `${n !== undefined ? `coalesce(array_position($${n}::text[], i.labels ->> 'horizon'), 2147483647), ` : ''}i.rank nulls last, i.updated_at desc, i.key`;
}

interface Peer {
  readonly id: string;
  readonly key: string;
  readonly rank: string | null;
}

/** What a placement writes: the item's rank, and a rank for each unranked item shown before it, in the order shown. */
export interface Placement {
  readonly rank: string;
  readonly peers: readonly { readonly id: string; readonly rank: string }[];
  readonly words: string;
}

/**
 * Works out where an item goes among the items of its kind in the same
 * horizon, `self` aside. Beside another item, that item must stand in the
 * same horizon: a move to another horizon sets the horizon with the place.
 */
export async function placement(tx: Db, kind: { readonly id: string; readonly definition: KindDef }, self: { readonly id: string; readonly key: string }, labels: Readonly<Record<string, LabelValue>>, place: Place): Promise<Placement> {
  const choices = horizonOf(kind.definition);
  const horizon = choices ? (typeof labels['horizon'] === 'string' ? labels['horizon'] : '') : undefined;
  const params: unknown[] = [kind.id, self.id];
  if (horizon !== undefined) params.push(horizon);
  const peers = await tx.query<Peer>(`select i.id, i.key, i.rank from items i where i.kind_id = $1 and i.id <> $2${horizon !== undefined ? ` and coalesce(i.labels ->> 'horizon', '') = $3` : ''} order by ${orderSql(undefined)}`, params);
  const where = horizon ? ` in ${horizon}` : horizon === '' ? ' among the items with no horizon' : '';
  let at: number;
  if (place === 'first') at = 0;
  else if (place === 'last') at = peers.length;
  else {
    const ref = 'before' in place ? place.before : place.after;
    if (ref.trim().toUpperCase() === self.key) throw badRequest(`${self.key} cannot be placed beside itself`);
    const i = peers.findIndex((x) => x.key === ref.trim().toUpperCase());
    if (i < 0) throw badRequest(`${ref} is not a ${kind.definition.prefix} item${where}; an item is placed beside one in its own horizon, so set horizon in the same put to move it to another`);
    at = 'before' in place ? i : i + 1;
  }
  // An item shown before the new place that has no rank yet gets one, in the order it shows, so the place holds.
  const ranked: { id: string; rank: string }[] = [];
  let prev = '';
  for (const x of peers.slice(0, at)) {
    if (x.rank !== null) prev = x.rank;
    else {
      prev = rankBetween(prev, null);
      ranked.push({ id: x.id, rank: prev });
    }
  }
  const next = peers[at]?.rank ?? null;
  const words = place === 'first' || place === 'last' ? `${place}${where}` : 'before' in place ? `before ${place.before.trim().toUpperCase()}` : `after ${place.after.trim().toUpperCase()}`;
  return { rank: rankBetween(prev, ranked.length ? null : next), peers: ranked, words };
}

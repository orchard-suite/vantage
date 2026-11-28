/**
 * A milestone gathers items to one date. Items of any kind link `toward`
 * it; it is worked out from them like a parent from its parts, and ships
 * when every item toward it has shipped. Its card rolls them up: how many
 * stand in each class, and which are at risk of missing its date.
 */
import type { StateClass } from '@vantage/model';
import type { Db } from '../db/db.ts';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { reachOf, visibleWhere } from './access.ts';
import { rootOf, type KindDef } from './kinds.ts';
import type { ItemState } from './state.ts';

export function isMilestone(def: KindDef): boolean {
  return rootOf(def) === 'milestone';
}

export type MilestoneStatus = 'on track' | 'at risk' | 'done';

export interface Rollup {
  readonly date: string | null;
  readonly status: MilestoneStatus;
  readonly counts: Readonly<Record<StateClass, number>>;
  /** Items not done that may miss the date, each with why. */
  readonly atRisk: readonly { readonly key: string; readonly why: string }[];
}

/** The longest list of items at risk a card carries; the rest are counted. */
export const AT_RISK_MAX = 10;

/**
 * An item toward the milestone is at risk when it is not done and not
 * dropped, and it ends after the milestone's date, has no end, or waits on
 * an item that ends after it. A milestone with no date is at risk.
 */
export async function rollupOf(db: Db, m: Pick<ItemState, 'id' | 'labels'>): Promise<Rollup> {
  const date = typeof m.labels['date'] === 'string' ? m.labels['date'] : null;
  const rows = await db.query<{ id: string; key: string; class: StateClass; end: string | null }>("select i.id, i.key, i.class, i.labels ->> 'end' as end from item_links l join items i on i.id = l.item_id where l.rel = 'toward' and l.target = $1 order by i.key", [m.id]);
  const waits = rows.length ? await db.query<{ item_id: string; key: string; end: string | null }>("select l.item_id, w.key, w.labels ->> 'end' as end from item_links l join items w on w.id = l.target where l.rel = 'waits-on' and l.item_id = any($1::text[]) order by w.key", [rows.map((r) => r.id)]) : [];
  const counts: Record<StateClass, number> = { 'not-started': 0, 'in-progress': 0, done: 0, parked: 0 };
  const atRisk: { key: string; why: string }[] = [];
  for (const r of rows) {
    counts[r.class] += 1;
    if (r.class === 'done' || r.class === 'parked') continue;
    const late = waits.find((w) => w.item_id === r.id && date !== null && w.end !== null && w.end > date);
    const why = date === null ? null : r.end === null ? 'it has no end date' : r.end > date ? `it ends ${r.end}, after ${date}` : late ? `it waits on ${late.key}, which ends ${late.end}` : null;
    if (why) atRisk.push({ key: r.key, why });
  }
  const live = rows.filter((r) => r.class !== 'parked');
  const status: MilestoneStatus = live.length && live.every((r) => r.class === 'done') ? 'done' : date === null || atRisk.length ? 'at risk' : 'on track';
  return { date, status, counts, atRisk };
}

/** A rollup in one line, for a card and an outline. */
export function rollupText(r: Rollup): string {
  const total = Object.values(r.counts).reduce((s, x) => s + x, 0);
  if (!total) return `${r.status}: nothing links toward it yet${r.date ? `; due ${r.date}` : '; it has no date'}`;
  const parts = ([['done', 'done'], ['in-progress', 'under way'], ['not-started', 'not started'], ['parked', 'dropped']] as const).flatMap(([c, w]) => (r.counts[c] ? [`${r.counts[c]} ${w}`] : []));
  const risk = r.date === null ? '; it has no date, so nothing can be on track' : r.atRisk.length ? `; at risk: ${r.atRisk.slice(0, AT_RISK_MAX).map((x) => `${x.key} (${x.why})`).join(', ')}${r.atRisk.length > AT_RISK_MAX ? `, and ${r.atRisk.length - AT_RISK_MAX} more` : ''}` : '';
  return `${r.status}: ${total} item${total === 1 ? '' : 's'} toward it (${parts.join(', ')})${r.date ? `, due ${r.date}` : ''}${risk}`;
}

/** A milestone as a timeline marks it. */
export interface Marker {
  readonly key: string;
  readonly title: string;
  readonly date: string;
}

/** The dated milestones the caller may see that items of this kind link toward. */
export async function markersFor(ctx: AppContext, p: Principal, kindId: string): Promise<Marker[]> {
  const vis = visibleWhere(await reachOf(ctx, p), 2);
  return ctx.dbRead.query<Marker>(
    `select distinct i.key, i.title, i.labels ->> 'date' as date from item_links l join items s on s.id = l.item_id join items i on i.id = l.target
      where l.rel = 'toward' and s.kind_id = $1 and i.labels ->> 'date' ~ '^\\d{4}-\\d{2}-\\d{2}$' and ${vis.sql} order by 3, 1`,
    [kindId, ...vis.params],
  );
}

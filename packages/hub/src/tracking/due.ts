/**
 * Due dates (VAN-3025). The hub reads the dates a shipped base declares,
 * and a work item's `due` is when it is owed. An item is overdue when its
 * due day is before today, and due soon from today through the configured
 * number of days after it, both read in the hub's time zone; an item that
 * is done or parked is neither. A module's own labels stay unread
 * (VAN-3005): a kind reads `due` only when its chain ends at a shipped kind
 * that declares it.
 */
import { BASE_KINDS, type BaseKind } from '@vantage/model';
import type { Db } from '../db/db.ts';
import { dayOf } from '../day.ts';
import { rootOf, shippedDef, type KindDef } from './kinds.ts';
import type { ItemState, LabelValue } from './state.ts';

/** What a list may ask for: the items due soon, or the items overdue. */
export const DUE_FILTERS = ['soon', 'overdue'] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

/** An item's due date as the hub reads it today. */
export interface Due {
  readonly date: string;
  readonly overdue: boolean;
  readonly soon: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_SQL = "'^\\d{4}-\\d{2}-\\d{2}$'";

/** The shipped kinds that declare a `due` date. */
function dueBases(): BaseKind[] {
  return BASE_KINDS.filter((b) => shippedDef(b).labels.some((l) => l.name === 'due' && l.type === 'date'));
}

/** Whether the hub reads a kind's `due`: its chain ends at a shipped kind that declares one. */
export function readsDue(def: Pick<KindDef, 'base' | 'root'>): boolean {
  const root = rootOf(def);
  return root !== undefined && dueBases().includes(root);
}

/** The day `n` days after a YYYY-MM-DD day. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

const open = (cls: ItemState['class']): boolean => cls !== 'done' && cls !== 'parked';

/** An item's due date and where it stands today, or undefined when its kind reads none or it has none. */
export function dueOf(root: string | undefined, labels: Readonly<Record<string, LabelValue>>, cls: ItemState['class'], today: string, soonDays: number): Due | undefined {
  if (!root || !readsDue({ base: root })) return undefined;
  const date = labels['due'];
  if (typeof date !== 'string' || !DAY.test(date)) return undefined;
  const live = open(cls);
  return { date, overdue: live && date < today, soon: live && date >= today && date <= addDays(today, soonDays) };
}

/** A due date in a few words: `2026-11-30, overdue`. */
export function dueText(d: Due): string {
  return `${d.date}${d.overdue ? ', overdue' : d.soon ? ', due soon' : ''}`;
}

/**
 * The condition a list of items (aliased `i`, its kind `k`) adds to hold
 * only the items due soon or overdue. `next` is the number of its first
 * parameter; it answers the SQL and the parameters to append.
 */
export function dueWhere(filter: DueFilter, next: number, today: string, soonDays: number): { sql: string; params: unknown[] } {
  const base = `coalesce(k.definition ->> 'root', k.definition ->> 'base') = any($${next}::text[]) and i.class not in ('done', 'parked') and i.labels ->> 'due' ~ ${DAY_SQL}`;
  if (filter === 'overdue') return { sql: `(${base} and i.labels ->> 'due' < $${next + 1})`, params: [dueBases(), today] };
  return { sql: `(${base} and i.labels ->> 'due' between $${next + 1} and $${next + 2})`, params: [dueBases(), today, addDays(today, soonDays)] };
}

/** An item that just became due soon or overdue. */
export interface DueNotice {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly workspaceId: string;
  readonly due: string;
  readonly status: DueFilter;
  /** Who answers for it, as the item names them. */
  readonly owner: { readonly kind: 'user' | 'team'; readonly id: string } | null;
  readonly holders: readonly string[];
}

/** The most notices one call answers; a caller that gets this many asks again from a later day. */
export const NOTICE_MAX = 1000;

/**
 * The items of an organization that became due soon or overdue after
 * `since` and by `today` (both YYYY-MM-DD, `today` in the hub's time zone
 * when left out): overdue when the due day is on or after `since` and
 * before today, so it was not overdue on `since`; due soon when the due day
 * is in today's window and past the window `since` had. Done and parked
 * items are neither. Called once a day, with the day it last ran, it names
 * each item once per change.
 */
export async function newlyDue(db: Db, orgId: string, since: string, opts: { today?: string; soonDays: number }): Promise<DueNotice[]> {
  const today = opts.today ?? dayOf();
  if (!DAY.test(since) || !DAY.test(today)) throw new Error('since and today are days, YYYY-MM-DD');
  if (since >= today) return [];
  const rows = await db.query<{ id: string; key: string; title: string; workspace_id: string; due: string; owner_kind: 'user' | 'team' | null; owner_id: string | null; holders: string[] }>(
    `select i.id, i.key, i.title, i.workspace_id, i.labels ->> 'due' as due, i.owner_kind, i.owner_id, i.holders
       from items i join item_kinds k on k.id = i.kind_id
      where i.org_id = $1 and coalesce(k.definition ->> 'root', k.definition ->> 'base') = any($2::text[]) and i.class not in ('done', 'parked') and i.labels ->> 'due' ~ ${DAY_SQL}
        and ((i.labels ->> 'due' >= $3 and i.labels ->> 'due' < $4) or (i.labels ->> 'due' > $5 and i.labels ->> 'due' between $4 and $6))
      order by i.labels ->> 'due', i.key limit ${NOTICE_MAX}`,
    [orgId, dueBases(), since, today, addDays(since, opts.soonDays), addDays(today, opts.soonDays)],
  );
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    title: r.title,
    workspaceId: r.workspace_id,
    due: r.due,
    status: r.due < today ? 'overdue' : 'soon',
    owner: r.owner_kind && r.owner_id ? { kind: r.owner_kind, id: r.owner_id } : null,
    holders: r.holders,
  }));
}

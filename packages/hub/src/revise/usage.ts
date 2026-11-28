/**
 * What the organization's model spent, added up from the revision rows
 * (revisions from comments and diagrams drawn from words): by person, model, and kind for
 * one month, month by month for the trend, and since a moment for the
 * limits. Months are the estate's, in TIME_ZONE (day.ts). Every token counts toward a limit: fresh input, output, and cached
 * input read or written.
 */
import type { Db } from '../db/db.ts';
import type { RevisionKind } from './repo.ts';
import { addMonths, monthKey, timeZone } from '../day.ts';

/** The SQL sum of every token on a revision row. */
const TOTAL = '(r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens)';

/** Tokens spent since `since`, by one person or, with no person, by the whole organization. */
export async function spentSince(db: Db, orgId: string, userId: string | undefined, since: Date): Promise<number> {
  const rows = userId
    ? await db.query<{ n: string }>(`select coalesce(sum(${TOTAL}), 0)::text as n from revisions r where r.org_id = $1 and r.requested_by = $2 and r.created_at >= $3`, [orgId, userId, since])
    : await db.query<{ n: string }>(`select coalesce(sum(${TOTAL}), 0)::text as n from revisions r where r.org_id = $1 and r.created_at >= $2`, [orgId, since]);
  return Number(rows[0]?.n ?? '0');
}

export interface ModelUse {
  readonly model: string;
  /** What the requests were: revisions from comments, or diagrams drawn from a description. */
  readonly kind: RevisionKind;
  /** Requests of this kind on this model. */
  readonly requests: number;
  readonly accepted: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
}

export interface PersonUse {
  readonly userId: string;
  readonly name: string;
  readonly revisions: number;
  readonly generations: number;
  readonly accepted: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
  readonly lastAt: Date;
  /** The same, split by model and kind, the biggest first. */
  readonly models: readonly ModelUse[];
}

/** Each person's use in the month starting at `month`, split by model and kind, the biggest spender first. */
export async function usageForMonth(db: Db, orgId: string, month: Date): Promise<PersonUse[]> {
  const rows = await db.query<{ user_id: string; name: string; model: string; kind: RevisionKind; requests: string; accepted: string; input: string; output: string; cache_read: string; cache_write: string; last_at: Date }>(
    `select r.requested_by as user_id, coalesce(u.display_name, u.subject) as name, r.model, r.kind, count(*)::text as requests,
            count(*) filter (where r.state = 'accepted')::text as accepted,
            sum(r.input_tokens)::text as input, sum(r.output_tokens)::text as output,
            sum(r.cache_read_tokens)::text as cache_read, sum(r.cache_write_tokens)::text as cache_write, max(r.created_at) as last_at
       from revisions r join users u on u.id = r.requested_by
      where r.org_id = $1 and r.created_at >= $2 and r.created_at < $3
      group by r.requested_by, u.display_name, u.subject, r.model, r.kind`,
    [orgId, month, addMonths(month, 1)],
  );
  const people = new Map<string, { userId: string; name: string; lastAt: Date; models: ModelUse[] }>();
  for (const r of rows) {
    const m: ModelUse = { model: r.model, kind: r.kind, requests: Number(r.requests), accepted: Number(r.accepted), input: Number(r.input), output: Number(r.output), cacheRead: Number(r.cache_read), cacheWrite: Number(r.cache_write), total: 0 };
    const use = { ...m, total: m.input + m.output + m.cacheRead + m.cacheWrite };
    const p = people.get(r.user_id) ?? { userId: r.user_id, name: r.name, lastAt: r.last_at, models: [] };
    p.models.push(use);
    if (r.last_at > p.lastAt) p.lastAt = r.last_at;
    people.set(r.user_id, p);
  }
  const sum = (ms: readonly ModelUse[], k: keyof Omit<ModelUse, 'model' | 'kind'>): number => ms.reduce((n, m) => n + m[k], 0);
  const count = (ms: readonly ModelUse[], kind: RevisionKind): number => ms.filter((m) => m.kind === kind).reduce((n, m) => n + m.requests, 0);
  return [...people.values()]
    .map((p) => ({ ...p, models: p.models.sort((a, b) => b.total - a.total), revisions: count(p.models, 'revise'), generations: count(p.models, 'generate'), accepted: sum(p.models, 'accepted'), input: sum(p.models, 'input'), output: sum(p.models, 'output'), cacheRead: sum(p.models, 'cacheRead'), cacheWrite: sum(p.models, 'cacheWrite'), total: sum(p.models, 'total') }))
    .sort((a, b) => b.total - a.total);
}

export interface MonthTotal {
  /** YYYY-MM. */
  readonly month: string;
  readonly tokens: number;
  readonly revisions: number;
  readonly generations: number;
  readonly people: number;
}

/** The organization's tokens, revisions, generations, and people for each of the `count` months ending with the one `last` starts, oldest first; a quiet month is zeros. */
export async function monthlyTotals(db: Db, orgId: string, last: Date, count: number): Promise<MonthTotal[]> {
  const first = addMonths(last, 1 - count);
  const rows = await db.query<{ month: string; tokens: string; revisions: string; generations: string; people: string }>(
    `select to_char(date_trunc('month', r.created_at at time zone $4), 'YYYY-MM') as month, sum(${TOTAL})::text as tokens,
            count(*) filter (where r.kind = 'revise')::text as revisions, count(*) filter (where r.kind = 'generate')::text as generations, count(distinct r.requested_by)::text as people
       from revisions r where r.org_id = $1 and r.created_at >= $2 and r.created_at < $3 group by 1`,
    [orgId, first, addMonths(last, 1), timeZone()],
  );
  const by = new Map(rows.map((r) => [r.month, r]));
  return Array.from({ length: count }, (_, i) => {
    const key = monthKey(addMonths(first, i));
    const r = by.get(key);
    return { month: key, tokens: Number(r?.tokens ?? 0), revisions: Number(r?.revisions ?? 0), generations: Number(r?.generations ?? 0), people: Number(r?.people ?? 0) };
  });
}

/** One line per person and model, for a spreadsheet or a chargeback. */
export function usageCsv(month: string, people: readonly PersonUse[]): string {
  const cell = (v: string | number): string => (typeof v === 'number' ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [['month', 'person', 'model', 'kind', 'requests', 'accepted', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'total_tokens']];
  for (const p of people) for (const m of p.models) lines.push([month, p.name, m.model, m.kind, m.requests, m.accepted, m.input, m.output, m.cacheRead, m.cacheWrite, m.total].map(cell));
  return lines.map((l) => l.join(',')).join('\n') + '\n';
}

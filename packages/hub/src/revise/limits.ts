/**
 * What revisions may spend. An admin sets the defaults for each person (a
 * daily and a monthly cap), a monthly cap for the whole organization, and
 * any person's own caps or a block. Without settings the deployment's
 * AI_DAILY_TOKENS is the daily cap and nothing else is capped. A day
 * starts at midnight and a month on the first, in the estate's TIME_ZONE.
 */
import { z } from 'zod';
import type { Config } from '../config.ts';
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { HttpError } from '../http.ts';
import { spentSince } from './usage.ts';
import { dayStart, monthStart, timeZone } from '../day.ts';

/** A cap in tokens; null is no cap. */
const Cap = z.number().int().positive().max(2_000_000_000).nullable();

export const OrgLimitsSchema = z.object({ daily: Cap, monthly: Cap, orgMonthly: Cap });
export const PersonLimitsSchema = z.object({ daily: Cap.optional(), monthly: Cap.optional(), blocked: z.boolean().default(false) });

export type OrgLimits = z.infer<typeof OrgLimitsSchema>;

export interface PersonLimits {
  readonly userId: string;
  readonly name: string;
  /** Undefined keeps the default. */
  readonly daily: number | null | undefined;
  readonly monthly: number | null | undefined;
  readonly blocked: boolean;
}

/** Share of a cap past which a person is warned. */
export const WARN_AT = 0.8;

export async function orgLimits(db: Db, config: Config, orgId: string): Promise<OrgLimits> {
  const row = await maybe<{ daily_tokens: number | null; monthly_tokens: number | null; org_monthly_tokens: string | null }>(db, 'select daily_tokens, monthly_tokens, org_monthly_tokens from ai_limits where org_id = $1', [orgId]);
  if (!row) return { daily: config.AI_DAILY_TOKENS, monthly: null, orgMonthly: null };
  return { daily: row.daily_tokens, monthly: row.monthly_tokens, orgMonthly: row.org_monthly_tokens === null ? null : Number(row.org_monthly_tokens) };
}

export async function setOrgLimits(db: Db, orgId: string, by: string, l: OrgLimits): Promise<void> {
  await db.query(
    `insert into ai_limits (org_id, daily_tokens, monthly_tokens, org_monthly_tokens, updated_by) values ($1, $2, $3, $4, $5)
       on conflict (org_id) do update set daily_tokens = excluded.daily_tokens, monthly_tokens = excluded.monthly_tokens, org_monthly_tokens = excluded.org_monthly_tokens, updated_by = excluded.updated_by, updated_at = now()`,
    [orgId, l.daily, l.monthly, l.orgMonthly, by],
  );
}

/** Every person with limits of their own. A stored null keeps the default, so it reads back as undefined. */
export async function personLimits(db: Db, orgId: string): Promise<PersonLimits[]> {
  const rows = await db.query<{ user_id: string; name: string; daily_tokens: number | null; monthly_tokens: number | null; blocked: boolean }>(
    'select l.user_id, coalesce(u.display_name, u.subject) as name, l.daily_tokens, l.monthly_tokens, l.blocked from ai_user_limits l join users u on u.id = l.user_id where l.org_id = $1 order by 2',
    [orgId],
  );
  return rows.map((r) => ({ userId: r.user_id, name: r.name, daily: r.daily_tokens ?? undefined, monthly: r.monthly_tokens ?? undefined, blocked: r.blocked }));
}

/** Sets a person's own caps; a cap left out keeps the default. */
export async function setPersonLimits(db: Db, orgId: string, userId: string, by: string, l: z.infer<typeof PersonLimitsSchema>): Promise<void> {
  const user = await maybe(db, 'select 1 as x from users where id = $1 and org_id = $2', [userId, orgId]);
  if (!user) throw new HttpError(404, 'user not found');
  await db.query(
    `insert into ai_user_limits (org_id, user_id, daily_tokens, monthly_tokens, blocked, updated_by) values ($1, $2, $3, $4, $5, $6)
       on conflict (org_id, user_id) do update set daily_tokens = excluded.daily_tokens, monthly_tokens = excluded.monthly_tokens, blocked = excluded.blocked, updated_by = excluded.updated_by, updated_at = now()`,
    [orgId, userId, l.daily ?? null, l.monthly ?? null, l.blocked, by],
  );
}

/** Puts a person back on the defaults. */
export async function clearPersonLimits(db: Db, orgId: string, userId: string): Promise<void> {
  await db.query('delete from ai_user_limits where org_id = $1 and user_id = $2', [orgId, userId]);
}

export interface Allowance {
  readonly blocked: boolean;
  readonly today: number;
  readonly daily: number | null;
  readonly month: number;
  readonly monthly: number | null;
  readonly orgMonth: number;
  readonly orgMonthly: number | null;
  /** The estate's time zone, in which `today` and `month` are counted. */
  readonly timeZone: string;
}

/** What a person has spent against each cap that applies to them. */
export async function allowance(db: Db, config: Config, orgId: string, userId: string, now = new Date()): Promise<Allowance> {
  const [org, own, today, month, orgMonth] = await Promise.all([
    orgLimits(db, config, orgId),
    maybe<{ daily_tokens: number | null; monthly_tokens: number | null; blocked: boolean }>(db, 'select daily_tokens, monthly_tokens, blocked from ai_user_limits where org_id = $1 and user_id = $2', [orgId, userId]),
    spentSince(db, orgId, userId, dayStart(now)),
    spentSince(db, orgId, userId, monthStart(now)),
    spentSince(db, orgId, undefined, monthStart(now)),
  ]);
  return { blocked: own?.blocked ?? false, today, daily: own?.daily_tokens ?? org.daily, month, monthly: own?.monthly_tokens ?? org.monthly, orgMonth, orgMonthly: org.orgMonthly, timeZone: timeZone() };
}

/** Why a person may not start a revision now, as the error to answer; undefined when they may. */
export function refusal(a: Allowance): HttpError | undefined {
  if (a.blocked) return new HttpError(403, 'an admin turned the model off for you');
  if (a.orgMonthly !== null && a.orgMonth >= a.orgMonthly) return new HttpError(429, `the organization has used this month's model tokens; the limit resets on the first of the month (${a.timeZone})`);
  if (a.monthly !== null && a.month >= a.monthly) return new HttpError(429, `you have used this month's model tokens; the limit resets on the first of the month (${a.timeZone})`);
  if (a.daily !== null && a.today >= a.daily) return new HttpError(429, `you have used today's model tokens; the limit resets at midnight (${a.timeZone})`);
  return undefined;
}

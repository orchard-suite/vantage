/**
 * What the revise section says about the reader's limits: what stops them
 * now, the warning once a limit is 80% spent, and the plain line of what
 * they have used. The hub's limits are the ones that count; this only says
 * them.
 */
import type { Allowance } from './hub.ts';

/** Share of a limit past which the reader is warned. */
const WARN_AT = 0.8;

export interface AllowanceNote {
  /** Why a revision cannot start now; undefined when it can. */
  readonly stop?: string;
  /** A limit that is nearly spent. */
  readonly warn?: string;
  /** What the reader has used today and this month. */
  readonly line: string;
}

export function tokens(n: number): string {
  return n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n);
}

export function allowanceNote(a: Allowance): AllowanceNote {
  const line = `${tokens(a.today)}${a.daily !== null ? ` of ${tokens(a.daily)}` : ''} tokens used today, ${tokens(a.month)}${a.monthly !== null ? ` of ${tokens(a.monthly)}` : ''} this month.`;
  if (a.blocked) return { stop: 'An admin turned the model off for you.', line };
  const limits = [
    { used: a.orgMonth, cap: a.orgMonthly, stop: "The organization has used this month's model tokens. The limit resets on the first of the month (UTC).", warn: (p: number) => `The organization has used ${p}% of this month's model tokens.` },
    { used: a.month, cap: a.monthly, stop: "You have used this month's tokens. The limit resets on the first of the month (UTC).", warn: (p: number) => `You have used ${p}% of this month's tokens.` },
    { used: a.today, cap: a.daily, stop: "You have used today's tokens. The limit resets at midnight UTC.", warn: (p: number) => `You have used ${p}% of today's tokens.` },
  ];
  const spent = limits.find((l) => l.cap !== null && l.used >= l.cap);
  if (spent) return { stop: spent.stop, line };
  const near = limits.filter((l) => l.cap !== null && l.used >= l.cap * WARN_AT).sort((x, y) => y.used / y.cap! - x.used / x.cap!)[0];
  return near ? { warn: near.warn(Math.floor((near.used / near.cap!) * 100)), line } : { line };
}

/** The allowance after a revision spent `n` more tokens. */
export function spend(a: Allowance, n: number): Allowance {
  return { ...a, today: a.today + n, month: a.month + n, orgMonth: a.orgMonth + n };
}

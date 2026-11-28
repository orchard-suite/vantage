/**
 * A five-field cron matcher: minute, hour, day of month, month, day of
 * week. Supports `*`, numbers, ranges, lists, and steps, which covers what
 * the nightly review or a publication trigger needs. The fields read the
 * wall clock in the estate's time zone (TIME_ZONE), so `0 3 * * *` is three
 * at night where the estate is. A minute the clock skips in spring fires in
 * the first minute after the skip; a minute it shows twice in autumn fires
 * the first time only.
 */
import { instantOf, offsetAt, wallOf } from '../day.ts';

export interface CronExpr {
  readonly minute: ReadonlySet<number>;
  readonly hour: ReadonlySet<number>;
  readonly dayOfMonth: ReadonlySet<number>;
  readonly month: ReadonlySet<number>;
  readonly dayOfWeek: ReadonlySet<number>;
  readonly text: string;
}

const RANGES: readonly { name: keyof Omit<CronExpr, 'text'>; min: number; max: number }[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dayOfWeek', min: 0, max: 6 },
];

export class CronError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CronError';
  }
}

function parseField(field: string, min: number, max: number, label: string): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [rangeText, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new CronError(`${label}: bad step in ${part}`);
    let lo: number;
    let hi: number;
    if (rangeText === '*' || rangeText === '') {
      lo = min;
      hi = max;
    } else if (rangeText!.includes('-')) {
      const [a, b] = rangeText!.split('-').map(Number);
      if (a === undefined || b === undefined || !Number.isInteger(a) || !Number.isInteger(b)) throw new CronError(`${label}: bad range ${part}`);
      lo = a;
      hi = b;
    } else {
      const n = Number(rangeText);
      if (!Number.isInteger(n)) throw new CronError(`${label}: ${part} is not a number`);
      lo = n;
      hi = stepText === undefined ? n : max;
    }
    if (lo < min || hi > max || lo > hi) throw new CronError(`${label}: ${part} is outside ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) out.add(v === 7 && label === 'dayOfWeek' ? 0 : v);
  }
  return out;
}

export function parseCron(text: string): CronExpr {
  const fields = text.trim().split(/\s+/);
  if (fields.length !== 5) throw new CronError(`expected five fields, got ${fields.length}: ${text}`);
  const parsed: Partial<Record<keyof Omit<CronExpr, 'text'>, Set<number>>> = {};
  RANGES.forEach((r, i) => {
    parsed[r.name] = parseField(fields[i]!, r.min, r.max === 6 ? 7 : r.max, r.name);
  });
  return { minute: parsed.minute!, hour: parsed.hour!, dayOfMonth: parsed.dayOfMonth!, month: parsed.month!, dayOfWeek: parsed.dayOfWeek!, text: text.trim() };
}

const MINUTE = 60_000;
const HOUR = 3_600_000;

/**
 * The wall-clock minutes, as Dates whose UTC fields read the estate's
 * clock, that the minute containing `at` stands for: one most of the time,
 * none when the clock shows that minute a second time, and every skipped
 * minute with it when the clock has just jumped ahead.
 */
export function wallMinutes(at: Date): Date[] {
  const t = Math.floor(at.getTime() / MINUTE) * MINUTE;
  const drop = offsetAt(t - HOUR) - offsetAt(t);
  if (drop > 0 && offsetAt(t - drop) > offsetAt(t)) return [];
  const now = wallOf(t).getTime();
  const out: Date[] = [];
  for (let w = wallOf(t - MINUTE).getTime() + MINUTE; w <= now; w += MINUTE) out.push(new Date(w));
  return out.length ? out : [new Date(now)];
}

const fires = (e: CronExpr, w: Date): boolean => e.minute.has(w.getUTCMinutes()) && e.hour.has(w.getUTCHours()) && e.dayOfMonth.has(w.getUTCDate()) && e.month.has(w.getUTCMonth() + 1) && e.dayOfWeek.has(w.getUTCDay());

/** Whether the expression fires in the minute containing `at`, read on the estate's wall clock. */
export function cronMatches(expr: CronExpr | string, at: Date): boolean {
  const e = typeof expr === 'string' ? parseCron(expr) : expr;
  return wallMinutes(at).some((w) => fires(e, w));
}

/** The start of the first minute after `after` in which the expression fires; undefined when it fires on no day in the next four years. */
export function nextFire(expr: CronExpr | string, after: Date): Date | undefined {
  const e = typeof expr === 'string' ? parseCron(expr) : expr;
  const start = Math.floor(after.getTime() / MINUTE) * MINUTE + MINUTE;
  const end = wallOf(start).getTime() + 4 * 366 * 24 * HOUR;
  let w = wallOf(start).getTime();
  while (w < end) {
    const d = new Date(w);
    if (!e.month.has(d.getUTCMonth() + 1)) w = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    else if (!e.dayOfMonth.has(d.getUTCDate()) || !e.dayOfWeek.has(d.getUTCDay())) w = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    else if (!e.hour.has(d.getUTCHours())) w = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours() + 1);
    else if (!e.minute.has(d.getUTCMinutes())) w += MINUTE;
    else {
      // The reading's instant, or, for a reading the clock skips, the first minute after the skip.
      let t = Math.max(instantOf(w).getTime(), start);
      while (wallOf(t - MINUTE).getTime() >= w && t - MINUTE >= start) t -= MINUTE;
      if (cronMatches(e, new Date(t))) return new Date(t);
      w += MINUTE;
    }
  }
  return undefined;
}

/** Returns a problem message, or undefined when the expression is valid. */
export function cronProblem(text: string): string | undefined {
  try {
    parseCron(text);
    return undefined;
  } catch (err) {
    return (err as Error).message;
  }
}

/** The UTC minute `at` falls in, as the key the scheduler uses to enqueue once per minute. */
export function minuteKey(at: Date): string {
  return at.toISOString().slice(0, 16);
}

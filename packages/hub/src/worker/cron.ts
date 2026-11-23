/**
 * A five-field cron matcher: minute, hour, day of month, month, day of
 * week. Supports `*`, numbers, ranges, lists, and steps, which covers what
 * a source schedule or a publication trigger needs. Times are UTC.
 */
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

/** Whether the expression fires in the minute containing `at` (UTC). */
export function cronMatches(expr: CronExpr | string, at: Date): boolean {
  const e = typeof expr === 'string' ? parseCron(expr) : expr;
  return e.minute.has(at.getUTCMinutes()) && e.hour.has(at.getUTCHours()) && e.dayOfMonth.has(at.getUTCDate()) && e.month.has(at.getUTCMonth() + 1) && e.dayOfWeek.has(at.getUTCDay());
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

/** The minute `at` falls in, as the key the scheduler uses to enqueue once per minute. */
export function minuteKey(at: Date): string {
  return at.toISOString().slice(0, 16);
}

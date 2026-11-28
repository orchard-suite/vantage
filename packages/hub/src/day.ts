/**
 * The hub's calendar: every day, month, and clock time the hub works out
 * for itself, in the estate's time zone (TIME_ZONE, UTC when unset).
 * Instants are stored in UTC; this is where one becomes something a person
 * reads (a record's Last updated when a write leaves it out, an import's
 * date, a published copy's date, the dates and times on pages, outlines,
 * and text answers) or a boundary the hub counts from (the day and month
 * an AI token limit resets on, the wall clock a schedule reads).
 * A day a person gave (a label, a record's decided date) is a calendar day
 * already and never passes through here.
 *
 * The zone is set once, from the configuration, before the hub serves.
 */

let zone = 'UTC';

const formats = new Map<string, Intl.DateTimeFormat>();

/** One formatter per zone that reads every field of the wall clock, and the zone's short name. */
function formatFor(tz: string): Intl.DateTimeFormat {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
    formats.set(tz, f);
  }
  return f;
}

/** Why a time zone name is not one the hub can use, or undefined when it is. */
export function zoneProblem(tz: string): string | undefined {
  try {
    formatFor(tz);
    return undefined;
  } catch {
    return `${tz} is not an IANA time zone (America/Chicago, Europe/Berlin, UTC)`;
  }
}

/** Sets the estate's time zone; the hub calls it once, at start. */
export function setTimeZone(tz: string): void {
  const problem = zoneProblem(tz);
  if (problem) throw new Error(problem);
  zone = tz;
}

/** The estate's time zone. */
export const timeZone = (): string => zone;

type When = Date | string | number;

const ms = (at: When): number => (typeof at === 'string' ? Date.parse(at) : +at);

interface Reading {
  /** The wall clock, as milliseconds whose UTC fields read it. */
  readonly wall: number;
  /** The zone's short name at that instant: CST, CDT, UTC, GMT+1. */
  readonly abbr: string;
}

function read(at: number): Reading {
  const p: Record<string, string> = {};
  for (const part of formatFor(zone).formatToParts(at)) p[part.type] = part.value;
  const wall = Date.UTC(Number(p['year']), Number(p['month']) - 1, Number(p['day']), Number(p['hour']), Number(p['minute']), Number(p['second']), ((at % 1000) + 1000) % 1000);
  return { wall, abbr: p['timeZoneName'] ?? zone };
}

/** The estate's wall clock at `at`, as a Date whose UTC fields read it. */
export const wallOf = (at: When = Date.now()): Date => new Date(read(ms(at)).wall);

/** How far the estate's wall clock is ahead of UTC at `at`, in milliseconds. */
export function offsetAt(at: When): number {
  const t = ms(at);
  return read(t).wall - t;
}

const DAY_MS = 86_400_000;

/**
 * The instant the estate's wall clock reads `wall` (milliseconds whose UTC
 * fields hold the reading). A reading the clock shows twice gives the first;
 * one it skips is read with the offset from before the skip, so midnight on a
 * day that starts at one gives the day's first instant.
 */
export function instantOf(wall: number): Date {
  const before = offsetAt(wall - DAY_MS);
  const after = offsetAt(wall + DAY_MS);
  const fits = [wall - before, wall - after].filter((t) => read(t).wall === wall);
  return new Date(fits.length ? Math.min(...fits) : wall - before);
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** The day `at` falls on in the estate's time zone, as YYYY-MM-DD; today when `at` is left out. */
export function dayOf(at: When = Date.now()): string {
  return new Date(read(ms(at)).wall).toISOString().slice(0, 10);
}

/** `at` as a person reads it: the day and the minute in the estate's time zone, with the zone's short name (2026-11-27 19:05 CST). */
export function clockOf(at: When): string {
  const r = read(ms(at));
  const w = new Date(r.wall);
  return `${w.toISOString().slice(0, 10)} ${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())} ${r.abbr}`;
}

/** The first instant of the estate's day that `at` falls on. */
export function dayStart(at: When = Date.now()): Date {
  const w = wallOf(at);
  return instantOf(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()));
}

/** The first instant of the estate's month that `at` falls on. */
export function monthStart(at: When = Date.now()): Date {
  const w = wallOf(at);
  return instantOf(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), 1));
}

/** The first instant of the month `n` months after the one `month` falls in (negative goes back). */
export function addMonths(month: When, n: number): Date {
  const w = wallOf(month);
  return instantOf(Date.UTC(w.getUTCFullYear(), w.getUTCMonth() + n, 1));
}

/** The estate's month `at` falls in, as YYYY-MM. */
export const monthKey = (at: When): string => dayOf(at).slice(0, 7);

/** The first instant of the month a YYYY-MM names, or undefined when it names none. */
export function parseMonth(key: string): Date | undefined {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
  return m ? instantOf(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)) : undefined;
}

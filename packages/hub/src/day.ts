/**
 * The days the hub works out for itself. A day is the calendar day an
 * instant falls on in the estate's time zone (TIME_ZONE, UTC when unset):
 * a record's Last updated when a write leaves it out, an imported record's
 * date, a published copy's date, and the dates on pages and outlines.
 * A day a person gave (a label, a record's decided date) is a calendar day
 * already and never passes through here.
 *
 * The zone is set once, from the configuration, before the hub serves.
 */

let zone = 'UTC';

const formats = new Map<string, Intl.DateTimeFormat>();

function formatFor(tz: string): Intl.DateTimeFormat {
  let f = formats.get(tz);
  if (!f) {
    // en-CA writes a date as YYYY-MM-DD.
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
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

/** The day `at` falls on in the estate's time zone, as YYYY-MM-DD; today when `at` is left out. */
export function dayOf(at: Date | string | number = Date.now()): string {
  return formatFor(zone).format(typeof at === 'string' ? Date.parse(at) : at);
}

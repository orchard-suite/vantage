/**
 * How a decision record is cited. A record lives in a registry, which has
 * a short upper-case prefix that never changes. Three forms:
 *
 * - `SHOP-2001`: the registry's prefix and the record's four-digit number.
 *   This is the form documents and pages use, and the form any record uses
 *   for a record in another registry.
 * - `ADR-2001`: the local form, only inside a record body, for a record in
 *   the same registry.
 * - `adr:01JD3K5Q9W8X2Y4Z6A7B8C9D0E`: the machine form, the record's ULID.
 *   It survives anything, including a move to another registry.
 *
 * Numbers are four digits: the first is the category, the last three run
 * in order within the category.
 */

export const LOCAL_PREFIX = 'ADR';

/** A registry prefix: a letter, then letters and digits, two to twelve long. `ADR` is the local form and is never a prefix. */
export const PREFIX_PATTERN = /^[A-Z][A-Z0-9]{1,11}$/;

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export type DecisionRef =
  | { readonly kind: 'qualified'; readonly prefix: string; readonly number: number }
  | { readonly kind: 'local'; readonly number: number }
  | { readonly kind: 'machine'; readonly id: string };

export function isRegistryPrefix(prefix: string): boolean {
  return PREFIX_PATTERN.test(prefix) && prefix !== LOCAL_PREFIX;
}

export function isUlid(id: string): boolean {
  return ULID.test(id);
}

/** Reads a citation in any of its three forms; undefined when it is none of them. */
export function parseDecisionRef(text: string): DecisionRef | undefined {
  const t = text.trim();
  if (/^adr:/i.test(t)) {
    const id = t.slice(4).toUpperCase();
    return isUlid(id) ? { kind: 'machine', id } : undefined;
  }
  const m = /^([A-Z][A-Z0-9]{1,11})-(\d{4})$/.exec(t);
  if (!m) return undefined;
  const number = Number(m[2]);
  return m[1] === LOCAL_PREFIX ? { kind: 'local', number } : { kind: 'qualified', prefix: m[1]!, number };
}

export function formatNumber(number: number): string {
  return String(number).padStart(4, '0');
}

/** `SHOP-2001`. */
export function qualifiedRef(prefix: string, number: number): string {
  return `${prefix}-${formatNumber(number)}`;
}

/** `ADR-2001`. */
export function localRef(number: number): string {
  return `${LOCAL_PREFIX}-${formatNumber(number)}`;
}

/** `adr:<ULID>`. */
export function machineRef(id: string): string {
  return `adr:${id}`;
}

/** What a document may cite: the qualified form or the machine form. A document is in no registry, so the local form is refused. */
export function citableRef(text: string): DecisionRef | undefined {
  const r = parseDecisionRef(text);
  return r && r.kind !== 'local' ? r : undefined;
}

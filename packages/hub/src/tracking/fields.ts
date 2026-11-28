/**
 * A read asked for by field (VAN-5001): get and find answer only
 * the fields the caller names, and always the key that names the item.
 */
import { badRequest } from '../http.ts';
import type { Card, Row } from './read.ts';

/** The fields a card answers; `body` rides beside the card on a get. */
export const CARD_FIELDS: readonly (keyof Card)[] = ['key', 'kind', 'kindName', 'title', 'state', 'stateText', 'class', 'since', 'asker', 'owner', 'scope', 'delegated', 'holders', 'labels', 'ref', 'revision', 'parent', 'counts', 'moves', 'version', 'hasBody', 'proof', 'claim', 'runs', 'span', 'milestone'];

/** The fields a row of a list answers. */
export const ROW_FIELDS: readonly (keyof Row)[] = ['key', 'title', 'state', 'class', 'holders', 'owner', 'run', 'labels', 'updated', 'proofAt', 'span'];

/** The named fields of a card or a row, and its key; every field when none are named. A field it does not have is refused by name. */
export function pick<T extends { readonly key: string }>(from: T, fields: readonly string[] | undefined, known: readonly (keyof T)[]): Partial<T> & { key: string } {
  if (!fields) return from;
  const bad = fields.filter((f) => !(known as readonly string[]).includes(f));
  if (bad.length) throw badRequest(`no field ${bad.join(', ')}; the fields are ${known.join(', ')}`);
  const out: Partial<T> & { key: string } = { key: from.key } as Partial<T> & { key: string };
  for (const f of fields as (keyof T)[]) if (from[f] !== undefined) out[f] = from[f];
  return out;
}

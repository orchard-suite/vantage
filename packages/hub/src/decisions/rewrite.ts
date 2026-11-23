/**
 * How citation text changes when a record moves, so every citation keeps
 * its meaning. A document cites in the qualified form only. A record's
 * prose may also cite ADR-NNNN, which means a record of its own registry:
 * when the moved record leaves its registry, its own local citations of
 * the records it left behind become qualified, and a local citation of it
 * from a record that stays behind becomes its new qualified citation. The
 * machine form adr:<ULID> never changes.
 */
import { LOCAL_PREFIX, formatNumber, localRef, qualifiedRef } from '@vantage/model';

export interface Move {
  readonly fromRegistry: string;
  readonly fromPrefix: string;
  readonly fromNumber: number;
  readonly toRegistry: string;
  readonly toPrefix: string;
  readonly toNumber: number;
}

/** Where the prose being rewritten sits: the registry it was written in, and whether it is the moved record's own. */
export interface Writer {
  readonly registry: string;
  readonly self: boolean;
}

const TOKEN = /(?<![A-Za-z0-9-])([A-Z][A-Z0-9]{1,11})-(\d{4})(?![0-9A-Za-z])/g;

export const fromRef = (m: Move): string => qualifiedRef(m.fromPrefix, m.fromNumber);
export const toRef = (m: Move): string => qualifiedRef(m.toPrefix, m.toNumber);

/** Document text (YAML, imports, pages): each qualified citation of the old number becomes the new one. */
export function rewriteDocumentText(text: string, m: Move): string {
  const from = fromRef(m);
  return text.replace(TOKEN, (all, prefix: string, num: string) => (`${prefix}-${num}` === from ? toRef(m) : all));
}

/** Record prose: the qualified and local citations of the moved record, and the moved record's own local citations when it leaves its registry. */
export function rewriteRecordText(text: string, m: Move, w: Writer): string {
  const after = w.self ? m.toRegistry : w.registry;
  return text.replace(TOKEN, (all, prefix: string, num: string) => {
    const n = Number(num);
    if (prefix !== LOCAL_PREFIX) return prefix === m.fromPrefix && n === m.fromNumber ? toRef(m) : all;
    if (w.registry === m.fromRegistry && n === m.fromNumber) return after === m.toRegistry ? localRef(m.toNumber) : toRef(m);
    if (w.self && m.fromRegistry !== m.toRegistry) return `${m.fromPrefix}-${formatNumber(n)}`;
    return all;
  });
}

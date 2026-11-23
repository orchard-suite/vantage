/**
 * The pieces of PlantUML syntax its diagram kinds share: a declaration's
 * name and alias, and an arrow line with its endpoints, heads, and label.
 */
import { edgeLabel, unquote } from './text-diagram.ts';

export const strip = (s: string): string => {
  const t = s.trim();
  if ((t.startsWith('[') && t.endsWith(']')) || (t.startsWith(':') && t.endsWith(':') && t.length > 1)) return t.slice(1, -1).trim();
  return unquote(t);
};
const wrapped = (s: string): boolean => /^(".*"|\[.*\]|:.*:)$/.test(s.trim());

/** A declaration's name part to its key, its label, and its stereotype. */
export function declName(rest: string): { key: string; label: string; stereotype: string | undefined } {
  let stereotype: string | undefined;
  const cleaned = rest
    .replace(/<<\s*([^>]*?)\s*>>/g, (_, s: string) => {
      stereotype ??= s;
      return ' ';
    })
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .replace(/\s#[\w#;:.]+/g, ' ')
    .replace(/\s+order\s+-?\d+/, ' ')
    .trim();
  const m = /^(".*?"|\[.*?\]|:.*?:|\S+)(?:\s+as\s+(".*?"|\[.*?\]|\S+))?/.exec(cleaned);
  if (!m) return { key: cleaned, label: cleaned, stereotype };
  const a = m[1]!, b = m[2];
  if (b === undefined) return { key: strip(a), label: strip(a), stereotype };
  return wrapped(b) && !wrapped(a) ? { key: a, label: strip(b), stereotype } : { key: strip(b), label: strip(a), stereotype };
}

const ENDPOINT = /(\[[^\]]+\]|"[^"]+"|\(\)\s*"[^"]+"|\(\)\s*[\p{L}\p{N}_]+(?:\.[\p{L}\p{N}_]+)*|:[^:]+:|[\p{L}\p{N}_]+(?:\.[\p{L}\p{N}_]+)*)/uy;
/** PlantUML arrow: optional head, a body of dashes or dots with optional `[style]` and direction words, optional head. */
export const ARROW = /\s*(<<?|[*o+#^]|\\\\|\/\/)?((?:[-.=~]|\[[^\]]*\]|(?:up|down|left|right|u|d|l|r)(?=[-.[]))*[-.](?:[-.=~]|\[[^\]]*\])*)(>>?|[*o+#^x]|\\\\|\/\/)?\s*/uy;

export interface Arrow {
  readonly from: string;
  readonly to: string;
  readonly start: string;
  readonly body: string;
  readonly end: string;
  readonly label: string | undefined;
  /** What follows the second endpoint before the label: `++`, `--`, `**`, `!!` in sequences. */
  readonly marks: string;
}

/** `A -[#red]-> B : label` to its parts; undefined when the line is not an arrow. */
export function readArrow(line: string): Arrow | undefined {
  ENDPOINT.lastIndex = 0;
  const a = ENDPOINT.exec(line);
  if (!a) return undefined;
  ARROW.lastIndex = ENDPOINT.lastIndex;
  const arrow = ARROW.exec(line);
  if (!arrow || !arrow[2]) return undefined;
  ENDPOINT.lastIndex = ARROW.lastIndex;
  const b = ENDPOINT.exec(line);
  if (!b) return undefined;
  const tail = /^\s*((?:\+\+|--|\*\*|!!)?)\s*(?::\s*(.*))?$/.exec(line.slice(ENDPOINT.lastIndex));
  if (!tail) return undefined;
  return { from: a[1]!, to: b[1]!, start: arrow[1] ?? '', body: arrow[2], end: arrow[3] ?? '', label: edgeLabel(tail[2]), marks: tail[1] ?? '' };
}

/**
 * The parts of a Markdown text: its headings as names an address can carry
 * after `#`, each with the lines of its section. Used for pages, decision
 * records, and the guide, so a part is named the same way in all of them.
 */

export interface Heading {
  readonly level: number;
  readonly title: string;
  /** The name after `#` in an address. */
  readonly slug: string;
  /** First line of the section, counting from 1: the heading itself. */
  readonly from: number;
  /** Last line of the section: the line before the next heading of the same or a higher level. */
  readonly to: number;
  readonly chars: number;
}

/** A heading's name in an address: lower case, words joined by dashes. */
export function headingSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Every heading outside a code fence, in order. A heading that carries `{#id}` is named by that id; a repeated name gains -2, -3. */
export function headings(text: string): Heading[] {
  const lines = text.split('\n');
  const found: { level: number; title: string; slug: string; from: number }[] = [];
  const seen = new Map<string, number>();
  let fence: string | undefined;
  lines.forEach((line, i) => {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (!fence) fence = f[1]![0];
      else if (f[1]![0] === fence) fence = undefined;
      return;
    }
    if (fence) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) return;
    const explicit = /\s*\{#([^}]+)\}\s*$/.exec(m[2]!);
    const title = explicit ? m[2]!.slice(0, explicit.index) : m[2]!;
    const base = explicit ? explicit[1]! : headingSlug(title) || 'section';
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    found.push({ level: m[1]!.length, title, slug: n === 1 ? base : `${base}-${n}`, from: i + 1 });
  });
  return found.map((h, i) => {
    const next = found.slice(i + 1).find((x) => x.level <= h.level);
    const to = next ? next.from - 1 : lines.length - (lines[lines.length - 1] === '' ? 1 : 0);
    return { ...h, to, chars: lines.slice(h.from - 1, to).join('\n').length };
  });
}

export interface Range {
  readonly from: number;
  readonly to: number;
}

/** `L12`, `L12-40`: a range of lines an address names after `#`. */
export function lineRange(part: string, total: number): Range | undefined {
  const m = /^L(\d+)(?:-(\d+))?$/i.exec(part);
  if (!m) return undefined;
  const from = Math.max(1, Number(m[1]));
  const to = Math.min(total, m[2] ? Number(m[2]) : from);
  return from <= to ? { from, to } : undefined;
}

/** The lines `from` to `to` of a text, counting from 1. */
export function sliceLines(text: string, range: Range): string {
  return text.split('\n').slice(range.from - 1, range.to).join('\n');
}

/** How many lines a text has; a final line break ends the last line and starts no new one. */
export function countLines(text: string): number {
  if (text === '') return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

/** A Markdown part as lines: a line range, or the section of the heading with that name. */
export function markdownRange(text: string, part: string): Range | undefined {
  const lines = lineRange(part, countLines(text));
  if (lines) return lines;
  const h = headings(text).find((x) => x.slug === part.toLowerCase());
  return h ? { from: h.from, to: h.to } : undefined;
}

const n = (x: number): string => x.toLocaleString('en-US');

/** One line per heading: its name, its lines, and its size, indented by level. `maxLevel` leaves the deeper ones out. */
export function headingOutline(text: string, maxLevel = 6): string[] {
  return headings(text)
    .filter((h) => h.level <= maxLevel)
    .map((h) => `${'  '.repeat(Math.max(0, h.level - 1))}#${h.slug}  ${h.title}  L${h.from}-${h.to}  ${n(h.chars)} chars`);
}

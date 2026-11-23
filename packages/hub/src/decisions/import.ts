/**
 * Reads decision records kept as Markdown files in a repository (the
 * Nygard and MADR shapes, a metadata table, front matter, or plain
 * headings) into what a Vantage record holds. Pure: no database. What it
 * cannot place it keeps, under the Decision as a heading of its own, and
 * says so in `notes`, so nothing is lost and nothing is silent.
 */
import type { Alternative, DecisionStatus } from './types.ts';

export interface ImportFile {
  /** The file's path in the repository, kept so links to it can be repointed. */
  readonly path: string;
  readonly text: string;
}

export interface ParsedRecord {
  readonly path: string;
  readonly number: number | undefined;
  readonly title: string;
  readonly status: DecisionStatus;
  readonly decidedOn: string | undefined;
  readonly updatedOn: string | undefined;
  readonly deciders: readonly string[];
  readonly context: string;
  readonly decision: string;
  readonly consequences: string;
  readonly alternatives: readonly Alternative[];
  /** Numbers of the records this one supersedes, or is superseded by, as the file says. */
  readonly supersedes: readonly number[];
  readonly supersededBy: readonly number[];
  readonly related: readonly number[];
  /** What the importer could not map, in words a person reads. */
  readonly notes: readonly string[];
}

const DAY = /\b(\d{4}-\d{2}-\d{2})\b/;

/** A link to a record file: [x](2001-title.md), [x](../adr/adr-0007-y.md#why). */
const RECORD_LINK = /\[[^\]]*\]\((?:[^)]*\/)?(?:adr-)?(\d{1,4})[-_][^)]*\.md(?:#[^)]*)?\)/gi;

/** A citation by number: ADR-2001 or ADR 7, and `<prefix>-2001` for the registry the records go into. */
function citationPattern(prefix: string | undefined): RegExp {
  return prefix ? new RegExp(`\\b(?:ADR[-\\s]?|${prefix}-)(\\d{1,4})\\b`, 'gi') : /\bADR[-\s]?(\d{1,4})\b/gi;
}

/** Record numbers a piece of text points at: ADR-2001, ADR 7, [x](2001-title.md), and `<prefix>-2001` when the registry's prefix is given. */
export function numbersIn(text: string, prefix?: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(citationPattern(prefix))) out.add(Number(m[1]));
  for (const m of text.matchAll(RECORD_LINK)) out.add(Number(m[1]));
  return [...out];
}

/** Text with its record citations, record links, and days taken out: what is left is words a person wrote. */
function beyondCitations(text: string, prefix: string | undefined): string {
  return text
    .replace(RECORD_LINK, ' ')
    .replace(citationPattern(prefix), ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function numberFromPath(path: string): number | undefined {
  const base = path.split('/').pop() ?? path;
  const m = /^(?:adr[-_]?)?(\d{1,4})(?:[-_. ]|\.md$)/i.exec(base);
  return m ? Number(m[1]) : undefined;
}

/** An H1 without the citation it starts with: `ADR-0007: X`, `SHOP-2001: X`, `7. X`. */
function cleanTitle(h1: string): { title: string; number?: number } {
  const m = /^(?:[Aa][Dd][Rr][-\s]?|[A-Z][A-Z0-9]{1,11}-)?(\d{1,4})\s*[:.\-–—]\s*(.+)$/.exec(h1.trim());
  return m ? { number: Number(m[1]), title: m[2]!.trim() } : { title: h1.trim() };
}

function titleFromPath(path: string): string {
  const base = (path.split('/').pop() ?? path).replace(/\.md$/i, '').replace(/^(?:adr[-_]?)?\d{1,4}[-_. ]*/i, '');
  const words = base.replace(/[-_]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'Untitled';
}

const STATUS_WORDS: readonly { readonly test: RegExp; readonly status: DecisionStatus; readonly unmatched?: true }[] = [
  // "Superseded" and "replaced by" say this record was replaced; "supersedes" says it replaced another and stands.
  { test: /superseded|replaced by/, status: 'superseded' },
  { test: /deprecat|retired|obsolete/, status: 'deprecated' },
  { test: /reject|declined|withdrawn/, status: 'deprecated', unmatched: true },
  { test: /accept|approved|adopted|decided|implemented|active|done/, status: 'accepted' },
  { test: /propos|draft|pending|review|open/, status: 'proposed' },
];

/** A status line's status. Its first word decides; the rest of the line is read only when that word says nothing. */
export function mapStatus(text: string): { status: DecisionStatus; note?: string } {
  const t = text.toLowerCase();
  const first = /[a-z]+/.exec(t)?.[0] ?? '';
  const hit = STATUS_WORDS.find((w) => w.test.test(first)) ?? STATUS_WORDS.find((w) => w.test.test(t));
  if (hit) return hit.unmatched ? { status: hit.status, note: `status "${text.trim()}" has no match; kept as Deprecated` } : { status: hit.status };
  return { status: 'proposed', note: text.trim() ? `status "${text.trim()}" has no match; kept as Proposed` : 'no status; kept as Proposed' };
}

function people(value: string): string[] {
  return value
    .replace(/\*\*/g, '')
    .split(/\s*(?:,|;|\band\b|&|\n)\s*/i)
    .map((s) => s.replace(/^[-*]\s*/, '').trim())
    .filter((s) => s && !/^(none|n\/a|tbd|-)$/i.test(s));
}

type Key = 'decided' | 'updated' | 'deciders' | 'status' | 'supersedes' | 'supersededBy';

function keyOf(label: string): Key | undefined {
  const k = label.replace(/[*_`:]/g, '').trim().toLowerCase();
  if (/^(decision )?date$|^decided( on)?$|^date decided$/.test(k)) return 'decided';
  if (/^last updated$|^updated( on)?$|^last modified$/.test(k)) return 'updated';
  if (/^decision[- ]makers?$|^deciders$|^decided by$|^owners?$|^approvers?$|^authors?$/.test(k)) return 'deciders';
  if (k === 'status') return 'status';
  if (/^supersedes$/.test(k)) return 'supersedes';
  if (/^superseded[- ]by$/.test(k)) return 'supersededBy';
  return undefined;
}

interface Section {
  readonly heading: string;
  body: string;
}

function sections(body: string): { lead: string; list: Section[] } {
  const list: Section[] = [];
  const lead: string[] = [];
  let current: Section | undefined;
  let fence = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = !fence ? /^##\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (h) {
      current = { heading: h[1]!.trim(), body: '' };
      list.push(current);
    } else if (current) current.body += `${line}\n`;
    else lead.push(line);
  }
  for (const s of list) s.body = s.body.trim();
  return { lead: lead.join('\n'), list };
}

type Slot = 'status' | 'context' | 'decision' | 'consequences' | 'alternatives' | 'related' | 'references' | 'drivers';

function slotOf(heading: string): Slot | undefined {
  const h = heading.replace(/[*_`]/g, '').trim().toLowerCase();
  if (h === 'status') return 'status';
  if (/^context|^problem|^background|^context and problem statement/.test(h)) return 'context';
  if (/^decision drivers/.test(h)) return 'drivers';
  if (/^decision( outcome)?$|^the decision$|^decision made$/.test(h)) return 'decision';
  if (/^consequences|^positive consequences|^negative consequences|^implications/.test(h)) return 'consequences';
  if (/^alternatives|^considered options|^options considered|^pros and cons|^options$|^rejected alternatives/.test(h)) return 'alternatives';
  if (/^references$/.test(h)) return 'references';
  if (/^related|^links$|^see also/.test(h)) return 'related';
  return undefined;
}

/** One bullet as an option and why it lost: `**Option**: why`, `**Option.** why`, `Option: why`, `Option - why`, or a bare option. */
function bulletAlternative(bullet: string): Alternative | undefined {
  const [first = '', ...more] = bullet.split('\n');
  const rest = more.join('\n');
  const join = (head: string): string => [head.trim(), rest.trim()].filter(Boolean).join('\n');
  const bold = /^\*\*(.+?)\*\*\s*(?::|[-–—](?=\s))?\s*(.*)$/.exec(first);
  if (bold) {
    const inner = /^(.+?)\s*[:.\-–—]?\s*$/.exec(bold[1]!)![1]!.trim();
    return inner.length <= 300 ? { option: inner, rejected: join(bold[2]!) } : undefined;
  }
  const plain = /^([^:\n]{1,120}?)\s*(?::|\s[-–—]\s)\s*(.*)$/.exec(first);
  if (plain) return { option: plain[1]!.trim(), rejected: join(plain[2]!) };
  return first.trim() && first.trim().length <= 300 ? { option: first.trim(), rejected: rest.trim() } : undefined;
}

/** The bullets of a list, each with its indented continuation lines; undefined when the text is not one list. */
function bulletsOf(text: string): string[] | undefined {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) out.push(item[1]!);
    else if (!out.length) {
      if (line.trim()) return undefined;
    } else out[out.length - 1] += `\n${line.replace(/^\s{1,4}/, '')}`;
  }
  return out.length ? out.map((b) => b.trim()) : undefined;
}

/** `### Option` blocks, or one alternative per bullet (`- **Option.** why`); else the text as one alternative, with a note. */
export function alternativesFrom(text: string, notes: string[]): Alternative[] {
  const t = text.trim();
  if (!t) return [];
  const blocks = t.split(/^###\s+/m);
  if (blocks.length > 1) {
    const out: Alternative[] = [];
    if (blocks[0]!.trim()) notes.push('text before the first alternative heading was kept with the first alternative');
    blocks.slice(1).forEach((b, i) => {
      const [head, ...rest] = b.split('\n');
      const body = rest.join('\n').trim();
      out.push({ option: head!.replace(/#+\s*$/, '').trim(), rejected: i === 0 && blocks[0]!.trim() ? `${blocks[0]!.trim()}\n\n${body}` : body });
    });
    return out;
  }
  const bullets = bulletsOf(t)?.map(bulletAlternative);
  if (bullets?.every((a) => a !== undefined)) return bullets as Alternative[];
  notes.push('alternatives were not one per heading or bullet; kept as one alternative, as written');
  return [{ option: 'Alternatives as recorded', rejected: t }];
}

function frontMatter(text: string): { fields: Record<string, string>; rest: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { fields: {}, rest: text };
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    const kv = /^([A-Za-z][\w -]*):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]!.trim()] = kv[2]!.replace(/^["']|["']$/g, '').trim();
  }
  return { fields, rest: text.slice(m[0].length) };
}

/** The lead between the title and the first section, without the metadata it carried: a metadata table, `Key: value` lines the importer read. */
function leadText(lead: string): string {
  const out: string[] = [];
  const lines = lead.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]!)) {
      if (!metaRow(lines[i]!)) out.push(lines[i]!);
      continue;
    }
    const table: string[] = [];
    while (i < lines.length && /^\s*\|/.test(lines[i]!)) table.push(lines[i++]!);
    i--;
    // A table whose rows are all metadata was read whole; any other table is the author's.
    const body = table.filter((row) => !/^\s*\|[\s|:-]*\|\s*$/.test(row));
    if (!body.some(metaRow) || body.slice(1).some((row) => !metaRow(row))) out.push(...table);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function metaRow(line: string): { key: Key; value: string } | undefined {
  const row = /^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/.exec(line) ?? /^[-*]?\s*\*{0,2}([A-Za-z][\w -]+?)\*{0,2}\s*:\s*\*{0,2}\s*(.+)$/.exec(line);
  const key = row ? keyOf(row[1]!) : undefined;
  return key && row ? { key, value: row[2]!.trim() } : undefined;
}

/** Words in a status line that only say which record follows or came before, or when. */
const SUCCESSION = /\b(?:superseded by|replaced by|deprecated by|supersedes|on)\b/gi;

/** What a Status section says beyond its status word, its successor, and its day: a note the record keeps in its Context. */
function statusNote(text: string, prefix: string | undefined): string {
  const kept = text
    .trim()
    .split('\n')
    .map((line, i) => {
      const said = beyondCitations(line.replace(SUCCESSION, ' '), prefix);
      // The first word of the first line is the status itself.
      if (!(i === 0 ? said.replace(/^\S+\s*/, '') : said)) return '';
      if (i > 0 || /^\W*(?:superseded|replaced|deprecated by|supersedes)/i.test(line)) return line;
      return line.replace(/^\s*[*_]*[A-Za-z]+[*_]*\s*[.:,;!\-–—]*\s*/, '');
    });
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function parseRecord(file: ImportFile, prefix?: string): ParsedRecord {
  const notes: string[] = [];
  const { fields, rest } = frontMatter(file.text.replace(/\r\n/g, '\n'));
  const h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(rest);
  const named = h1 ? cleanTitle(h1[1]!) : { title: titleFromPath(file.path) };
  const number = numberFromPath(file.path) ?? named.number;
  const body = h1 ? rest.slice(0, h1.index) + rest.slice(h1.index + h1[0].length) : rest;
  const { lead, list } = sections(body);
  const meta: Partial<Record<Key, string>> = {};
  for (const [k, v] of Object.entries(fields)) {
    const key = keyOf(k);
    if (key) meta[key] = v;
  }
  for (const line of lead.split('\n')) {
    const row = metaRow(line);
    if (row) meta[row.key] = row.value;
  }
  const slots: Partial<Record<Slot, string>> = {};
  const extra: Section[] = [];
  for (const s of list) {
    const slot = slotOf(s.heading);
    if (!slot) extra.push(s);
    else slots[slot] = slots[slot] ? `${slots[slot]}\n\n${s.body}` : s.body;
  }
  const statusText = slots.status ?? meta.status ?? '';
  const mapped = mapStatus(statusText.split('\n')[0] ?? '');
  if (mapped.note) notes.push(mapped.note);
  const supersededBy = [...numbersIn(meta.supersededBy ?? '', prefix), ...[...statusText.matchAll(/superseded by[^\n]*/gi)].flatMap((m) => numbersIn(m[0], prefix))];
  const supersedes = [...numbersIn(meta.supersedes ?? '', prefix), ...[...statusText.matchAll(/\bsupersedes\b[^\n]*/gi)].flatMap((m) => numbersIn(m[0], prefix))];
  const decidedOn = DAY.exec(meta.decided ?? '')?.[1] ?? DAY.exec(statusText)?.[1];
  const updatedOn = DAY.exec(meta.updated ?? '')?.[1];
  if (!decidedOn) notes.push('no decision date found');
  const deciders = people(meta.deciders ?? '');
  if (!deciders.length) notes.push('no decision makers found; name them on the record');
  if (number === undefined) notes.push('no record number in the file name or title');
  // Words before the first section and a note under the status are the author's; they open the Context.
  const note = statusNote(statusText, prefix);
  let context = [leadText(lead), slots.context ?? '', note ? `### Status\n\n${note}` : ''].filter(Boolean).join('\n\n');
  if (slots.drivers) context = `${context}\n\n### Decision drivers\n\n${slots.drivers}`.trim();
  if (!context) notes.push('no Context section');
  let decision = slots.decision ?? '';
  let consequences = slots.consequences ?? '';
  // MADR keeps Consequences as a sub-heading of Decision Outcome.
  const sub = /^###\s+(?:positive |negative )?consequences\b.*$/im.exec(decision);
  if (!consequences && sub) {
    consequences = decision.slice(sub.index + sub[0].length).trim();
    decision = decision.slice(0, sub.index).trim();
  }
  if (!decision) notes.push('no Decision section');
  // Related keeps its words when it says more than which records; References is always the author's.
  if (slots.related && beyondCitations(slots.related.replace(/^\s*[-*]\s+/gm, ''), prefix)) extra.push({ heading: headingOf(list, 'related') ?? 'Related', body: slots.related });
  if (slots.references) extra.push({ heading: headingOf(list, 'references') ?? 'References', body: slots.references });
  if (extra.length) {
    decision = [decision, ...extra.map((s) => `### ${s.heading}\n\n${s.body}`)].filter(Boolean).join('\n\n');
    notes.push(`kept under Decision, as headings of their own: ${extra.map((s) => s.heading).join(', ')}`);
  }
  if (!consequences) notes.push('no Consequences section');
  const self = number;
  const related = numbersIn(`${slots.related ?? ''}\n${slots.references ?? ''}`, prefix).filter((n) => n !== self && !supersededBy.includes(n) && !supersedes.includes(n));
  return {
    path: file.path,
    number,
    title: named.title,
    status: mapped.status,
    decidedOn,
    updatedOn,
    deciders,
    context,
    decision,
    consequences,
    alternatives: alternativesFrom(slots.alternatives ?? '', notes),
    supersedes: [...new Set(supersedes)],
    supersededBy: [...new Set(supersededBy)],
    related,
    notes,
  };
}

/** The heading the file gave the first section in a slot. */
function headingOf(list: readonly Section[], slot: Slot): string | undefined {
  return list.find((s) => slotOf(s.heading) === slot)?.heading;
}

/** Markdown files that are records: not an index, a template, or a README. */
export function isRecordFile(path: string): boolean {
  const base = (path.split('/').pop() ?? '').toLowerCase();
  if (!base.endsWith('.md')) return false;
  if (/^(readme|index|template|adr-template)\.md$/.test(base)) return false;
  return !/^0+[-_]?template/.test(base);
}

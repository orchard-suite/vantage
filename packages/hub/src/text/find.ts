/**
 * Find: the lines that match, each with its address and its line, so the
 * agent can read around one or patch it, grouped under the link of the
 * thing they sit in. Inside one thing every line is looked at. Across a
 * workspace or the whole hub the search index picks the things first, and
 * only those are looked through. Across the whole hub records come before
 * documents and their pages, and personal workspaces are left out; naming
 * one in "in" looks there (VAN-5008).
 */
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { readPage } from '../documents/pages.ts';
import { documentBySlug, headVersion, listDocuments } from '../documents/repo.ts';
import { listDecisions, listRegistries, searchDecisions } from '../decisions/read.ts';
import { searchDocuments } from '../search.ts';
import { badRequest } from '../http.ts';
import { BUDGET, guideText } from '@vantage/mcp';
import { parseAddress, partOf, type Address } from './address.ts';
import { partOfThing } from './parts.ts';
import { pagePaths, readThing, requireDocumentAt, workspaceAt, type TextThing } from './things.ts';
import { recordText } from './record-text.ts';
import { itemHays, placeAddress } from './items.ts';
import { documentLink, recordLink } from './links.ts';

/** Where a thing stands in an answer across many: records first, then documents and their pages. */
const TIER = { record: 0, document: 1 } as const;
type Tier = (typeof TIER)[keyof typeof TIER];

interface Hay {
  readonly address: string;
  readonly text: string;
  /** The line of the thing the text starts at. */
  readonly first: number;
  readonly link?: string | undefined;
  readonly tier: Tier;
}

/** The most documents a workspace may hold and still be looked through line by line. */
const SCAN_ALL = 40;
/** How many things the search index picks for a search with no narrower scope. */
const SHORTLIST = 12;

const hay = (address: string, text: string, o: { first?: number; link?: string | undefined; tier?: Tier } = {}): Hay => ({ address, text, first: o.first ?? 1, link: o.link, tier: o.tier ?? TIER.document });

/** One part of one thing, read as the caller may see it. */
async function thingHay(ctx: AppContext, p: Principal, a: Address): Promise<Hay> {
  const thing: TextThing = await readThing(ctx, p, a);
  const piece = partOfThing(thing, partOf(a));
  return hay(thing.address, piece.text, { first: piece.range?.from ?? 1, link: thing.link, tier: a.kind === 'record' ? TIER.record : TIER.document });
}

async function documentHays(ctx: AppContext, p: Principal, a: { workspace: string; document: string }): Promise<Hay[]> {
  const { ws, doc, head } = await requireDocumentAt(ctx, p, a, 'viewer');
  const base = `${ws.slug}/${doc.slug}`;
  const link = documentLink(ctx, ws.slug, doc.slug);
  const out = [hay(base, head.yaml, { link })];
  for (const path of pagePaths(head)) out.push(hay(`${base}/${path}`, (await readPage(ctx, head, path)) ?? '', { link }));
  return out;
}

async function registryHays(ctx: AppContext, p: Principal, prefix: string): Promise<Hay[]> {
  return (await listDecisions(ctx, p, prefix)).map((d) => hay(d.ref, recordText(d), { link: recordLink(ctx, d.workspace, d.ref), tier: TIER.record }));
}

async function haystack(ctx: AppContext, p: Principal, given: Address, query: string, regex: boolean): Promise<{ hays: Hay[]; picked?: string }> {
  const a = await placeAddress(ctx, p, given);
  switch (a.kind) {
    case 'kind': {
      const r = await itemHays(ctx, p, a.prefix, query);
      return { hays: r.hays.map((h) => hay(h.address, h.text, { first: h.first, link: h.link })), ...(r.picked ? { picked: r.picked } : {}) };
    }
    case 'guide':
      return { hays: [hay('guide', guideText())] };
    case 'document':
      return { hays: partOf(a) === undefined ? await documentHays(ctx, p, a) : [await thingHay(ctx, p, a)] };
    case 'item':
    case 'page':
    case 'record':
    case 'schema':
    case 'scopes':
    case 'scope':
    case 'standards':
    case 'standard':
    case 'conflicts':
    case 'conflict':
      return { hays: [await thingHay(ctx, p, a)] };
    case 'registry':
      return { hays: await registryHays(ctx, p, a.prefix) };
    case 'workspace': {
      const ws = await workspaceAt(ctx, p, a.workspace, 'viewer');
      const docs = await listDocuments(ctx.db, ws.id);
      const hays: Hay[] = [];
      for (const r of await listRegistries(ctx, p, ws.slug)) hays.push(...(await registryHays(ctx, p, r.prefix)));
      if (docs.length <= SCAN_ALL) {
        for (const d of docs) hays.push(...(await documentHays(ctx, p, { workspace: ws.slug, document: d.slug })));
        return { hays };
      }
      if (regex) throw badRequest(`${ws.slug} holds ${docs.length} documents; a pattern needs one document or registry in "in"`);
      const hits = (await searchDocuments(ctx.dbRead, p, query, 100)).filter((h) => h.workspaceSlug === ws.slug).slice(0, SHORTLIST);
      for (const h of hits) hays.push(...(await documentHays(ctx, p, { workspace: ws.slug, document: h.documentSlug })));
      return { hays, picked: `the ${hits.length} best matching of ${docs.length} documents` };
    }
    case 'root': {
      if (regex) throw badRequest('a pattern needs a place to look: name a workspace, a document, a registry, or a record in "in"');
      const scope = { personal: false };
      const [records, docs] = await Promise.all([searchDecisions(ctx, p, query, SHORTLIST, scope), searchDocuments(ctx.dbRead, p, query, SHORTLIST, scope)]);
      const hays: Hay[] = [];
      for (const r of records) hays.push(await thingHay(ctx, p, { kind: 'record', ref: r.ref }));
      for (const h of docs) {
        const ws = await workspaceAt(ctx, p, h.workspaceSlug, 'viewer');
        const doc = await documentBySlug(ctx.db, ws.id, h.documentSlug);
        const head = doc ? await headVersion(ctx.db, doc) : undefined;
        if (!doc || !head) continue;
        const link = documentLink(ctx, ws.slug, doc.slug);
        hays.push(hay(`${ws.slug}/${doc.slug}`, head.yaml, { link }));
        for (const path of pagePaths(head)) hays.push(hay(`${ws.slug}/${doc.slug}/${path}`, (await readPage(ctx, head, path)) ?? '', { link }));
      }
      return { hays, picked: 'best matches, no personal workspaces' };
    }
  }
}

interface Match {
  readonly address: string;
  readonly line: number;
  readonly text: string;
}

interface Matcher {
  /** Does the line hold every word, or match the pattern? */
  readonly all: (line: string) => boolean;
  /** The words of the query long enough to count, for a miss; none for a pattern. */
  readonly words: readonly string[];
}

function matcher(query: string, regex: boolean): Matcher {
  if (regex) {
    let re: RegExp;
    try {
      re = new RegExp(query, 'i');
    } catch (err) {
      throw badRequest(`the pattern does not compile: ${(err as Error).message}`);
    }
    return { all: (l) => re.test(l), words: [] };
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return { all: (l) => words.every((w) => l.toLowerCase().includes(w)), words: [...new Set(words.filter((w) => w.length > 2))] };
}

function scan(hays: readonly Hay[], test: (line: string) => boolean): Match[] {
  const out: Match[] = [];
  for (const h of hays) h.text.split('\n').forEach((line, i) => test(line) && out.push({ address: h.address, line: h.first + i, text: line }));
  return out;
}

interface Some {
  readonly hay: Hay;
  readonly lines: number;
  readonly held: readonly string[];
}

/** For a miss: each thing with lines that hold some of the words, how many, and which words, best first. */
function some(hays: readonly Hay[], words: readonly string[]): Some[] {
  const out: Some[] = [];
  for (const h of hays) {
    const held = new Set<string>();
    let lines = 0;
    for (const line of h.text.toLowerCase().split('\n')) {
      const on = words.filter((w) => line.includes(w));
      if (!on.length) continue;
      lines += 1;
      for (const w of on) held.add(w);
    }
    if (lines) out.push({ hay: h, lines, held: words.filter((w) => held.has(w)) });
  }
  return out.sort((a, b) => a.hay.tier - b.hay.tier || b.held.length - a.held.length || b.lines - a.lines);
}

const clip = (s: string): string => (s.trim().length > BUDGET.findLineChars ? `${s.trim().slice(0, BUDGET.findLineChars)}...` : s.trim());
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const linked = (h: Hay | undefined): string => (h?.link ? `  ${h.link}` : '');

export interface FindInput {
  readonly query: string;
  readonly in?: string | undefined;
  readonly regex?: boolean | undefined;
  readonly count?: boolean | undefined;
}

export async function find(ctx: AppContext, p: Principal, input: FindInput): Promise<string> {
  const a = parseAddress(input.in);
  const regex = input.regex ?? false;
  const { hays, picked } = await haystack(ctx, p, a, input.query, regex);
  const m = matcher(input.query, regex);
  const scope = `${plural(hays.length, 'thing')}${picked ? ` (${picked})` : ''}`;
  const matches = scan(hays, m.all);
  if (!matches.length) {
    const held = some(hays, m.words);
    if (!held.length) return `no line matches in ${scope}${input.in ? '' : '; name a place in "in" to look through every line of it'}`;
    const shown = held.slice(0, BUDGET.listRows);
    const best = shown[0]!.hay.address;
    return [
      `no line holds every word in ${scope}; some words are in:`,
      ...shown.map((x) => `${x.hay.address}: ${plural(x.lines, 'line')} with ${x.held.join(', ')}${linked(x.hay)}`),
      ...(held.length > shown.length ? [`${held.length - shown.length} more things left out, the fewest words held`] : []),
      `more: vantage_outline ${best} and read a part, or vantage_find fewer words in: ${best}`,
    ].join('\n');
  }
  const byAddress = new Map(hays.map((h) => [h.address, h]));
  const byThing = new Map<string, number>();
  for (const x of matches) byThing.set(x.address, (byThing.get(x.address) ?? 0) + 1);
  const head = `${plural(matches.length, 'line')} in ${byThing.size} of ${scope}`;
  if (input.count) {
    const counted = [...byThing].sort((x, y) => byAddress.get(x[0])!.tier - byAddress.get(y[0])!.tier || y[1] - x[1]);
    const shownCounts = counted.slice(0, BUDGET.listRows);
    const left = counted.length - shownCounts.length;
    return [head, ...shownCounts.map(([address, count]) => `${address}: ${count}${linked(byAddress.get(address))}`), ...(left ? [`${left} more things left out, the fewest matches. more: narrow "in" to one of the things above`] : [])].join('\n');
  }
  const shown = matches.slice(0, BUDGET.findLines);
  const lines = [head];
  let under: string | undefined;
  for (const x of shown) {
    const link = byAddress.get(x.address)?.link;
    if (link && link !== under) lines.push(`${x.address}  ${link}`);
    under = link;
    lines.push(`${x.address}:${x.line}: ${clip(x.text)}`);
  }
  if (shown.length < matches.length) lines.push(`${matches.length - shown.length} more lines left out. more: narrow "in" to one of: ${[...byThing.keys()].slice(0, 8).join(', ')}; or count: true`);
  return lines.join('\n');
}

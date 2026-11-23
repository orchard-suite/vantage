/**
 * Find: the lines that match, each with its address and its line, so the
 * agent can read around one or patch it. Inside one thing every line is
 * looked at. Across a workspace or the whole hub the search index picks
 * the things first, and only those are looked through.
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
import { pagePaths, readThing, requireDocumentAt, workspaceAt } from './things.ts';
import { recordText } from './record-text.ts';
import { itemHays, placeAddress } from './items.ts';

interface Hay {
  readonly address: string;
  readonly text: string;
  /** The line of the thing the text starts at. */
  readonly first: number;
}

/** The most documents a workspace may hold and still be looked through line by line. */
const SCAN_ALL = 40;
/** How many things the search index picks for a search with no narrower scope. */
const SHORTLIST = 12;

const hay = (address: string, text: string, first = 1): Hay => ({ address, text, first });

async function documentHays(ctx: AppContext, p: Principal, a: { workspace: string; document: string }): Promise<Hay[]> {
  const { ws, doc, head } = await requireDocumentAt(ctx, p, a, 'viewer');
  const base = `${ws.slug}/${doc.slug}`;
  const out = [hay(base, head.yaml)];
  for (const path of pagePaths(head)) out.push(hay(`${base}/${path}`, (await readPage(ctx, head, path)) ?? ''));
  return out;
}

async function registryHays(ctx: AppContext, p: Principal, prefix: string): Promise<Hay[]> {
  return (await listDecisions(ctx, p, prefix)).map((d) => hay(d.ref, recordText(d)));
}

async function haystack(ctx: AppContext, p: Principal, given: Address, query: string, regex: boolean): Promise<{ hays: Hay[]; picked?: string }> {
  const a = await placeAddress(ctx, p, given);
  switch (a.kind) {
    case 'kind':
      return itemHays(ctx, p, a.prefix, query);
    case 'item': {
      const thing = await readThing(ctx, p, a);
      const piece = partOfThing(thing, partOf(a));
      return { hays: [hay(thing.address, piece.text, piece.range?.from ?? 1)] };
    }
    case 'guide':
      return { hays: [hay('guide', guideText())] };
    case 'document': {
      const part = partOf(a);
      if (part === undefined) return { hays: await documentHays(ctx, p, a) };
      const thing = await readThing(ctx, p, a);
      const piece = partOfThing(thing, part);
      return { hays: [hay(thing.address, piece.text, piece.range?.from ?? 1)] };
    }
    case 'page':
    case 'record':
    case 'schema': {
      const thing = await readThing(ctx, p, a);
      const piece = partOfThing(thing, partOf(a));
      return { hays: [hay(thing.address, piece.text, piece.range?.from ?? 1)] };
    }
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
      const [docs, records] = await Promise.all([searchDocuments(ctx.dbRead, p, query, SHORTLIST), searchDecisions(ctx, p, query, SHORTLIST)]);
      const hays: Hay[] = [];
      for (const h of docs) {
        const ws = await workspaceAt(ctx, p, h.workspaceSlug, 'viewer');
        const doc = await documentBySlug(ctx.db, ws.id, h.documentSlug);
        const head = doc ? await headVersion(ctx.db, doc) : undefined;
        if (!doc || !head) continue;
        hays.push(hay(`${ws.slug}/${doc.slug}`, head.yaml));
        for (const path of pagePaths(head)) hays.push(hay(`${ws.slug}/${doc.slug}/${path}`, (await readPage(ctx, head, path)) ?? ''));
      }
      for (const r of records) hays.push(hay(r.ref, (await readThing(ctx, p, { kind: 'record', ref: r.ref })).text));
      return { hays, picked: `the ${docs.length + records.length} best matching documents and records` };
    }
  }
}

interface Match {
  readonly address: string;
  readonly line: number;
  readonly text: string;
}

function matcher(query: string, regex: boolean): { all: (line: string) => boolean; any: (line: string) => boolean } {
  if (regex) {
    let re: RegExp;
    try {
      re = new RegExp(query, 'i');
    } catch (err) {
      throw badRequest(`the pattern does not compile: ${(err as Error).message}`);
    }
    return { all: (l) => re.test(l), any: () => false };
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return { all: (l) => words.every((w) => l.toLowerCase().includes(w)), any: (l) => words.some((w) => w.length > 2 && l.toLowerCase().includes(w)) };
}

function scan(hays: readonly Hay[], test: (line: string) => boolean): Match[] {
  const out: Match[] = [];
  for (const h of hays) h.text.split('\n').forEach((line, i) => test(line) && out.push({ address: h.address, line: h.first + i, text: line }));
  return out;
}

const clip = (s: string): string => (s.trim().length > BUDGET.findLineChars ? `${s.trim().slice(0, BUDGET.findLineChars)}...` : s.trim());

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
  let matches = scan(hays, m.all);
  let loose = false;
  if (!matches.length && !regex) {
    matches = scan(hays, m.any);
    loose = matches.length > 0;
  }
  const scope = `${hays.length} thing${hays.length === 1 ? '' : 's'}${picked ? ` (${picked})` : ''}`;
  if (!matches.length) return `no line matches in ${scope}${input.in ? '' : '; name a place in "in" to look through every line of it'}`;
  const byThing = new Map<string, number>();
  for (const x of matches) byThing.set(x.address, (byThing.get(x.address) ?? 0) + 1);
  const head = `${matches.length} line${matches.length === 1 ? '' : 's'} in ${byThing.size} of ${scope}${loose ? '; no line holds every word, these hold some' : ''}`;
  if (input.count) {
    const counted = [...byThing].sort((a, b) => b[1] - a[1]);
    const shownCounts = counted.slice(0, BUDGET.listRows);
    const left = counted.length - shownCounts.length;
    return [head, ...shownCounts.map(([address, count]) => `${address}: ${count}`), ...(left ? [`${left} more things left out, the fewest matches. more: narrow "in" to one of the things above`] : [])].join('\n');
  }
  const shown = matches.slice(0, BUDGET.findLines);
  const lines = [head, ...shown.map((x) => `${x.address}:${x.line}: ${clip(x.text)}`)];
  if (shown.length < matches.length) lines.push(`${matches.length - shown.length} more lines left out. more: narrow "in" to one of: ${[...byThing.keys()].slice(0, 8).join(', ')}; or count: true`);
  return lines.join('\n');
}

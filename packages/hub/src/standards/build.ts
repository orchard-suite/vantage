/**
 * Builds a scope's standard from what reaches it (VAN-3018): its own
 * lines, every line its parent's edition passes down, and every line from
 * elsewhere in the tree whose facets the scope carries. Pure: the caller
 * loads the rows and decides what to publish.
 */
import type { Scope } from '../scopes/repo.ts';
import { sha256 } from '../crypto.ts';
import { BOTH, splitBinding, type Change, type ConflictPin, type EditionBody, type PackPin, type PagePin, type ScopeKey, type StandardLine } from './model.ts';
import type { ClashRule } from './setting.ts';

/** A record's line as its registry's scope holds it, before it reaches anywhere. */
export type OwnLine = Omit<StandardLine, 'path' | 'facet'>;

/** A page that cites records with a position, by record id. */
export interface CitingPage {
  readonly page: string;
  readonly title: string;
  readonly records: ReadonlyMap<string, string>;
}

const byLine = (a: StandardLine, b: StandardLine): number => a.area.localeCompare(b.area) || a.ref.localeCompare(b.ref);

/** The lines and packs a scope's parent passes down: every line but one bound to its own scope only. */
export function passedDown(parentKey: ScopeKey, parent: EditionBody): { lines: StandardLine[]; packs: PackPin[] } {
  return {
    lines: parent.lines.filter((l) => l.position.reach.below).map((l) => ({ ...l, path: [parentKey, ...l.path] })),
    packs: [...parent.packs],
  };
}

/** The lines other scopes set that reach `scope` by a facet it carries. `ancestors` already passed theirs down. */
export function byFacet(scope: Scope, ancestors: ReadonlySet<ScopeKey>, own: ReadonlyMap<ScopeKey, readonly StandardLine[]>): StandardLine[] {
  if (!scope.facets.length) return [];
  const out: StandardLine[] = [];
  for (const [key, lines] of own) {
    if (key === scope.id || ancestors.has(key)) continue;
    for (const l of lines) {
      const facet = l.position.reach.facets.find((f) => scope.facets.includes(f));
      if (facet !== undefined) out.push({ ...l, path: [key], facet });
    }
  }
  return out;
}

/** One body from its parts: a record that reaches twice keeps its nearest path, and pages follow the lines they cite. */
export function assemble(parts: { own: readonly StandardLine[]; down: readonly StandardLine[]; facet: readonly StandardLine[]; packs: readonly PackPin[]; pages: readonly CitingPage[] }): EditionBody {
  const seen = new Set<string>();
  const lines: StandardLine[] = [];
  for (const l of [...parts.own, ...parts.down, ...parts.facet]) {
    if (seen.has(l.record)) continue;
    seen.add(l.record);
    lines.push(l);
  }
  lines.sort(byLine);
  const pages: PagePin[] = parts.pages
    .map((p) => ({ page: p.page, title: p.title, cites: [...p.records].filter(([id]) => seen.has(id)).map(([, ref]) => ref).sort() }))
    .filter((p) => p.cites.length)
    .sort((a, b) => a.page.localeCompare(b.page));
  const packs = [...parts.packs].sort((a, b) => a.pack.localeCompare(b.pack) || a.from.localeCompare(b.from));
  return { lines, packs, exceptions: [], pages };
}

/** An open conflict as a build reads it: the scope it was flagged in and its two lines' records. */
export interface OpenConflict {
  readonly number: number;
  readonly scope: ScopeKey;
  readonly lines: readonly [string, string];
}

export interface ClashFacts {
  readonly clash: ClashRule;
  readonly ranked: readonly string[];
  readonly bindings: readonly string[];
  /** A scope and the scopes above it, nearest first. */
  readonly chainOf: (key: ScopeKey) => readonly ScopeKey[];
}

/** Which of two lines holds under the clash rule, or none while the ruling waits. */
function winner(a: StandardLine, b: StandardLine, f: ClashFacts): StandardLine | undefined {
  const rank = f.clash === 'stricter' ? (l: StandardLine) => f.bindings.indexOf(l.position.binding) : f.clash === 'ranked' ? (l: StandardLine) => Math.min(...f.chainOf(l.from).map((k) => f.ranked.indexOf(scopeLabel(k))).filter((i) => i >= 0), Infinity) : undefined;
  if (!rank) return undefined;
  const ra = rank(a);
  const rb = rank(b);
  return ra === rb ? undefined : ra < rb ? a : b;
}

const scopeLabel = (k: ScopeKey): string => (k === '' ? 'estate' : k);

/**
 * The open conflicts that act in a scope: each flagged in it or above it,
 * with both its lines in the body. The line the clash rule holds back is
 * marked with the conflict; with no winner both stay in force.
 */
export function withConflicts(body: EditionBody, key: ScopeKey, ancestors: ReadonlySet<ScopeKey>, open: readonly OpenConflict[], f: ClashFacts): EditionBody {
  const pins: ConflictPin[] = [];
  const held = new Map<string, number>();
  for (const c of open) {
    if (c.scope !== key && !ancestors.has(c.scope)) continue;
    const a = body.lines.find((l) => l.record === c.lines[0]);
    const b = body.lines.find((l) => l.record === c.lines[1]);
    if (!a || !b) continue;
    const w = winner(a, b, f);
    pins.push({ conflict: c.number, lines: [a.ref, b.ref], holds: w?.ref ?? BOTH });
    if (w) held.set(w === a ? b.record : a.record, c.number);
  }
  const lines = body.lines.map(({ held: _, ...l }) => (held.has(l.record) ? { ...l, held: held.get(l.record)! } : l));
  const { conflicts: _, ...rest } = body;
  return pins.length ? { ...rest, lines, conflicts: pins } : { ...rest, lines };
}

/** A scope and every scope above it, nearest first, ending at the whole estate. */
export function chainOf(key: ScopeKey, byId: ReadonlyMap<string, Scope>): ScopeKey[] {
  const out: ScopeKey[] = [];
  for (let at: ScopeKey | undefined = byId.has(key) ? key : ''; at !== undefined && !out.includes(at); at = at === '' ? undefined : (byId.get(at)?.parent ?? '')) out.push(at === '' || byId.has(at) ? at : '');
  return out;
}

/** What stands above a key: a scope's chain, or for an owner and program, the pair, the owner's chain, and the program itself. */
export function bindingChain(key: ScopeKey, byId: ReadonlyMap<string, Scope>): ScopeKey[] {
  const pair = splitBinding(key);
  return pair ? [key, ...chainOf(pair.owner, byId), pair.program] : chainOf(key, byId);
}

/** The nearest scope at or above both. */
export function sharedScope(a: ScopeKey, b: ScopeKey, byId: ReadonlyMap<string, Scope>): ScopeKey {
  const up = new Set(chainOf(b, byId));
  return chainOf(a, byId).find((k) => up.has(k)) ?? '';
}

/** A value with its keys in one order, so the same body always hashes the same. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
  return value;
}

export async function hashBody(body: EditionBody): Promise<string> {
  return `sha256:${await sha256(JSON.stringify(canonical(body)))}`;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** What `next` changes against `last`: lines by record, packs by id and scope, pages by address. */
export function changesOf(last: EditionBody, next: EditionBody): Change[] {
  const out: Change[] = [];
  const was = new Map(last.lines.map((l) => [l.record, l]));
  for (const l of next.lines) {
    const before = was.get(l.record);
    was.delete(l.record);
    if (!before) out.push({ what: 'line', change: 'added', ref: l.ref, line: l.position.line });
    else if (!same(before, l)) out.push({ what: 'line', change: 'changed', ref: l.ref, line: l.position.line });
  }
  for (const l of was.values()) out.push({ what: 'line', change: 'removed', ref: l.ref, line: l.position.line });
  const packKey = (p: PackPin): string => `${p.from}/${p.pack}`;
  const packs = new Map(last.packs.map((p) => [packKey(p), p]));
  for (const p of next.packs) {
    const before = packs.get(packKey(p));
    packs.delete(packKey(p));
    if (!before) out.push({ what: 'pack', change: 'added', pack: p.pack, version: p.version });
    else if (!same(before, p)) out.push({ what: 'pack', change: 'changed', pack: p.pack, version: p.version });
  }
  for (const p of packs.values()) out.push({ what: 'pack', change: 'removed', pack: p.pack, version: p.version });
  const pages = new Set(last.pages.map((p) => p.page));
  for (const p of next.pages) if (!pages.delete(p.page)) out.push({ what: 'page', change: 'added', page: p.page });
  for (const page of pages) out.push({ what: 'page', change: 'removed', page });
  return out;
}

/** The part of a body that is the scope's own: what the steward gate holds. */
export function ownPart(key: ScopeKey, body: EditionBody): { lines: StandardLine[]; packs: PackPin[] } {
  return { lines: body.lines.filter((l) => l.from === key && !l.path.length), packs: body.packs.filter((p) => p.from === key) };
}

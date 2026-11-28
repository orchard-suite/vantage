/**
 * Rebuilds every scope's standard and publishes what changed (VAN-3018).
 * Each write that can change a build calls it, in that write's
 * transaction where it has one. Scopes build parents first, so a scope's
 * edition is built on its parent's newest one. The machine gate runs on
 * every edition; with the steward gate on, a scope's own changes wait as a
 * pending edition while what comes from above publishes at once.
 */
import type { AppContext } from '../context.ts';
import type { Db } from '../db/db.ts';
import type { Principal } from '../auth/principal.ts';
import { audit } from '../audit.ts';
import { badRequest, forbidden, HttpError } from '../http.ts';
import { actsFor } from './steward.ts';
import { listScopes, type Scope } from '../scopes/repo.ts';
import { scopeSetting } from '../scopes/setting.ts';
import { assemble, byFacet, chainOf, changesOf, hashBody, ownPart, passedDown, withConflicts, type ClashFacts, type OwnLine } from './build.ts';
import { fileChecks, type Filing } from './checks.ts';
import { machineGate, type GateFacts } from './gate.ts';
import { bindingKey, EMPTY_BODY, ESTATE, scopeKey, scopeName, type EditionBody, type EditionState, type Manifest, type PackPin, type ScopeKey, type StandardLine } from './model.ts';
import { citingPages, clearNext, hasStandards, latestEditions, lockStandards, markingRecords, openConflicts, ownLines, publishPending, teamWorkspaces, workspacePairs, writeEdition } from './repo.ts';
import { standardSetting } from './setting.ts';

export interface Built {
  readonly scope: string;
  readonly version: number;
  readonly state: EditionState;
}

/** The whole estate as a scope: the root every scope with no parent hangs from. */
const ESTATE_SCOPE: Scope = { id: '', name: 'The whole estate', kind: ESTATE, facets: [], profile: {} };

const asLine = (l: OwnLine): StandardLine => ({ ...l, path: [] });

/** Rebuilds the organization's standards inside `tx` and answers each edition it wrote. */
export async function rebuildStandards(ctx: Pick<AppContext, 'log'>, tx: Db, orgId: string, by: string): Promise<Built[]> {
  if (!(await hasStandards(tx, orgId))) return [];
  await lockStandards(tx, orgId);
  const setting = await standardSetting(tx, orgId);
  const gate = setting.steward_gate;
  const tree = await listScopes(tx, orgId, (await scopeSetting(tx, orgId)).source);
  const byId = new Map(tree.map((s) => [s.id, s]));
  const own = await ownLines(tx, orgId);
  const { published, next } = await latestEditions(tx, orgId);
  const facts: GateFacts = { setting, records: new Set(own.map((l) => l.record)), team: await teamWorkspaces(tx, orgId) };

  const current = new Map<ScopeKey, { lines: StandardLine[]; packs: PackPin[] }>();
  const part = (m: typeof current, key: ScopeKey) => m.get(key) ?? { lines: [], packs: [] };
  for (const l of own) {
    const key = byId.has(l.from) ? l.from : '';
    const p = part(current, key);
    current.set(key, { ...p, lines: [...p.lines, asLine({ ...l, from: key })] });
  }
  for (const [name, packs] of Object.entries(setting.packs)) {
    const key = scopeKey(name);
    if (key !== '' && !byId.has(key)) continue;
    current.set(key, { ...part(current, key), packs: packs.map((x) => ({ ...x, from: key })) });
  }
  // What each scope holds in force of its own: with the steward gate, what its steward last published.
  const inForce = gate ? new Map([...published].map(([key, e]) => [key, ownPart(key, e.body)])) : current;
  const ownInForce = new Map([...inForce].map(([key, p]) => [key, p.lines]));

  const refs = new Map<string, string>();
  for (const l of own) refs.set(l.record, l.ref);
  for (const e of published.values()) for (const l of e.body.lines) if (!refs.has(l.record)) refs.set(l.record, l.ref);
  const pages = await citingPages(tx, orgId, refs);
  const open = (await openConflicts(tx, orgId)).map((c) => ({ number: c.number, scope: c.scope, lines: c.lines }));
  const clash: ClashFacts = { clash: setting.clash, ranked: setting.ranked, bindings: setting.bindings, chainOf: (k) => chainOf(k, byId) };
  const marking = setting.checks ? await markingRecords(tx, orgId) : [];
  const filings: Filing[] = [];

  const effective = new Map<ScopeKey, EditionBody>();
  const versions = new Map([...published].map(([key, e]) => [key, e.version]));
  const out: Built[] = [];
  for (const scope of [ESTATE_SCOPE, ...tree]) {
    const key = scope.id;
    const parent = key === '' ? undefined : scope.parent !== undefined && byId.has(scope.parent) ? scope.parent : '';
    const ancestors = new Set<ScopeKey>();
    for (let at = parent; at !== undefined; at = at === '' ? undefined : (byId.get(at)?.parent ?? '')) {
      if (ancestors.has(at)) break;
      ancestors.add(at);
    }
    const down = parent === undefined ? { lines: [], packs: [] } : passedDown(parent, effective.get(parent) ?? EMPTY_BODY);
    const facet = byFacet(scope, ancestors, ownInForce);
    const body = (mine: { lines: readonly StandardLine[]; packs: readonly PackPin[] }): EditionBody => withConflicts(assemble({ own: mine.lines, down: down.lines, facet, packs: [...mine.packs, ...down.packs], pages }), key, ancestors, open, clash);
    const held = body(part(inForce, key));
    const wanted = gate ? body(part(current, key)) : held;
    const last = published.get(key);
    const manifest: Manifest = {
      scope: scopeName(key),
      name: scope.name,
      kind: scope.kind,
      ...(scope.steward ? { steward: scope.steward } : {}),
      builds_on: [...new Set([...(parent !== undefined ? [parent] : []), ...facet.map((l) => l.path[0]!)])].filter((k) => versions.has(k)).map((k) => ({ scope: scopeName(k), version: versions.get(k)! })),
    };
    const write = async (state: EditionState, b: EditionBody, base: EditionBody, version: number, problems: readonly string[]): Promise<void> => {
      await writeEdition(tx, orgId, { scope: key, version, state, hash: await hashBody(b), body: b, manifest, changes: changesOf(base, b), problems, by });
      out.push({ scope: scopeName(key), version, state });
    };
    let base = last?.body ?? EMPTY_BODY;
    let version = last?.version ?? 0;
    let refused = false;
    const heldHash = await hashBody(held);
    if (heldHash !== (last?.hash ?? (await hashBody(EMPTY_BODY)))) {
      const problems = machineGate(held, facts);
      if (problems.length) {
        await write('refused', held, base, version + 1, problems);
        refused = true;
      } else {
        await write('published', held, base, version + 1, []);
        if (setting.checks) filings.push(...checksFor(key, version + 1, base, held, marking));
        base = held;
        version += 1;
        versions.set(key, version);
      }
    }
    effective.set(key, base);
    if (refused) continue;
    if (gate && (await hashBody(wanted)) !== heldHash) {
      const problems = machineGate(wanted, facts);
      await write(problems.length ? 'refused' : 'pending', wanted, base, version + 1, problems);
    } else if (next.has(key)) await clearNext(tx, orgId, key);
  }
  // A workspace that serves a program is bound by its owner's edition and the program's own lines, never its ancestors' (VAN-3017).
  const empty = await hashBody(EMPTY_BODY);
  for (const pair of await workspacePairs(tx, orgId)) {
    const owner = byId.has(pair.owner) ? pair.owner : '';
    const program = byId.get(pair.program);
    if (!program || program.id === owner) continue;
    const key = bindingKey(owner, program.id);
    const o = effective.get(owner) ?? EMPTY_BODY;
    const g = effective.get(program.id) ?? EMPTY_BODY;
    const down = o.lines.map((l) => ({ ...l, path: [owner, ...l.path] }));
    const through = g.lines.filter((l) => !l.path.length || l.facet !== undefined).map((l) => ({ ...l, path: [program.id, ...l.path], program: program.id }));
    const packs = [...o.packs, ...g.packs.filter((x) => x.from === program.id)];
    const body = withConflicts(assemble({ own: [], down, facet: through, packs, pages }), key, new Set(chainOf(owner, byId)), open, clash);
    const last = published.get(key);
    const hash = await hashBody(body);
    if (hash === (last?.hash ?? empty)) {
      if (next.has(key)) await clearNext(tx, orgId, key);
      continue;
    }
    const manifest: Manifest = {
      scope: scopeName(key),
      name: `${(byId.get(owner) ?? ESTATE_SCOPE).name}, serving ${program.name}`,
      kind: 'workspace',
      builds_on: [owner, program.id].filter((k) => versions.has(k)).map((k) => ({ scope: scopeName(k), version: versions.get(k)! })),
    };
    const problems = machineGate(body, facts);
    const version = (last?.version ?? 0) + 1;
    const state: EditionState = problems.length ? 'refused' : 'published';
    await writeEdition(tx, orgId, { scope: key, version, state, hash, body, manifest, changes: changesOf(last?.body ?? EMPTY_BODY, body), problems, by });
    out.push({ scope: scopeName(key), version, state });
    if (state === 'published' && setting.checks) filings.push(...checksFor(key, version, last?.body ?? EMPTY_BODY, body, marking));
  }
  if (out.length) ctx.log.info('standards.built', { orgId, editions: out.map((e) => `${e.scope}@${e.version} ${e.state}`) });
  const filed = await fileChecks(tx, orgId, setting.checks, filings);
  if (filed.length) ctx.log.info('standards.checks_filed', { orgId, items: filed });
  return out;
}

/**
 * What a newly published edition asks agents to check (VAN-3019): each
 * record of the scope whose map marks a line the edition changed or took
 * out, and each line newly accepted in the scope itself.
 */
function checksFor(key: ScopeKey, version: number, last: EditionBody, next: EditionBody, marking: Awaited<ReturnType<typeof markingRecords>>): Filing[] {
  const edition = `${scopeName(key)}@${version}`;
  const out: Filing[] = [];
  const recordOf = (ref: string): string | undefined => (next.lines.find((l) => l.ref === ref) ?? last.lines.find((l) => l.ref === ref))?.record;
  for (const c of changesOf(last, next)) {
    if (c.what !== 'line') continue;
    const line = recordOf(c.ref);
    if (!line) continue;
    if (c.change === 'added') {
      const l = next.lines.find((x) => x.record === line)!;
      if (l.from !== key || l.path.length) continue;
      out.push({ subject: `line:${line}`, cause: edition, title: `Check ${c.ref}, new in standard/${edition}, against the lines that reach the same scopes and facets`, body: `${c.ref} sets a new line in standard/${edition}: ${c.line}\n\nRead the standards of the scopes it reaches, and of the scopes that carry its facets. Close this when it holds beside every line there, or flag a conflict at conflicts with the two lines and the scope.`, records: [line] });
      continue;
    }
    for (const m of marking) {
      if (!m.inherits.some((i) => i.line === line && i.scope === key)) continue;
      out.push({ subject: `recheck:${m.id}:${line}`, cause: edition, title: `Check ${m.ref} against ${c.ref}, ${c.change} in standard/${edition}`, body: `${m.ref} marks ${c.ref} in its inherits, and standard/${edition} ${c.change === 'removed' ? 'no longer carries it' : `changed it: ${c.line}`}.\n\nRead ${m.ref} and the edition. Update its inherits to name standard/${edition}, change the record if it no longer holds, or flag a conflict at conflicts.`, records: [m.id, line] });
    }
  }
  return out;
}

/** Rebuilds in a transaction of its own, for a write that has none. */
export async function rebuildNow(ctx: Pick<AppContext, 'log' | 'db'>, orgId: string, by: string): Promise<Built[]> {
  return ctx.db.transaction((tx) => rebuildStandards(ctx, tx, orgId, by));
}

/** A scope's steward, or an admin, publishes the edition that waits for them; the scopes below build on it at once. */
export async function publishEdition(ctx: AppContext, p: Principal, name: string, who: string): Promise<string> {
  const key = scopeKey(name);
  const tree = await listScopes(ctx.db, p.orgId, (await scopeSetting(ctx.db, p.orgId)).source);
  const scope = key === '' ? ESTATE_SCOPE : tree.find((s) => s.id === key);
  if (!scope) throw new HttpError(404, `no scope ${name}; vantage_outline scopes lists them`);
  if (!(await actsFor(ctx.db, p, scope.steward))) throw forbidden(`only the steward of ${name}${scope.steward ? ` (${scope.steward})` : ''} or an admin publishes its edition`);
  const { version, built } = await ctx.db.transaction(async (tx) => {
    await lockStandards(tx, p.orgId);
    const version = await publishPending(tx, p.orgId, key, who);
    if (version === undefined) throw badRequest(`no edition of ${name} waits for its steward; vantage_outline standard/${name} says where it stands`);
    return { version, built: await rebuildStandards(ctx, tx, p.orgId, who) };
  });
  await audit(ctx.db, ctx.log, { orgId: p.orgId, who, what: 'standard.publish', surface: p.surface, target: `standard:${name}`, details: { version, built: built.map((b) => `${b.scope}@${b.version} ${b.state}`) } });
  const below = built.filter((b) => b.state === 'published');
  return `published standard/${name} edition ${version}${below.length ? `; built on it: ${below.map((b) => `${b.scope} edition ${b.version}`).join(', ')}` : ''}`;
}

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
import { assemble, byFacet, changesOf, hashBody, ownPart, passedDown, type OwnLine } from './build.ts';
import { machineGate, type GateFacts } from './gate.ts';
import { EMPTY_BODY, ESTATE, scopeKey, scopeName, type EditionBody, type EditionState, type Manifest, type PackPin, type ScopeKey, type StandardLine } from './model.ts';
import { citingPages, clearNext, hasStandards, latestEditions, lockStandards, ownLines, publishPending, teamWorkspaces, writeEdition } from './repo.ts';
import { standardSetting } from './setting.ts';

export interface Built {
  readonly scope: string;
  readonly version: number;
  readonly state: EditionState;
}

/** The whole estate as a scope: the root every scope with no parent hangs from. */
const ESTATE_SCOPE: Scope = { id: '', name: 'The whole estate', kind: ESTATE, facets: [] };

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
    const body = (mine: { lines: readonly StandardLine[]; packs: readonly PackPin[] }): EditionBody => assemble({ own: mine.lines, down: down.lines, facet, packs: [...mine.packs, ...down.packs], pages });
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
  if (out.length) ctx.log.info('standards.built', { orgId, editions: out.map((e) => `${e.scope}@${e.version} ${e.state}`) });
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

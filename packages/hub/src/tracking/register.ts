/**
 * Registering kinds (VAN-3015, VAN-3025). A save that defines a kind
 * registers it in the save's transaction, so a save that would break a
 * kind saves nothing. A kind builds on a shipped kind or on another kind
 * the writer can read; a chain of bases ends at a shipped kind, and a loop
 * is refused. A change to a base reaches every kind built on it in the same
 * transaction, and is refused when it would strand one of their items or
 * drop what one of them relies on.
 */
import { BASE_KINDS, parseDocumentText, type Document } from '@vantage/model';
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import type { Principal } from '../auth/principal.ts';
import { workspaceRole } from '../authz.ts';
import { randomId } from '../crypto.ts';
import { badRequest } from '../http.ts';
import type { Logger } from '../log.ts';
import { isShipped, kindByPrefix, kindOf, prefixTaken, type KindDef, type KindRow } from './kinds.ts';
import { renameKinds } from './roster.ts';

export interface Registering {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly documentId: string;
  readonly versionId: string;
  readonly doc: Document | undefined;
  /** Who saves: a base in another workspace must be one they can read. Absent, only a base in the same workspace is. */
  readonly writer?: Principal | undefined;
}

/** The longest chain of bases the hub follows before it calls the chain broken. */
export const CHAIN_MAX = 16;

/** The items a key list in a refusal names before it counts the rest. */
const NAMED_MAX = 5;

/**
 * The kind a base prefix names, as the hub enforces it, once the writer may
 * read it and its chain ends at a shipped kind without passing back through
 * the kind being saved. A shipped base answers undefined: kindOf reads it.
 */
async function builtOn(tx: Db, input: Registering, prefix: string, base: string): Promise<KindDef | undefined> {
  if (isShipped(base)) return undefined;
  const unknown = badRequest(`kind ${prefix} builds on ${base}, which is no kind you can read; name a shipped kind (${BASE_KINDS.join(', ')}) or the prefix of a kind in a workspace you can open`);
  const row = await kindByPrefix(tx, input.orgId, base);
  if (!row) throw unknown;
  if (row.workspace_id !== input.workspaceId && !(input.writer && (await workspaceRole(tx, input.writer, row.workspace_id)))) throw unknown;
  const chain = [prefix];
  let at: KindRow = row;
  for (let i = 0; i < CHAIN_MAX; i++) {
    chain.push(at.prefix);
    if (at.document_id === input.documentId || at.prefix === prefix) throw badRequest(`kind ${prefix} cannot build on ${base}: ${chain.join(' builds on ')} is a loop`);
    const next = at.definition.base;
    if (next === undefined) throw badRequest(`kind ${prefix} builds on ${base}, whose chain ends at ${at.prefix}, which builds on nothing; a chain of bases ends at a shipped kind (${BASE_KINDS.join(', ')})`);
    if (isShipped(next)) return row.definition;
    const up = await kindByPrefix(tx, input.orgId, next);
    if (!up) throw badRequest(`kind ${prefix} builds on ${base}, whose chain names ${next}, which is no kind; a chain of bases ends at a shipped kind (${BASE_KINDS.join(', ')})`);
    at = up;
  }
  throw badRequest(`kind ${prefix} builds on ${base}, whose chain of bases is longer than ${CHAIN_MAX}; build on a kind nearer a shipped one`);
}

/** The kinds that name this prefix as their base. */
async function dependentsOf(tx: Db, orgId: string, prefix: string): Promise<(KindRow & { yaml: string })[]> {
  return tx.query<KindRow & { yaml: string }>(
    "select k.*, v.yaml from item_kinds k join documents d on d.id = k.document_id join versions v on v.id = d.head_version_id where k.org_id = $1 and k.definition ->> 'base' = $2 order by k.prefix",
    [orgId, prefix],
  );
}

/** Each state a kind's items are in that `def` no longer draws, as a line naming the items. */
async function stranded(tx: Db, kind: Pick<KindRow, 'id' | 'prefix'>, def: KindDef): Promise<string[]> {
  const rows = await tx.query<{ state: string; n: number; keys: string[] }>('select state, count(*)::int as n, (array_agg(key order by number))[1:$2] as keys from items where kind_id = $1 group by state order by state', [kind.id, NAMED_MAX]);
  return rows
    .filter((r) => !def.states.some((s) => s.id === r.state))
    .map((r) => `kind ${kind.prefix} has ${r.n} item(s) in state ${r.state} (${r.keys.join(', ')}${Number(r.n) > r.keys.length ? `, and ${Number(r.n) - r.keys.length} more` : ''}), which its lifecycle would no longer draw`);
}

/**
 * Lays every kind built on `base` over it again, and the kinds built on
 * those, writing each changed definition. What a change would strand is
 * gathered into `problems`; the caller refuses the save when there is any,
 * which rolls these writes back with it.
 */
async function relayDependents(tx: Db, orgId: string, base: Pick<KindRow, 'prefix' | 'definition'>, problems: string[], depth = 0): Promise<void> {
  if (depth >= CHAIN_MAX) return;
  for (const d of await dependentsOf(tx, orgId, base.prefix)) {
    let def: KindDef;
    try {
      const doc = parseDocumentText(d.yaml, 'kind.vantage.yaml').document;
      const laid = doc ? kindOf(doc, base.definition) : undefined;
      if (!laid) continue;
      def = laid;
    } catch (err) {
      problems.push(`kind ${d.prefix}: ${(err as Error).message}`);
      continue;
    }
    problems.push(...(await stranded(tx, d, def)));
    if (canonical(def) === canonical(d.definition)) continue;
    await tx.query('update item_kinds set definition = $2, updated_at = now() where id = $1', [d.id, JSON.stringify(def)]);
    if (JSON.stringify(d.definition.roles) !== JSON.stringify(def.roles) || JSON.stringify(d.definition.moves) !== JSON.stringify(def.moves)) await renameKinds(tx, orgId, [d.id]);
    await relayDependents(tx, orgId, { prefix: d.prefix, definition: def }, problems, depth + 1);
  }
}

/**
 * Registers, changes, or drops the kind a document's head defines, inside
 * the save's transaction, so a save that would break a kind saves nothing.
 * A kind with items keeps its block and its prefix, and keeps every state
 * an item is in. A kind another kind builds on keeps its block and its
 * prefix too, and a change to it reaches the kinds built on it.
 */
export async function registerKind(tx: Db, input: Registering): Promise<KindRow | undefined> {
  const existing = await maybe<KindRow>(tx, 'select * from item_kinds where document_id = $1', [input.documentId]);
  const block = input.doc?.kind;
  const built = block?.base !== undefined ? await builtOn(tx, input, block.prefix, block.base) : undefined;
  const def = input.doc ? kindOf(input.doc, built) : undefined;
  const counted = existing ? await tx.query<{ state: string; n: number }>('select state, count(*)::int as n from items where kind_id = $1 group by state', [existing.id]) : [];
  const items = counted.reduce((s, r) => s + Number(r.n), 0);
  const dependents = existing ? (await dependentsOf(tx, input.orgId, existing.prefix)).map((d) => d.prefix) : [];
  if (!def) {
    if (!existing) return undefined;
    if (items) throw badRequest(`this document defines kind ${existing.prefix}, which has ${items} item(s); a kind with items keeps its kind block`);
    if (dependents.length) throw badRequest(`kinds ${dependents.join(', ')} build on ${existing.prefix}, so it keeps its kind block; change their base first`);
    await tx.query('delete from item_kinds where id = $1', [existing.id]);
    return undefined;
  }
  if (existing && existing.prefix !== def.prefix && items) throw badRequest(`kind ${existing.prefix} has ${items} item(s), so its prefix never changes; keep prefix: ${existing.prefix}`);
  if (existing && existing.prefix !== def.prefix && dependents.length) throw badRequest(`kinds ${dependents.join(', ')} build on ${existing.prefix}, so its prefix never changes; keep prefix: ${existing.prefix}`);
  const taken = await prefixTaken(tx, input.orgId, def.prefix, { kindDocument: input.documentId });
  if (taken) throw badRequest(`the prefix ${def.prefix} is taken in this organization by ${taken === 'registry' ? 'a decision registry' : 'another kind'}; prefixes, registries, and workspace names share one namespace, so pick another`);
  for (const r of counted) {
    if (!def.states.some((s) => s.id === r.state)) throw badRequest(`${r.n} item(s) of kind ${def.prefix} are in state ${r.state}, which the lifecycle no longer draws; keep the state, or move them out first`);
  }
  if (existing) {
    await tx.query('update item_kinds set prefix = $2, name = $3, definition = $4, version_id = $5, workspace_id = $6, updated_at = now() where id = $1', [existing.id, def.prefix, def.name, JSON.stringify(def), input.versionId, input.workspaceId]);
    // A changed roster or lifecycle names the kind's items again, so who sees them follows the file.
    if (items && (JSON.stringify(existing.definition.roles) !== JSON.stringify(def.roles) || JSON.stringify(existing.definition.moves) !== JSON.stringify(def.moves))) await renameKinds(tx, input.orgId, [existing.id]);
    const problems: string[] = [];
    await relayDependents(tx, input.orgId, { prefix: def.prefix, definition: def }, problems);
    if (problems.length) throw badRequest(`nothing was saved: this change to kind ${def.prefix} would strand what builds on it. ${problems.join('; ')}. Keep what they rely on, or change those kinds first`, { kinds: [...new Set(problems.map((x) => /^kind (\S+?):?\s/.exec(x)?.[1] ?? ''))].filter(Boolean) });
    return { ...existing, prefix: def.prefix, name: def.name, definition: def, version_id: input.versionId, workspace_id: input.workspaceId };
  }
  const id = randomId();
  await tx.query('insert into item_kinds (id, org_id, workspace_id, document_id, prefix, name, definition, version_id) values ($1, $2, $3, $4, $5, $6, $7, $8)', [id, input.orgId, input.workspaceId, input.documentId, def.prefix, def.name, JSON.stringify(def), input.versionId]);
  return { id, org_id: input.orgId, workspace_id: input.workspaceId, document_id: input.documentId, prefix: def.prefix, name: def.name, definition: def, version_id: input.versionId, next_number: 1 };
}

/** JSON with every object's keys in order, so a definition read back from jsonb compares equal to the same one built here. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`;
  return JSON.stringify(v);
}

/**
 * Lays every kind built on a base over that base again, after the
 * migrations, so a label or a state a shipped base gains reaches the kinds
 * already registered on it, and down every chain built on them. A kind
 * whose file no longer reads as a kind is left as it was and logged.
 */
export async function relayKinds(db: Db, log: Logger): Promise<number> {
  const rows = await db.query<{ id: string; org_id: string; prefix: string; definition: KindDef; yaml: string }>('select k.id, k.org_id, k.prefix, k.definition, v.yaml from item_kinds k join documents d on d.id = k.document_id join versions v on v.id = d.head_version_id');
  const byPrefix = new Map(rows.map((r) => [`${r.org_id}/${r.prefix}`, r]));
  const laid = new Map<string, KindDef>();
  const open = new Set<string>();
  // A kind as it lays now: its base first, so a chain lays from the shipped kind down.
  const lay = (r: (typeof rows)[number]): KindDef => {
    const at = `${r.org_id}/${r.prefix}`;
    const done = laid.get(at);
    if (done) return done;
    if (!r.definition.base) return r.definition;
    if (open.has(at)) throw new Error(`a loop of bases through ${r.prefix}`);
    open.add(at);
    try {
      const doc = parseDocumentText(r.yaml, 'kind.vantage.yaml').document;
      const base = doc?.kind?.base;
      const up = base !== undefined && !isShipped(base) ? byPrefix.get(`${r.org_id}/${base}`) : undefined;
      const def = doc ? kindOf(doc, up ? lay(up) : undefined) : undefined;
      if (!def) throw new Error('its file no longer defines a kind');
      laid.set(at, def);
      return def;
    } finally {
      open.delete(at);
    }
  };
  let changed = 0;
  for (const r of rows.filter((x) => x.definition.base)) {
    try {
      const def = lay(r);
      if (canonical(def) === canonical(r.definition)) continue;
      await db.query('update item_kinds set definition = $2, updated_at = now() where id = $1', [r.id, JSON.stringify(def)]);
      changed++;
      log.info('kinds.relaid', { kind: r.prefix, base: def.base });
    } catch (err) {
      log.warn('kinds.relay.failed', { kind: r.prefix, error: (err as Error).message });
    }
  }
  log.info('kinds.relay.end', { kinds: rows.length, changed });
  return changed;
}

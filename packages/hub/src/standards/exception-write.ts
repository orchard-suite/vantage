/**
 * Asking for, granting, revoking, renewing, and importing exceptions
 * (VAN-3020). Only the line's steward grants, or a grantor the setting names
 * for the kind of the line's scope; a locked line takes one only from the
 * scope `locked_by` names. Each change rebuilds the standards in its own
 * transaction, so an edition carries the exceptions in force.
 */
import type { AppContext } from '../context.ts';
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import type { Principal } from '../auth/principal.ts';
import { accessibleWorkspaces } from '../authz.ts';
import { audit, type Surface } from '../audit.ts';
import { badRequest, forbidden, HttpError } from '../http.ts';
import { placedById, placedByRef, refOf, type PlacedRow } from '../decisions/repo.ts';
import { ulid } from '../decisions/ulid.ts';
import { listScopes, type Scope } from '../scopes/repo.ts';
import { scopeSetting } from '../scopes/setting.ts';
import { dayOf, instantOf } from '../day.ts';
import { enqueue } from '../worker/jobs.ts';
import { fileChecks } from './checks.ts';
import { exceptionOf, EXCEPTIONS, type ExceptionRow, type ExceptionState } from './exceptions.ts';
import { bindingChain } from './build.ts';
import { scopeKey, scopeName, type ScopeKey } from './model.ts';
import { rebuildStandards } from './publish.ts';
import { editionOf, lockStandards } from './repo.ts';
import { exceptionRule, standardSetting, type ExceptionRule } from './setting.ts';
import { actsFor, personOf } from './steward.ts';
import { exceptionThing, readExceptionText, type ExceptionFields } from './exception-text.ts';

const DAY = 86_400_000;
const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** A line's own scope, its steward, its kind's rule, and whether it is locked. */
interface LineFacts {
  readonly row: PlacedRow;
  readonly scope: ScopeKey;
  readonly steward: string | undefined;
  readonly rule: ExceptionRule;
  readonly locked: boolean;
  /** For a locked line: the scope whose steward grants on it, with its steward; undefined when the estate names none. */
  readonly lockedBy: { readonly scope: string; readonly steward: string | undefined } | undefined;
}

async function treeOf(db: Db, orgId: string): Promise<Map<string, Scope>> {
  return new Map((await listScopes(db, orgId, (await scopeSetting(db, orgId)).source)).map((s) => [s.id, s]));
}

async function lineFacts(db: Db, orgId: string, line: PlacedRow, byId: ReadonlyMap<string, Scope>): Promise<LineFacts> {
  if (!line.position) throw badRequest(`line: ${refOf(line)} sets no line; an exception bends a record with a position (guide#standards)`);
  const own = (await maybe<{ scope: string | null }>(db, 'select scope from workspaces where id = $1', [line.workspace_id]))?.scope ?? null;
  const scope = own && byId.has(own) ? own : '';
  const s = await standardSetting(db, orgId);
  const lockedBy = s.exceptions.locked_by;
  return { row: line, scope, steward: scope === '' ? undefined : byId.get(scope)?.steward, rule: exceptionRule(s, scope === '' ? 'estate' : byId.get(scope)!.kind), locked: line.position.locked, lockedBy: lockedBy === undefined ? undefined : { scope: lockedBy, steward: byId.get(lockedBy)?.steward } };
}

/** Whether `p` may grant on this line: its steward, a grantor its rule names, or for a locked line only the locked_by scope's steward. */
async function mayGrant(db: Db, p: Principal, f: LineFacts, byId: ReadonlyMap<string, Scope>): Promise<boolean> {
  if (f.locked) return f.lockedBy !== undefined && (await actsFor(db, p, f.lockedBy.steward));
  if (await actsFor(db, p, f.steward)) return true;
  for (const g of f.rule.grantors) if (await actsFor(db, p, g.startsWith('scope:') ? byId.get(g.slice(6))?.steward : g)) return true;
  return false;
}

/** The covered scope by key, checked: in the tree, the estate, or an owner and program some workspace pairs, with the line reaching it. */
async function coveredScope(db: Db, orgId: string, name: string, line: PlacedRow): Promise<ScopeKey> {
  const key = scopeKey(name);
  const e = await editionOf(db, orgId, key);
  if (!e) throw badRequest(`covers.scope: no edition of standard/${name}; name a scope, an owner+program, or estate (vantage_outline standard)`);
  if (!e.body.lines.some((l) => l.record === line.id)) throw badRequest(`covers.scope: ${refOf(line)} does not reach standard/${name}; an exception stands where its line binds`);
  return key;
}

async function recordIds(db: Db, orgId: string, refs: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const ref of refs) {
    const r = await placedByRef(db, orgId, ref);
    if (!r) throw badRequest(`covers.records: no record ${ref}`);
    out.push(r.id);
  }
  return out;
}

const missingOf = (f: { reason: string; ends: string | null; asked_by: string | null }): string[] => [...(f.asked_by ? [] : ['an owner']), ...(f.reason.trim() ? [] : ['a reason']), ...(f.ends ? [] : ['an end'])];

/** Queues the end of a granted exception for the first instant of the day after its last. */
async function queueEnd(tx: Db, orgId: string, n: number, ends: string): Promise<void> {
  const [y, m, d] = ends.split('-').map(Number) as [number, number, number];
  await enqueue(tx, { orgId, kind: 'exception-end', payload: { number: n, ends }, runAt: instantOf(Date.UTC(y, m - 1, d + 1)), dedupeKey: `exception-end:${orgId}:${n}:${ends}` });
}

/** A steward item about one exception; `about` keeps an open item to grant it apart from one to renew or complete it. */
async function stewardItem(tx: Db, orgId: string, e: Pick<ExceptionRow, 'number' | 'line'>, about: 'ask' | 'end' | 'complete', cause: string, title: string, body: string, steward: string | undefined): Promise<string[]> {
  return fileChecks(tx, orgId, (await standardSetting(tx, orgId)).checks, [{ subject: `exception-${about}:${e.number}`, cause, title, body, records: [e.line], ...(steward ? { stewards: [steward] } : {}) }]);
}

/**
 * When an exception stops being in force, each record that departs from its
 * line under it, accepted while it stood, is filed to be checked again: the
 * departure has nothing behind it now.
 */
async function departuresLeft(tx: Db, orgId: string, e: ExceptionRow, why: string): Promise<string[]> {
  const byId = await treeOf(tx, orgId);
  const rows = await tx.query<{ id: string; prefix: string; number: number; inherits: { line: string; stance: string; scope: string }[] }>(
    "select d.id, r.prefix, d.number, d.inherits from decisions d join decision_registries r on r.id = d.registry_id where d.org_id = $1 and d.status = 'accepted' and d.inherits @> $2::jsonb",
    [orgId, JSON.stringify([{ line: e.line, stance: 'departs' }])],
  );
  const lineRow = await placedById(tx, orgId, e.line);
  const lineRef = lineRow ? refOf(lineRow) : e.line;
  const left = rows.filter((r) => (!e.records.length || e.records.includes(r.id)) && r.inherits.some((i) => i.line === e.line && i.stance === 'departs' && bindingChain(i.scope, byId).includes(e.scope)));
  return fileChecks(
    tx,
    orgId,
    (await standardSetting(tx, orgId)).checks,
    left.map((r) => ({ subject: `recheck:${r.id}:${e.line}`, cause: `${EXCEPTIONS}/${e.number}:${why}`, title: `Check ${refOf(r)}: ${EXCEPTIONS}/${e.number} no longer covers its departure from ${lineRef}`, body: `${EXCEPTIONS}/${e.number} is ${why}, and ${refOf(r)} departs from ${lineRef} under it. Change the record so it builds to the line, ask for a new exception, or deprecate the record.`, records: [r.id, e.line] })),
  );
}

/** Asks for a new exception from its text. */
export async function askException(ctx: AppContext, p: Principal, text: string, surface: Surface): Promise<{ number: number; message: string }> {
  if (!(await accessibleWorkspaces(ctx.db, p)).some((w) => w.role === 'author')) throw forbidden('asking for an exception needs the author role in a workspace');
  const f = readExceptionText(text);
  if (!f.line) throw badRequest('line: names the record whose line the exception bends: line: PAY-3001');
  if (!f.scope) throw badRequest('covers: { scope: <scope> } names where it stands, with every scope below');
  if (!f.reason.trim()) throw badRequest('below the header, give the reason for the exception');
  if (!f.safeguard.trim()) throw badRequest('safeguard: says what stands in for the line while the exception holds');
  if (!f.ends) throw badRequest('ends: names the last day it is in force: ends: 2027-03-31');
  const line = await placedByRef(ctx.db, p.orgId, f.line);
  if (!line) throw badRequest(`line: no record ${f.line}`);
  const byId = await treeOf(ctx.db, p.orgId);
  const facts = await lineFacts(ctx.db, p.orgId, line, byId);
  if (facts.locked && facts.lockedBy === undefined) throw badRequest(`${refOf(line)} is locked, and the estate names no scope that grants on a locked line (standard#exceptions.locked_by); it takes no exception`);
  const scope = await coveredScope(ctx.db, p.orgId, f.scope, line);
  const records = await recordIds(ctx.db, p.orgId, f.records);
  const who = await personOf(ctx.db, p);
  const { number, filed } = await ctx.db.transaction(async (tx) => {
    await lockStandards(tx, p.orgId);
    const number = Number((await tx.query<{ n: number }>('select coalesce(max(number), 0) + 1 as n from standard_exceptions where org_id = $1', [p.orgId]))[0]!.n);
    await tx.query('insert into standard_exceptions (org_id, number, id, line, scope, records, things, reason, safeguard, ends, state, asked_by, asked_by_user) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)', [p.orgId, number, `exception:${ulid()}`, line.id, scope, JSON.stringify(records), JSON.stringify(f.things), f.reason.trim(), f.safeguard.trim(), f.ends, 'requested', who, p.userId]);
    const filed = await stewardItem(tx, p.orgId, { number, line: line.id }, 'ask', 'asked', `Grant or refuse ${EXCEPTIONS}/${number}: ${refOf(line)} in ${scopeName(scope)}`, `${who} asks for an exception to ${refOf(line)} in ${scopeName(scope)} until ${f.ends}.\n\n${f.reason.trim()}\n\nRead ${EXCEPTIONS}/${number}. Grant it with a patch of its header, state: granted; or set state: revoked to refuse it.`, facts.locked ? facts.lockedBy?.steward : facts.steward);
    return { number, filed };
  });
  await audit(ctx.db, ctx.log, { orgId: p.orgId, who, what: 'standard.exception.ask', surface, target: `${EXCEPTIONS}/${number}`, details: { line: refOf(line), scope: scopeName(scope), ends: f.ends } });
  return { number, message: `asked for ${EXCEPTIONS}/${number}: ${refOf(line)} in ${scopeName(scope)} until ${f.ends}, for the steward of ${facts.locked && facts.lockedBy ? `${facts.lockedBy.scope}${facts.lockedBy.steward ? ` (${facts.lockedBy.steward})` : ''}, which grants on locked lines,` : `${scopeName(facts.scope)}${facts.steward ? ` (${facts.steward})` : ' (an admin)'}`} to grant${filed.length ? `; filed ${filed.join(', ')}` : ''}` };
}

/** Applies a written change to one exception: its terms while it is asked for, its grant, its revocation, or its renewal. */
export async function changeException(ctx: AppContext, p: Principal, n: number, current: ExceptionFields, next: ExceptionFields, surface: Surface): Promise<{ status: 'saved' | 'unchanged'; message: string }> {
  const e = await exceptionOf(ctx.db, p.orgId, n);
  if (!e) throw new HttpError(404, `no ${EXCEPTIONS}/${n}; vantage_outline ${EXCEPTIONS} lists them`);
  for (const k of ['exception', 'id', 'asked_by', 'asked', 'granted_by', 'granted', 'source', 'steward', 'closed'] as const) {
    if (JSON.stringify(next.readOnly[k]) !== JSON.stringify(current.readOnly[k])) throw badRequest(`${k} stays as the hub keeps it`);
  }
  const terms = (['line', 'scope', 'records', 'things', 'safeguard', 'reason'] as const).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(current[k]));
  const endMoved = next.ends !== current.ends;
  const stateMoved = next.state !== current.state;
  if (!terms.length && !endMoved && !stateMoved) return { status: 'unchanged', message: `unchanged: ${EXCEPTIONS}/${n}` };
  const line = (await placedById(ctx.db, p.orgId, e.line))!;
  const byId = await treeOf(ctx.db, p.orgId);
  const facts = await lineFacts(ctx.db, p.orgId, line, byId);
  const grantor = await mayGrant(ctx.db, p, facts, byId);
  const today = dayOf();
  const open = e.state === 'requested' || e.state === 'incomplete';
  const set: Record<string, unknown> = {};
  if (terms.length) {
    if (!open) throw badRequest(`${EXCEPTIONS}/${n} is ${e.state}; its ${terms.join(', ')} stay as granted. Ask for a new exception for other terms`);
    if (!grantor && e.asked_by_user !== p.userId) throw forbidden(`only who asked for ${EXCEPTIONS}/${n}, or one who may grant it, changes its terms`);
    const nextLine = next.line && next.line !== current.line ? await placedByRef(ctx.db, p.orgId, next.line) : line;
    if (!nextLine) throw badRequest(`line: no record ${next.line}`);
    set['line'] = nextLine.id;
    set['scope'] = await coveredScope(ctx.db, p.orgId, next.scope || scopeName(e.scope), nextLine);
    set['records'] = JSON.stringify(await recordIds(ctx.db, p.orgId, next.records));
    set['things'] = JSON.stringify(next.things);
    set['safeguard'] = next.safeguard.trim();
    set['reason'] = next.reason.trim();
  }
  if (endMoved) {
    if (!next.ends) throw badRequest('ends: names the last day it is in force');
    if (!open) {
      if (!grantor) throw forbidden(`only the steward of ${scopeName(facts.scope)}, or a grantor the setting names, renews ${EXCEPTIONS}/${n}`);
      if (!facts.rule.renews) throw badRequest(`the estate's rule for this line does not renew exceptions (standard#exceptions.rules); ask for a new one`);
      if (e.state === 'revoked') throw badRequest(`${EXCEPTIONS}/${n} is revoked; ask for a new one`);
      if (current.ends && next.ends < current.ends) throw badRequest('a renewal moves the end later; to end it sooner, set state: revoked');
    }
    set['ends'] = next.ends;
  }
  const ends = (set['ends'] as string | undefined) ?? e.ends;
  let state: ExceptionState = e.state;
  if (stateMoved) {
    if (next.state === 'granted') {
      if (!grantor) throw forbidden(facts.locked ? `${refOf(line)} is locked; only the steward of the scope locked_by names grants on it` : `only the steward of ${scopeName(facts.scope)}${facts.steward ? ` (${facts.steward})` : ''}, a grantor the setting names, or an admin grants ${EXCEPTIONS}/${n}`);
      if (e.state === 'revoked') throw badRequest(`${EXCEPTIONS}/${n} is revoked; ask for a new one`);
      if (facts.rule.separate && e.asked_by_user === p.userId) throw forbidden(`the estate's rule for this line keeps who grants apart from who asked (standard#exceptions.rules.separate); another steward or grantor grants ${EXCEPTIONS}/${n}`);
      const missing = missingOf({ reason: (set['reason'] as string | undefined) ?? e.reason, ends, asked_by: e.asked_by });
      if (missing.length) throw badRequest(`${EXCEPTIONS}/${n} lacks ${missing.join(', ')}; complete it before it is granted`);
    } else if (next.state === 'revoked') {
      if (!grantor) throw forbidden(`only the steward of ${scopeName(facts.scope)}, or a grantor the setting names, revokes ${EXCEPTIONS}/${n}`);
    } else throw badRequest(`state moves to granted or revoked; ${next.state} is the hub's to set`);
    state = next.state;
  } else if (endMoved && e.state === 'ended') state = 'granted';
  if (state === 'granted' && (stateMoved || endMoved)) {
    if (!ends || ends < today) throw badRequest(`ends: ${ends ?? 'none'} is past; a granted exception ends today or later`);
    const longest = addDays(today, facts.rule.longest_days);
    if (ends > longest) throw badRequest(`ends: ${ends} runs past the longest the estate's rule allows for this line, ${facts.rule.longest_days} days (until ${longest}; standard#exceptions.rules)`);
  }
  if (state !== e.state) set['state'] = state;
  if (state === 'granted' && e.state !== 'granted') {
    set['granted_by'] = await personOf(ctx.db, p);
    set['granted_by_user'] = p.userId;
  }
  // An import that lacked its terms is asked for once they are all there.
  if (e.state === 'incomplete' && state === 'incomplete' && !missingOf({ reason: (set['reason'] as string | undefined) ?? e.reason, ends, asked_by: e.asked_by }).length) set['state'] = 'requested';
  const who = await personOf(ctx.db, p);
  await ctx.db.transaction(async (tx) => {
    await lockStandards(tx, p.orgId);
    const cols = Object.keys(set);
    const stamp = [...(state === 'granted' && (stateMoved || e.state === 'ended') ? ['granted_at = now()'] : []), ...(state === 'revoked' && stateMoved ? ['closed_at = now()'] : [])];
    await tx.query(`update standard_exceptions set ${[...cols.map((c, i) => `${c} = $${i + 3}`), ...stamp].join(', ')} where org_id = $1 and number = $2`, [p.orgId, n, ...cols.map((c) => set[c])]);
    if (state === 'granted' && ends) await queueEnd(tx, p.orgId, n, ends);
    if (state === 'revoked' && e.state === 'granted') await departuresLeft(tx, p.orgId, e, 'revoked');
    await rebuildStandards(ctx, tx, p.orgId, who);
  });
  const said = stateMoved ? `${state} ${EXCEPTIONS}/${n}` : endMoved && !open ? `renewed ${EXCEPTIONS}/${n} until ${ends}` : `saved ${EXCEPTIONS}/${n} (${[...terms, ...(endMoved ? ['ends'] : [])].join(', ')})`;
  await audit(ctx.db, ctx.log, { orgId: p.orgId, who, what: 'standard.exception', surface, target: `${EXCEPTIONS}/${n}`, details: { state, ends, terms } });
  return { status: 'saved', message: said };
}

/** The job queued for the day after an exception's last: it ends one still granted on that end, and asks its steward to renew it or let it go. */
export async function endException(ctx: AppContext, orgId: string, n: number, ends: string): Promise<'ended' | 'moved'> {
  return ctx.db.transaction(async (tx) => {
    await lockStandards(tx, orgId);
    const e = await exceptionOf(tx, orgId, n);
    if (!e || e.state !== 'granted' || e.ends !== ends || ends >= dayOf()) return 'moved';
    await tx.query("update standard_exceptions set state = 'ended', closed_at = now() where org_id = $1 and number = $2", [orgId, n]);
    const line = await placedById(tx, orgId, e.line);
    const byId = await treeOf(tx, orgId);
    const facts = line ? await lineFacts(tx, orgId, line, byId) : undefined;
    await stewardItem(tx, orgId, e, 'end', ends, `${EXCEPTIONS}/${n} ended on ${ends}: renew it or let ${line ? refOf(line) : 'its line'} hold`, `${EXCEPTIONS}/${n} let ${line ? refOf(line) : 'a line'} bend in ${scopeName(e.scope)} until ${ends}, and has ended. Renew it with a patch of its ends, if the estate's rule renews, or leave it ended so the line holds again.`, facts?.steward);
    await departuresLeft(tx, orgId, e, `ended on ${ends}`);
    await rebuildStandards(ctx, tx, orgId, 'hub');
    ctx.log.info('standards.exception_ended', { orgId, exception: n, ends });
    return 'ended';
  });
}

/** Who grants an exception, as its text names them. */
export async function grantsText(db: Db, orgId: string, e: Pick<ExceptionRow, 'line'>): Promise<string> {
  const line = await placedById(db, orgId, e.line);
  if (!line?.position) return 'an admin';
  const f = await lineFacts(db, orgId, line, await treeOf(db, orgId));
  if (f.locked) return f.lockedBy ? `${f.lockedBy.scope} (${f.lockedBy.steward ?? 'an admin'}), which grants on locked lines` : 'none: the line is locked';
  return `${scopeName(f.scope)} (${f.steward ?? 'an admin'})${f.rule.grantors.length ? `, or ${f.rule.grantors.join(', ')}` : ''}`;
}

export const readException = (ctx: AppContext, p: Principal, n: number): Promise<{ address: string; version: string; text: string }> => exceptionThing(ctx, p, n, (e) => grantsText(ctx.db, p.orgId, e));

/** A whole new text for one exception: compared with its text now, and only what differs is changed. */
export async function rewriteException(ctx: AppContext, p: Principal, n: number, text: string, surface: Surface): Promise<{ status: 'saved' | 'unchanged'; message: string }> {
  const now = await readException(ctx, p, n);
  return changeException(ctx, p, n, readExceptionText(now.text), readExceptionText(text), surface);
}

/** One exception another store keeps, as an agent read it there. */
export interface ImportEntry {
  readonly store: string;
  readonly ref: string;
  readonly line: string;
  readonly scope: string;
  readonly records?: readonly string[] | undefined;
  readonly things?: readonly string[] | undefined;
  readonly reason?: string | undefined;
  readonly safeguard?: string | undefined;
  readonly owner?: string | undefined;
  readonly ends?: string | undefined;
}

/**
 * Brings exceptions in from another store. One with its owner, reason, and
 * end arrives granted by that owner (ended, if its end is past); one that
 * lacks any arrives incomplete, as a steward item. One seen before is skipped.
 */
export async function importExceptions(ctx: AppContext, p: Principal, entries: readonly ImportEntry[], dryRun: boolean): Promise<string> {
  if (!(await accessibleWorkspaces(ctx.db, p)).some((w) => w.role === 'author')) throw forbidden('importing exceptions needs the author role in a workspace');
  const byId = await treeOf(ctx.db, p.orgId);
  const today = dayOf();
  const out: string[] = [];
  const plan: { e: ImportEntry; line: PlacedRow; scope: ScopeKey; records: string[]; state: ExceptionState; missing: string[]; steward: string | undefined; said: string }[] = [];
  let skipped = 0;
  for (const [i, e] of entries.entries()) {
    const at = `${i + 1} (${e.store}:${e.ref})`;
    try {
      if (await maybe(ctx.db, 'select 1 as x from standard_exceptions where org_id = $1 and source_store = $2 and source_ref = $3', [p.orgId, e.store, e.ref])) {
        skipped += 1;
        continue;
      }
      const line = await placedByRef(ctx.db, p.orgId, e.line);
      if (!line) throw badRequest(`no record ${e.line}`);
      const facts = await lineFacts(ctx.db, p.orgId, line, byId);
      const scope = await coveredScope(ctx.db, p.orgId, e.scope, line);
      const ends = e.ends ? (/^\d{4}-\d{2}-\d{2}$/.test(e.ends) ? e.ends : (() => { throw badRequest(`ends ${e.ends} is not YYYY-MM-DD`); })()) : null;
      const missing = missingOf({ reason: e.reason ?? '', ends, asked_by: e.owner ?? null });
      const state: ExceptionState = missing.length ? 'incomplete' : ends! < today ? 'ended' : 'granted';
      plan.push({ e, line, scope, records: await recordIds(ctx.db, p.orgId, e.records ?? []), state, missing, steward: facts.steward, said: `${at} -> ${state}: ${refOf(line)} in ${scopeName(scope)}${missing.length ? `, lacks ${missing.join(', ')}` : ` until ${ends}`}` });
    } catch (err) {
      out.push(`${at}: not imported: ${(err as Error).message}`);
    }
  }
  const head = `${dryRun ? 'Would import' : 'Imported'} ${plan.length} exception${plan.length === 1 ? '' : 's'}${skipped ? `; ${skipped} already here` : ''}`;
  if (dryRun || !plan.length) return [head, ...plan.map((x) => x.said), ...out].join('\n');
  const who = await personOf(ctx.db, p);
  const numbers = await ctx.db.transaction(async (tx) => {
    await lockStandards(tx, p.orgId);
    let next = Number((await tx.query<{ n: number }>('select coalesce(max(number), 0) + 1 as n from standard_exceptions where org_id = $1', [p.orgId]))[0]!.n);
    const made: number[] = [];
    for (const x of plan) {
      const n = next++;
      const granted = x.state === 'granted' || x.state === 'ended';
      await tx.query(
        `insert into standard_exceptions (org_id, number, id, line, scope, records, things, reason, safeguard, ends, state, asked_by, granted_by, granted_at, closed_at, source_store, source_ref)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, ${granted ? 'now()' : 'null'}, ${x.state === 'ended' ? 'now()' : 'null'}, $14, $15)`,
        [p.orgId, n, `exception:${ulid()}`, x.line.id, x.scope, JSON.stringify(x.records), JSON.stringify(x.e.things ?? []), (x.e.reason ?? '').trim(), (x.e.safeguard ?? '').trim(), x.e.ends ?? null, x.state, x.e.owner ?? null, granted ? x.e.owner! : null, x.e.store, x.e.ref],
      );
      if (x.state === 'granted') await queueEnd(tx, p.orgId, n, x.e.ends!);
      if (x.state === 'incomplete') await stewardItem(tx, p.orgId, { number: n, line: x.line.id }, 'complete', 'imported', `Complete ${EXCEPTIONS}/${n} from ${x.e.store}: it lacks ${x.missing.join(', ')}`, `${x.e.store} keeps an exception to ${refOf(x.line)} (${x.e.ref}) with no ${x.missing.join(', no ')}. Read ${EXCEPTIONS}/${n}, fill in what it lacks, and grant it or revoke it.`, x.steward);
      made.push(n);
    }
    await rebuildStandards(ctx, tx, p.orgId, who);
    return made;
  });
  await audit(ctx.db, ctx.log, { orgId: p.orgId, who, what: 'standard.exception.import', surface: p.surface, target: EXCEPTIONS, details: { imported: numbers.length, skipped } });
  return [head, ...plan.map((x, i) => `${x.said} as ${EXCEPTIONS}/${numbers[i]}`), ...out].join('\n');
}

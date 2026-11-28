/**
 * A conflict (VAN-3019): two lines that reach the same scope and cannot
 * both hold. Anyone who may author flags one at `conflicts`; the hub names
 * who rules: the steward of the nearest scope at or above both lines' own
 * scopes, or, when one line came through a program and the other through
 * the owner, the steward of each line's own scope. One of them, or an
 * admin, rules on it at `conflicts/<n>`. Until the ruling the clash rule
 * decides what holds, in every build.
 */
import { parse, stringify } from 'yaml';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import type { Principal } from '../auth/principal.ts';
import { accessibleWorkspaces } from '../authz.ts';
import { audit, type Surface } from '../audit.ts';
import { badRequest, forbidden, HttpError } from '../http.ts';
import { whoOf } from '../decisions/write.ts';
import { placedByIds, placedByRef, refOf } from '../decisions/repo.ts';
import { listScopes, type Scope } from '../scopes/repo.ts';
import { scopeSetting } from '../scopes/setting.ts';
import { dayOf } from '../day.ts';
import { fileChecks } from './checks.ts';
import { sharedScope } from './build.ts';
import { scopeKey, scopeName, type ScopeKey } from './model.ts';
import { rebuildStandards } from './publish.ts';
import { conflictOf, editionOf, listConflicts, lockStandards, type ConflictRow, type ConflictSteward, type Ruling } from './repo.ts';
import { sha256 } from '../crypto.ts';
import { standardSetting } from './setting.ts';
import { actsFor } from './steward.ts';

export const CONFLICTS = 'conflicts';
export const RULINGS = ['change', 'narrow', 'exception'] as const satisfies readonly Ruling[];

const stewardText = (s: ConflictSteward): string => `${scopeName(s.scope)} (${s.steward ?? 'an admin'})`;

const day = (d: Date | null): string | undefined => (d ? dayOf(d) : undefined);

export async function conflictText(db: Db, orgId: string, c: ConflictRow): Promise<string> {
  const refs = new Map((await placedByIds(db, orgId, c.lines)).map((r) => [r.id, refOf(r)]));
  const header = {
    conflict: c.number,
    state: c.state,
    scope: scopeName(c.scope),
    lines: c.lines.map((id) => refs.get(id) ?? id),
    stewards: c.stewards.map(stewardText),
    filed: day(c.filed_at),
    ...(c.filed_by ? { filed_by: c.filed_by } : {}),
    ...(c.ruling ? { ruling: c.ruling } : {}),
    ...(c.exception ? { exception: c.exception } : {}),
    ...(c.note ? { note: c.note } : {}),
    ...(c.ruled_at ? { ruled: day(c.ruled_at) } : {}),
    ...(c.ruled_by ? { ruled_by: c.ruled_by } : {}),
  };
  return `---\n${stringify(header, { lineWidth: 0 })}---\n\n${c.why.trim()}\n`;
}

/** A conflict's text, read: its header fields and the why below it. */
function readText(text: string): { header: Record<string, unknown>; why: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.replace(/^﻿/, ''));
  if (!m) throw badRequest('a conflict is a header between two --- lines (lines: [A, B], scope: <scope>), then why the two cannot both hold (guide#standards)');
  let header: unknown;
  try {
    header = parse(m[1]!) ?? {};
  } catch (err) {
    throw badRequest(`the conflict's header does not parse: ${(err as Error).message}`);
  }
  if (typeof header !== 'object' || header === null || Array.isArray(header)) throw badRequest("the conflict's header is a map of fields");
  return { header: header as Record<string, unknown>, why: m[2]!.trim() };
}

async function treeOf(db: Db, orgId: string): Promise<Map<string, Scope>> {
  return new Map((await listScopes(db, orgId, (await scopeSetting(db, orgId)).source)).map((s) => [s.id, s]));
}

/** Flags a new conflict from its text; answers the line the write reports. */
export async function flagConflict(ctx: AppContext, p: Principal, text: string, surface: Surface): Promise<{ number: number; message: string }> {
  if (!(await accessibleWorkspaces(ctx.db, p)).some((w) => w.role === 'author')) throw forbidden('flagging a conflict needs the author role in a workspace');
  const { header, why } = readText(text);
  const lines = header['lines'];
  if (!Array.isArray(lines) || lines.length !== 2) throw badRequest('lines: names the two records whose lines cannot both hold: lines: [PAY-3001, FIN-1002]');
  if (typeof header['scope'] !== 'string') throw badRequest('scope: names the scope both lines reach, where they clash: scope: payments');
  if (!why) throw badRequest('below the header, say why the two lines cannot both hold');
  const name = header['scope'];
  const key = scopeKey(name);
  const edition = await editionOf(ctx.db, p.orgId, key);
  if (!edition) throw new HttpError(404, `no edition of standard/${name}; vantage_outline standard lists the scopes`);
  const rows = [];
  for (const ref of lines.map(String)) {
    const row = await placedByRef(ctx.db, p.orgId, ref);
    if (!row) throw badRequest(`lines: no record ${ref}`);
    if (!edition.body.lines.some((l) => l.record === row.id)) throw badRequest(`lines: ${ref} sets no line in standard/${name}@${edition.version}; a conflict is between two lines that reach the same scope`);
    rows.push(row);
  }
  const [a, b] = rows as [(typeof rows)[0], (typeof rows)[0]];
  if (a.id === b.id) throw badRequest('lines: name two different records');
  const byId = await treeOf(ctx.db, p.orgId);
  const from = (id: string): ScopeKey => edition.body.lines.find((l) => l.record === id)!.from;
  const lineOf = (id: string) => edition.body.lines.find((l) => l.record === id)!;
  const steward = (k: ScopeKey): ConflictSteward => ({ scope: k, steward: (k === '' ? undefined : byId.get(k)?.steward) ?? null });
  // Across the two axes each line's own steward rules; inside one tree, the nearest scope both share.
  const across = (lineOf(a.id).program === undefined) !== (lineOf(b.id).program === undefined);
  const stewards = across ? [...new Map([steward(from(a.id)), steward(from(b.id))].map((s) => [s.scope, s])).values()] : [steward(sharedScope(from(a.id), from(b.id), byId))];
  const who = whoOf(p);
  const { number, filed } = await ctx.db.transaction(async (tx) => {
    await lockStandards(tx, p.orgId);
    const twice = await maybe<{ number: number }>(tx, "select number from standard_conflicts where org_id = $1 and state = 'open' and scope = $2 and lines @> $3::jsonb", [p.orgId, key, JSON.stringify([a.id, b.id])]);
    if (twice) throw badRequest(`conflicts/${twice.number} already holds ${refOf(a)} and ${refOf(b)} in ${name}`);
    const number = Number((await tx.query<{ n: number }>('select coalesce(max(number), 0) + 1 as n from standard_conflicts where org_id = $1', [p.orgId]))[0]!.n);
    await tx.query('insert into standard_conflicts (org_id, number, scope, lines, stewards, why, filed_by) values ($1, $2, $3, $4, $5, $6, $7)', [p.orgId, number, key, JSON.stringify([a.id, b.id]), JSON.stringify(stewards), why, who]);
    await rebuildStandards(ctx, tx, p.orgId, who);
    const filed = await fileChecks(tx, p.orgId, (await standardSetting(tx, p.orgId)).checks, [
      {
        subject: `conflict:${number}`,
        cause: 'flagged',
        title: `Rule on conflicts/${number}: ${refOf(a)} and ${refOf(b)} in ${name}`,
        body: `${refOf(a)} and ${refOf(b)} both reach ${name} and cannot both hold. Read conflicts/${number}, then rule with a patch of its header: ruling: change, narrow, or exception, and a note.\n\n${why}`,
        records: [a.id, b.id],
        stewards: stewards.flatMap((s) => (s.steward ? [s.steward] : [])),
      },
    ]);
    return { number, filed };
  });
  await audit(ctx.db, ctx.log, { orgId: p.orgId, who, what: 'standard.conflict', surface, target: `conflicts/${number}`, details: { lines: [refOf(a), refOf(b)], scope: name } });
  return { number, message: `flagged conflicts/${number}: ${refOf(a)} and ${refOf(b)} in ${name}, for the steward${stewards.length > 1 ? 's' : ''} of ${stewards.map(stewardText).join(' and ')}${filed.length ? `; filed ${filed.join(', ')}` : ''}` };
}

/** A steward's ruling, written into the conflict's header; nothing else of a conflict changes. */
export async function ruleConflict(ctx: AppContext, p: Principal, n: number, text: string, surface: Surface): Promise<{ status: 'saved' | 'unchanged'; message: string }> {
  const c = await conflictOf(ctx.db, p.orgId, n);
  if (!c) throw new HttpError(404, `no conflicts/${n}; vantage_outline conflicts lists them`);
  const current = readText(await conflictText(ctx.db, p.orgId, c));
  const next = readText(text);
  for (const k of ['conflict', 'state', 'scope', 'lines', 'stewards', 'filed', 'filed_by', 'ruled', 'ruled_by']) {
    if (JSON.stringify(next.header[k]) !== JSON.stringify(current.header[k])) throw badRequest(`${k} stays as the hub keeps it; a conflict changes only by its ruling: ruling, note${k === 'lines' || k === 'scope' ? ', and two other lines are a new conflict at conflicts' : ''}`);
  }
  if (next.why !== current.why) throw badRequest("why stays as it was flagged; say what the ruling decides in its note");
  const ruling = next.header['ruling'];
  if (ruling === undefined && current.header['ruling'] === undefined) return { status: 'unchanged', message: `unchanged: conflicts/${n}` };
  if (c.state === 'ruled') {
    if (['ruling', 'note', 'exception'].every((k) => JSON.stringify(next.header[k]) === JSON.stringify(current.header[k]))) return { status: 'unchanged', message: `unchanged: conflicts/${n}` };
    throw badRequest(`conflicts/${n} is ruled; its ruling stands. Flag a new conflict at conflicts if the lines still clash`);
  }
  if (!RULINGS.includes(ruling as Ruling)) throw badRequest(`ruling is one of ${RULINGS.join(', ')}`);
  const note = typeof next.header['note'] === 'string' ? next.header['note'].trim() : '';
  if (!note) throw badRequest('a ruling carries a note: what changes, which line narrows, or which exception stands');
  const exception = typeof next.header['exception'] === 'string' ? next.header['exception'].trim() : undefined;
  if (ruling === 'exception' && !exception) throw badRequest('a ruling of exception names the exception that stands: exception: <its citation>');
  let may = false;
  for (const s of c.stewards) may ||= await actsFor(ctx.db, p, s.steward ?? undefined);
  if (!may && !p.admin) throw forbidden(`only the steward of ${c.stewards.map(stewardText).join(' or ')}, or an admin, rules on conflicts/${n}`);
  const who = whoOf(p);
  await ctx.db.transaction(async (tx) => {
    await lockStandards(tx, p.orgId);
    await tx.query("update standard_conflicts set state = 'ruled', ruling = $3, note = $4, exception = $5, ruled_by = $6, ruled_at = now() where org_id = $1 and number = $2", [p.orgId, n, ruling, note, exception ?? null, who]);
    await rebuildStandards(ctx, tx, p.orgId, who);
  });
  await audit(ctx.db, ctx.log, { orgId: p.orgId, who, what: 'standard.ruling', surface, target: `conflicts/${n}`, details: { ruling, note } });
  return { status: 'saved', message: `ruled conflicts/${n}: ${String(ruling)}` };
}

/** The text a new conflict starts from. */
export const CONFLICT_TEMPLATE = `---
lines: [PAY-3001, FIN-1002]
scope: payments
---

Why the two lines cannot both hold in this scope.
`;

/** One line per conflict, open first: what `conflicts` reads and outlines. */
export async function conflictsLines(db: Db, orgId: string): Promise<string[]> {
  const rows = await listConflicts(db, orgId);
  const refs = new Map((await placedByIds(db, orgId, rows.flatMap((c) => c.lines))).map((r) => [r.id, refOf(r)]));
  const line = (c: ConflictRow): string => {
    const [a, b] = c.lines.map((id) => refs.get(id) ?? id);
    return `${CONFLICTS}/${c.number}  ${c.state}  ${a} and ${b} in ${scopeName(c.scope)}; ${c.state === 'open' ? `for the steward${c.stewards.length > 1 ? 's' : ''} of ${c.stewards.map(stewardText).join(' and ')}, flagged ${day(c.filed_at)}` : `ruled ${c.ruling} ${day(c.ruled_at)}`}`;
  };
  const open = rows.filter((c) => c.state === 'open');
  const ruled = rows.filter((c) => c.state === 'ruled');
  return [`${CONFLICTS}: ${open.length} open, ${ruled.length} ruled${rows.length === 50 ? ' (the newest 50)' : ''}`, ...open.map(line), ...ruled.map(line)];
}

export async function conflictsThing(ctx: AppContext, p: Principal): Promise<{ address: string; version: string; text: string }> {
  const text = `${(await conflictsLines(ctx.db, p.orgId)).join('\n')}\n`;
  return { address: CONFLICTS, version: (await sha256(text)).slice(0, 16), text };
}

export async function conflictThing(ctx: AppContext, p: Principal, n: number): Promise<{ address: string; version: string; text: string }> {
  const c = await conflictOf(ctx.db, p.orgId, n);
  if (!c) throw new HttpError(404, `no ${CONFLICTS}/${n}; vantage_outline ${CONFLICTS} lists them`);
  const text = await conflictText(ctx.db, p.orgId, c);
  return { address: `${CONFLICTS}/${n}`, version: (await sha256(text)).slice(0, 16), text };
}

export async function conflictsOutline(ctx: AppContext, p: Principal): Promise<string[]> {
  return [...(await conflictsLines(ctx.db, p.orgId)), '', `A new conflict: vantage_write to ${CONFLICTS} with this text, filled in:`, ...CONFLICT_TEMPLATE.trimEnd().split('\n'), `The steward rules with a vantage_patch of ${CONFLICTS}/<n>: add ruling: change, narrow, or exception, and note:.`];
}

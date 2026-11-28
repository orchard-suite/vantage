/**
 * An exception as text at `exceptions/<n>`, the list at `exceptions`, and
 * the JSON the code that deploys policy reads (VAN-3020). The header holds
 * its terms and where it stands; the body is the reason.
 */
import { parse, stringify } from 'yaml';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/db.ts';
import type { Principal } from '../auth/principal.ts';
import { badRequest, HttpError } from '../http.ts';
import { sha256 } from '../crypto.ts';
import { placedByIds, refOf } from '../decisions/repo.ts';
import { dayOf } from '../day.ts';
import { exceptionOf, EXCEPTIONS, inForce, listExceptions, type ExceptionFilter, type ExceptionRow, type ExceptionState } from './exceptions.ts';
import { scopeName } from './model.ts';

/** What a write of an exception's text says: the terms a writer may change, its state, and the fields only the hub keeps. */
export interface ExceptionFields {
  readonly line: string;
  readonly scope: string;
  readonly records: readonly string[];
  readonly things: readonly string[];
  readonly safeguard: string;
  readonly ends: string | undefined;
  readonly reason: string;
  readonly state: string | undefined;
  readonly readOnly: Readonly<Record<'exception' | 'id' | 'asked_by' | 'asked' | 'granted_by' | 'granted' | 'source' | 'steward' | 'closed', unknown>>;
}

const list = (v: unknown, what: string): string[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw badRequest(`${what} is a list`);
  return v.map((x) => String(x).trim()).filter(Boolean);
};

const day = (v: unknown): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw badRequest(`ends: ${s} is not a day; write it as YYYY-MM-DD`);
  return s;
};

export function readExceptionText(text: string): ExceptionFields {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.replace(/^﻿/, ''));
  if (!m) throw badRequest('an exception is a header between two --- lines (line, covers, safeguard, ends), then its reason (guide#standards)');
  let raw: unknown;
  try {
    raw = parse(m[1]!) ?? {};
  } catch (err) {
    throw badRequest(`the exception's header does not parse: ${(err as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw badRequest("the exception's header is a map of fields");
  const h = raw as Record<string, unknown>;
  const covers = (h['covers'] ?? {}) as Record<string, unknown>;
  if (typeof covers !== 'object' || Array.isArray(covers)) throw badRequest('covers is a map: { scope, records, things }');
  return {
    line: typeof h['line'] === 'string' ? h['line'].trim() : '',
    scope: typeof covers['scope'] === 'string' ? covers['scope'].trim() : '',
    records: list(covers['records'], 'covers.records'),
    things: list(covers['things'], 'covers.things'),
    safeguard: typeof h['safeguard'] === 'string' ? h['safeguard'] : '',
    ends: day(h['ends']),
    reason: m[2]!.trim(),
    state: typeof h['state'] === 'string' ? h['state'] : undefined,
    readOnly: { exception: h['exception'], id: h['id'], asked_by: h['asked_by'], asked: h['asked'], granted_by: h['granted_by'], granted: h['granted'], source: h['source'], steward: h['steward'], closed: h['closed'] },
  };
}

const when = (d: Date | null): string | undefined => (d ? dayOf(d) : undefined);

async function refsOf(db: Db, orgId: string, rows: readonly ExceptionRow[]): Promise<Map<string, string>> {
  return new Map((await placedByIds(db, orgId, [...new Set(rows.flatMap((e) => [e.line, ...e.records]))])).map((r) => [r.id, refOf(r)]));
}

/** The state as a reader needs it: granted but past its end reads as ending, until the hub ends it. */
const stateText = (e: ExceptionRow): ExceptionState | 'past its end' => (e.state === 'granted' && !inForce(e) ? 'past its end' : e.state);

export async function exceptionText(db: Db, orgId: string, e: ExceptionRow, steward: string): Promise<string> {
  const refs = await refsOf(db, orgId, [e]);
  const header = {
    exception: e.number,
    id: e.id,
    state: e.state,
    line: refs.get(e.line) ?? e.line,
    covers: { scope: scopeName(e.scope), ...(e.records.length ? { records: e.records.map((r) => refs.get(r) ?? r) } : {}), ...(e.things.length ? { things: e.things } : {}) },
    safeguard: e.safeguard,
    ...(e.ends ? { ends: e.ends } : {}),
    steward,
    ...(e.asked_by ? { asked_by: e.asked_by } : {}),
    asked: when(e.asked_at),
    ...(e.granted_by ? { granted_by: e.granted_by } : {}),
    ...(e.granted_at ? { granted: when(e.granted_at) } : {}),
    ...(e.closed_at ? { closed: when(e.closed_at) } : {}),
    ...(e.source_store ? { source: { store: e.source_store, ref: e.source_ref } } : {}),
  };
  return `---\n${stringify(header, { lineWidth: 0 })}---\n\n${e.reason.trim() || '_No reason given yet._'}\n`;
}

/** One line per exception, newest first, and the count on each line: what `exceptions` reads and outlines. */
export async function exceptionsLines(db: Db, orgId: string): Promise<string[]> {
  const rows = await listExceptions(db, orgId);
  const refs = await refsOf(db, orgId, rows);
  const pressure = new Map<string, number>();
  for (const e of rows) if (inForce(e)) pressure.set(refs.get(e.line) ?? e.line, (pressure.get(refs.get(e.line) ?? e.line) ?? 0) + 1);
  const count = (s: string): number => rows.filter((e) => stateText(e) === s).length;
  return [
    `${EXCEPTIONS}: ${count('granted')} in force, ${count('requested')} asked for, ${count('incomplete')} incomplete, ${count('ended') + count('past its end')} ended, ${count('revoked')} revoked${rows.length === 200 ? ' (the newest 200)' : ''}`,
    ...(pressure.size ? [`in force per line: ${[...pressure].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l, n]) => `${l} ${n}`).join(', ')}`] : []),
    ...rows.map((e) => `${EXCEPTIONS}/${e.number}  ${stateText(e)}  ${refs.get(e.line) ?? e.line} in ${scopeName(e.scope)}${e.ends ? ` until ${e.ends}` : ''}${e.granted_by ? `; granted by ${e.granted_by}` : ''}${e.source_store ? `; from ${e.source_store}` : ''}`),
  ];
}

export const EXCEPTION_TEMPLATE = `---
line: PAY-3001
covers:
  scope: checkout
  records: [CHK-2003]
  things: []
safeguard: What stands in for the line while the exception holds.
ends: 2027-03-31
---

Why the line cannot hold here, for now.
`;

export async function exceptionsThing(ctx: AppContext, p: Principal): Promise<{ address: string; version: string; text: string }> {
  const text = `${(await exceptionsLines(ctx.db, p.orgId)).join('\n')}\n`;
  return { address: EXCEPTIONS, version: (await sha256(text)).slice(0, 16), text };
}

export async function exceptionsOutline(ctx: AppContext, p: Principal): Promise<string[]> {
  return [...(await exceptionsLines(ctx.db, p.orgId)), '', `A new exception: vantage_write to ${EXCEPTIONS} with this text, filled in:`, ...EXCEPTION_TEMPLATE.trimEnd().split('\n'), `The line's steward grants with a vantage_patch of ${EXCEPTIONS}/<n>: state: granted. Bring others in with vantage_tool vantage_exceptions_import.`];
}

/** The JSON a deploy writes an engine's exemption from: its id, what it covers, its end, and the line with what enforces and checks it. */
export interface ExceptionJson {
  readonly id: string;
  readonly number: number;
  readonly state: ExceptionState;
  readonly inForce: boolean;
  readonly line: { readonly ref: string; readonly text: string; readonly enforcedBy: readonly string[]; readonly checkedBy: readonly string[] };
  readonly covers: { readonly scope: string; readonly records: readonly string[]; readonly things: readonly string[] };
  readonly reason: string;
  readonly safeguard: string;
  readonly ends: string | null;
  readonly grantedBy: string | null;
  readonly granted: string | null;
  readonly source: { readonly store: string; readonly ref: string | null } | null;
}

export async function exceptionsJson(db: Db, orgId: string, filter: ExceptionFilter): Promise<ExceptionJson[]> {
  const rows = await listExceptions(db, orgId, filter, 1000);
  const records = new Map((await placedByIds(db, orgId, [...new Set(rows.flatMap((e) => [e.line, ...e.records]))])).map((r) => [r.id, r]));
  const ref = (id: string): string => (records.has(id) ? refOf(records.get(id)!) : id);
  return rows.map((e) => {
    const line = records.get(e.line);
    return {
      id: e.id,
      number: e.number,
      state: e.state,
      inForce: inForce(e),
      line: { ref: ref(e.line), text: line?.position?.line ?? '', enforcedBy: line?.position?.enforced_by ?? [], checkedBy: line?.position?.checked_by ?? [] },
      covers: { scope: scopeName(e.scope), records: e.records.map(ref), things: e.things },
      reason: e.reason,
      safeguard: e.safeguard,
      ends: e.ends,
      grantedBy: e.granted_by,
      granted: e.granted_at ? e.granted_at.toISOString() : null,
      source: e.source_store ? { store: e.source_store, ref: e.source_ref } : null,
    };
  });
}

export async function exceptionThing(ctx: AppContext, p: Principal, n: number, stewardOf: (e: ExceptionRow) => Promise<string>): Promise<{ address: string; version: string; text: string }> {
  const e = await exceptionOf(ctx.db, p.orgId, n);
  if (!e) throw new HttpError(404, `no ${EXCEPTIONS}/${n}; vantage_outline ${EXCEPTIONS} lists them`);
  const text = await exceptionText(ctx.db, p.orgId, e, await stewardOf(e));
  return { address: `${EXCEPTIONS}/${n}`, version: (await sha256(text)).slice(0, 16), text };
}

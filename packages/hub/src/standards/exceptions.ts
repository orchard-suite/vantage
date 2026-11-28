/**
 * Exceptions as the hub keeps them (VAN-3020): the rows, what is in force
 * on a day, where one stands, and the pins an edition carries. Who may
 * ask, grant, revoke, and renew is exception-write.ts.
 */
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { placedByIds, refOf } from '../decisions/repo.ts';
import type { Scope } from '../scopes/repo.ts';
import { dayOf } from '../day.ts';
import { bindingChain } from './build.ts';
import { scopeName, type ExceptionPin, type ScopeKey, type StandardLine } from './model.ts';

export const EXCEPTIONS = 'exceptions';
export const EXCEPTION_STATES = ['requested', 'incomplete', 'granted', 'revoked', 'ended'] as const;
export type ExceptionState = (typeof EXCEPTION_STATES)[number];

export interface ExceptionRow {
  readonly org_id: string;
  readonly number: number;
  readonly id: string;
  /** The record whose line it bends, by id. */
  readonly line: string;
  readonly scope: ScopeKey;
  readonly records: string[];
  readonly things: string[];
  readonly reason: string;
  readonly safeguard: string;
  /** YYYY-MM-DD, the last day in force. */
  readonly ends: string | null;
  readonly state: ExceptionState;
  readonly asked_by: string | null;
  readonly asked_by_user: string | null;
  readonly asked_at: Date;
  readonly granted_by: string | null;
  readonly granted_by_user: string | null;
  readonly granted_at: Date | null;
  readonly closed_at: Date | null;
  readonly source_store: string | null;
  readonly source_ref: string | null;
}

const COLUMNS = 'org_id, number, id, line, scope, records, things, reason, safeguard, ends::text as ends, state, asked_by, asked_by_user, asked_at, granted_by, granted_by_user, granted_at, closed_at, source_store, source_ref';

export async function exceptionOf(db: Db, orgId: string, n: number): Promise<ExceptionRow | undefined> {
  return maybe<ExceptionRow>(db, `select ${COLUMNS} from standard_exceptions where org_id = $1 and number = $2`, [orgId, n]);
}

export interface ExceptionFilter {
  readonly state?: ExceptionState | undefined;
  readonly line?: string | undefined;
}

/** Exceptions newest first, by state or line when asked. */
export async function listExceptions(db: Db, orgId: string, filter: ExceptionFilter = {}, limit = 200): Promise<ExceptionRow[]> {
  return db.query<ExceptionRow>(`select ${COLUMNS} from standard_exceptions where org_id = $1 and ($2::text is null or state = $2) and ($3::text is null or line = $3) order by number desc limit $4`, [orgId, filter.state ?? null, filter.line ?? null, limit]);
}

/** Granted and not past its end on `today`. */
export const inForce = (e: Pick<ExceptionRow, 'state' | 'ends'>, today = dayOf()): boolean => e.state === 'granted' && e.ends !== null && e.ends >= today;

export async function inForceExceptions(db: Db, orgId: string, today = dayOf()): Promise<ExceptionRow[]> {
  return db.query<ExceptionRow>(`select ${COLUMNS} from standard_exceptions where org_id = $1 and state = 'granted' and ends >= $2::date order by number`, [orgId, today]);
}

/** Whether an exception that stands at `at` reaches `key`: at it, or above it. */
export const standsOver = (at: ScopeKey, key: ScopeKey, byId: ReadonlyMap<string, Scope>): boolean => bindingChain(key, byId).includes(at);

/** The pins of the exceptions in force that reach `key` and bend one of its lines. */
export function pinsFor(key: ScopeKey, lines: readonly StandardLine[], rows: readonly ExceptionRow[], refs: ReadonlyMap<string, string>, byId: ReadonlyMap<string, Scope>): ExceptionPin[] {
  return rows
    .filter((e) => standsOver(e.scope, key, byId) && lines.some((l) => l.record === e.line))
    .map((e) => ({ exception: e.number, id: e.id, line: refs.get(e.line) ?? e.line, line_record: e.line, scope: scopeName(e.scope), records: e.records.map((r) => refs.get(r) ?? r).sort(), things: [...e.things].sort(), ends: e.ends!, granted_by: e.granted_by ?? '', safeguard: e.safeguard }));
}

/** Citations of the records exceptions name, by id. */
export async function exceptionRefs(db: Db, orgId: string, rows: readonly ExceptionRow[]): Promise<Map<string, string>> {
  return new Map((await placedByIds(db, orgId, [...new Set(rows.flatMap((e) => [e.line, ...e.records]))])).map((r) => [r.id, refOf(r)]));
}

/** Whether an exception in force lets `record` depart from `line` at `key`. */
export function excepted(rows: readonly ExceptionRow[], line: string, record: string | undefined, key: ScopeKey, byId: ReadonlyMap<string, Scope>, today = dayOf()): ExceptionRow | undefined {
  return rows.find((e) => e.line === line && inForce(e, today) && standsOver(e.scope, key, byId) && (!e.records.length || (record !== undefined && e.records.includes(record))));
}

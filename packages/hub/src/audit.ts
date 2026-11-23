/**
 * The audit log: every write and every guest-link open records who did
 * what, from which surface, to which target.
 */
import type { Db } from './db/db.ts';
import { randomId } from './crypto.ts';
import type { Logger } from './log.ts';

export type Surface = 'browser' | 'api' | 'mcp' | 'cli' | 'worker' | 'guest' | 'system';

export interface AuditEntry {
  readonly orgId: string;
  readonly who: string;
  readonly what: string;
  readonly surface: Surface;
  readonly target: string;
  readonly details?: Record<string, unknown>;
}

export async function audit(db: Db, log: Logger, entry: AuditEntry): Promise<void> {
  await db.query('insert into audit (id, org_id, who, what, surface, target, details) values ($1, $2, $3, $4, $5, $6, $7)', [
    randomId(),
    entry.orgId,
    entry.who,
    entry.what,
    entry.surface,
    entry.target,
    JSON.stringify(entry.details ?? {}),
  ]);
  log.info('audit', { who: entry.who, what: entry.what, surface: entry.surface, target: entry.target });
}

export interface AuditRow {
  readonly id: string;
  readonly who: string;
  readonly what: string;
  readonly surface: string;
  readonly target: string;
  readonly details: Record<string, unknown>;
  readonly at: Date;
}

export async function listAudit(db: Db, orgId: string, opts: { target?: string; limit?: number; before?: Date } = {}): Promise<AuditRow[]> {
  const params: unknown[] = [orgId];
  let where = 'org_id = $1';
  if (opts.target) {
    params.push(`${opts.target}%`);
    where += ` and target like $${params.length}`;
  }
  if (opts.before) {
    params.push(opts.before);
    where += ` and at < $${params.length}`;
  }
  params.push(Math.min(opts.limit ?? 100, 500));
  return db.query<AuditRow>(`select id, who, what, surface, target, details, at from audit where ${where} order by at desc limit $${params.length}`, params);
}

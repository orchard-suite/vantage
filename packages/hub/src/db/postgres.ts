/** The runtime Db over the `postgres` driver. */
import postgres, { type Sql, type TransactionSql } from 'postgres';
import type { Db, Row } from './db.ts';
import type { Logger } from '../log.ts';

/** A password asked for again each time a connection opens, for a credential that expires. */
export type PasswordSource = () => Promise<string>;

export function connectPostgres(url: string, log: Logger, opts: { max: number; password?: PasswordSource | undefined } = { max: 10 }): Db {
  const sql = postgres(url, {
    max: opts.max,
    ...(opts.password ? { password: opts.password } : {}),
    // A failover leaves the old address dead for some seconds; give up on a connection fast and retry.
    connect_timeout: 5,
    onnotice: (n) => log.debug('db.notice', { message: n.message }),
    // The hub passes json columns as already-encoded text; the driver's default would encode the string a second time.
    types: { json: { to: 114, from: [114, 3802], serialize: (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v)), parse: (v: string) => JSON.parse(v) as unknown } },
  });
  log.info('db.connect', { driver: 'postgres', host: safeHost(url), pool: opts.max, auth: opts.password ? 'token' : 'password' });
  return wrap(sql, sql, log);
}

/** Inside a transaction: whether its connection has died. */
interface TxState {
  dead: boolean;
}

function wrap(root: Sql, sql: Sql | TransactionSql, log: Logger, tx?: TxState): Db {
  const db: Db = {
    query: async <T extends object>(text: string, params: readonly unknown[] = []) => {
      // The driver crashes the process when asked to write on a connection it has closed.
      if (tx?.dead) throw Object.assign(new Error('write CONNECTION_CLOSED (transaction connection lost)'), { code: 'CONNECTION_CLOSED' });
      // Outside a transaction a query is sent again when it never reached the server, or when it
      // only reads; a database failing over refuses or drops connections for a few seconds.
      const read = READ.test(text);
      for (let attempt = 1; ; attempt++) {
        try {
          const rows = await sql.unsafe(text, params as never[]);
          return rows as unknown as T[];
        } catch (err) {
          if (tx && dropped(err)) tx.dead = true;
          if (sql !== root || attempt >= RETRIES || !(neverSent(err) || (read && dropped(err)))) throw err;
          log.warn('db.retry', { attempt, code: (err as { code?: string }).code ?? null, error: (err as Error).message });
          await pause(attempt);
        }
      }
    },
    exec: async (text) => {
      await sql.unsafe(text);
    },
    transaction: async (fn) => {
      // A transaction whose connection died before its commit went out was rolled back by the
      // server, so it runs again whole; one that died during its commit may have landed and does not.
      for (let attempt = 1; ; attempt++) {
        let committing = false;
        try {
          const state: TxState = { dead: false };
          const out = await (sql as Sql).begin(async (t) => {
            let result: Awaited<ReturnType<typeof fn>>;
            try {
              result = await fn(wrap(root, t, log, state));
            } catch (err) {
              // On a lost connection the driver would write a rollback on the dead socket and crash
              // the process. The server has rolled back already, and the driver's own close handler
              // rejects this transaction, so this callback is left unsettled instead.
              if (state.dead) return new Promise<never>(() => undefined);
              throw err;
            }
            committing = true;
            return result;
          });
          return out as Awaited<ReturnType<typeof fn>>;
        } catch (err) {
          if (sql !== root || committing || attempt >= RETRIES || !(neverSent(err) || dropped(err))) throw err;
          log.warn('db.retry', { attempt, transaction: true, code: (err as { code?: string }).code ?? null, error: (err as Error).message });
          await pause(attempt);
        }
      }
    },
    listen: async (channel, handler) => {
      // The driver keeps a failed subscription and fails every later one on that channel, so a
      // start during a failover first waits, through a retried read, for the database to answer.
      await db.query('select 1');
      const req = await root.listen(channel, (payload) => handler(payload));
      log.debug('db.listen', { channel });
      return async () => {
        await req.unlisten();
        log.debug('db.unlisten', { channel });
      };
    },
    notify: async (channel, payload) => {
      // Inside a transaction the notice goes out with the commit: a listener told sooner looks for rows it cannot see yet.
      if (sql === root) await root.notify(channel, payload);
      else await sql.unsafe('select pg_notify($1, $2)', [channel, payload]);
    },
    close: async () => {
      await root.end({ timeout: 5 });
      log.info('db.close', { driver: 'postgres' });
    },
  };
  return db;
}

const RETRIES = 5;
const READ = /^\s*select\b(?![\s\S]*\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b)/i;

function pause(attempt: number): Promise<void> {
  return new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
}

/** No connection could be made, or the server refused it while starting: the query never left the client. */
export function neverSent(err: unknown): boolean {
  const { code } = err as { code?: string };
  return code === 'CONNECT_TIMEOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === '57P03';
}

/**
 * The connection died under a query, or the server shut the session down:
 * the query may have run, so only a read or an uncommitted transaction is
 * safe to send again.
 */
export function dropped(err: unknown): boolean {
  const { code } = err as { code?: string };
  return code === 'CONNECTION_CLOSED' || code === 'CONNECTION_ENDED' || code === 'CONNECTION_DESTROYED' || code === '57P01';
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unparseable';
  }
}

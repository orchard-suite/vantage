/** The test Db over PGlite: in-memory Postgres with LISTEN and NOTIFY. */
import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { Db, Row } from './db.ts';

export function connectPglite(pg: PGlite = new PGlite()): Db {
  return wrap(pg, pg);
}

function wrap(root: PGlite, exec: PGlite | Transaction): Db {
  return {
    query: async <T extends object>(text: string, params: readonly unknown[] = []) => {
      const res = await exec.query<T>(text, [...params]);
      return res.rows;
    },
    exec: async (text) => {
      await exec.exec(text);
    },
    transaction: async (fn) => {
      if (exec !== root) return fn(wrap(root, exec));
      return root.transaction(async (tx) => fn(wrap(root, tx)));
    },
    listen: async (channel, handler) => {
      const un = await root.listen(channel, (payload) => handler(payload));
      return async () => {
        await un();
      };
    },
    notify: async (channel, payload) => {
      await exec.query('select pg_notify($1, $2)', [channel, payload]);
    },
    close: async () => {
      await root.close();
    },
  };
}

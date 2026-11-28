/**
 * A commit names its item (VAN-3026). The git connector reads each
 * commit's `Work:` trailers; when its batch lands, every commit that names
 * an item is linked to it as proof, once, by a `linked` event the hub
 * makes. A key no item has is answered as a warning for the connector's
 * run, never guessed. The items linked, and what names them as proof or
 * holds them as parts, are worked out again in the same transaction.
 */
import type { Changes } from '@vantage/connectors';
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { membersOf, namedBy } from './gate.ts';
import type { KindRow } from './kinds.ts';
import { append, lockFeed, stateById, type Actor } from './store.ts';
import { commitPrefix, commitTarget, type CommitProof } from './commit-target.ts';
import { dependents, rework } from './worked.ts';

export interface CommitLinks {
  /** One line per link made: the item and the commit. */
  readonly linked: string[];
  /** One line per key no item has, for the run's warnings. */
  readonly unknown: string[];
  /** The worked items the new proof moved. */
  readonly moved: string[];
}

const HUB: Actor = { userId: null, kind: 'system', agentId: null, surface: 'system' };

export async function linkCommits(db: Db, orgId: string, changes: readonly Changes[], observed: string): Promise<CommitLinks> {
  const wanted = new Map<string, CommitProof[]>();
  for (const c of changes) {
    for (const commit of c.commits) {
      for (const key of commit.work ?? []) {
        const list = wanted.get(key) ?? [];
        if (!list.some((x) => x.repository === c.repository && x.sha === commit.sha)) list.push({ repository: c.repository, sha: commit.sha, at: commit.at ?? observed });
        wanted.set(key, list);
      }
    }
  }
  if (!wanted.size) return { linked: [], unknown: [], moved: [] };
  const found = new Map((await db.query<{ id: string; key: string }>('select id, key from items where org_id = $1 and key = any($2::text[])', [orgId, [...wanted.keys()]])).map((r) => [r.key, r.id]));
  const unknown = [...wanted].filter(([key]) => !found.has(key)).flatMap(([key, list]) => list.map((c) => `commit ${c.repository}@${c.sha.slice(0, 8)} names ${key}, which no item has`));
  return db.transaction(async (tx) => {
    await lockFeed(tx, orgId);
    const linked: string[] = [];
    const touched: string[] = [];
    for (const [key, id] of found) {
      let s = await stateById(tx, id, true);
      if (!s) continue;
      const kind = await maybe<KindRow>(tx, 'select * from item_kinds where id = $1', [s.kindId]);
      if (!kind) continue;
      const members = await membersOf(tx, orgId, kind.definition);
      for (const c of wanted.get(key)!) {
        // A commit the connector reads again is linked already: its target starts the same whatever time it carries.
        const prefix = commitPrefix(c.repository, c.sha);
        if (s.links.some((l) => l.rel === 'proof' && l.target.startsWith(prefix))) continue;
        const line = `${s.key} has commit ${c.repository}@${c.sha.slice(0, 8)} as proof`;
        s = await append(tx, { orgId, itemId: s.id, before: s, data: { type: 'linked', rel: 'proof', target: commitTarget(c) }, actor: HUB, key: undefined, answer: line, named: (x) => namedBy(kind.definition, x, members) });
        linked.push(line);
        if (!touched.includes(id)) touched.push(id);
      }
    }
    const moved = touched.length ? await rework(tx, orgId, [...touched, ...(await dependents(tx, touched))]) : [];
    return { linked, unknown, moved };
  });
}

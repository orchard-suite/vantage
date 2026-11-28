/**
 * The hub files the checking; agents do it (VAN-3019). Items go into the
 * kind the standard's settings name under `checks`, filed by the hub as
 * itself inside the write that caused them, each linked to the records it
 * is about. An item still open for the same subject is not filed again.
 * With no kind named, nothing is filed.
 */
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { randomId } from '../crypto.ts';
import { kindByPrefix, startState } from '../tracking/kinds.ts';
import { append, lockFeed, type Actor } from '../tracking/store.ts';
import { membersOf, namedBy } from '../tracking/gate.ts';

/** One thing the hub asks an agent or a steward to look at. */
export interface Filing {
  /** What the item is about, the same for every item on one subject: an open one blocks another. */
  readonly subject: string;
  /** Tells this item apart from earlier ones on the same subject: the edition or the conflict that caused it. */
  readonly cause: string;
  readonly title: string;
  readonly body: string;
  /** The records it is about, by id. */
  readonly records: readonly string[];
  /** The stewards who hold it, as the tree names them; each holds it only when they are a member. */
  readonly stewards?: readonly string[];
}

const HUB: Actor = { userId: null, kind: 'system', agentId: null, surface: 'api' };

/** Files each filing that has no open item on its subject; answers the keys it filed. */
export async function fileChecks(tx: Db, orgId: string, prefix: string | undefined, filings: readonly Filing[]): Promise<string[]> {
  if (!prefix || !filings.length) return [];
  const kind = await kindByPrefix(tx, orgId, prefix);
  if (!kind) return [];
  await lockFeed(tx, orgId);
  const def = kind.definition;
  const members = await membersOf(tx, orgId, def);
  const out: string[] = [];
  for (const f of filings) {
    const open = await maybe<{ key: string }>(tx, "select key from items where kind_id = $1 and ref like $2 and class not in ('done', 'parked') limit 1", [kind.id, `${f.subject}@%`]);
    if (open) continue;
    const n = await tx.query<{ number: number }>('update item_kinds set next_number = next_number + 1 where id = $1 returning next_number - 1 as number', [kind.id]);
    const number = Number(n[0]!.number);
    const key = `${kind.prefix}-${number}`;
    const id = randomId();
    const bodyId = randomId();
    await tx.query('insert into item_bodies (id, item_id, text) values ($1, $2, $3)', [bodyId, id, f.body]);
    const start = startState(def);
    const holders = [...new Set((await Promise.all((f.stewards ?? []).map((x) => memberOf(tx, orgId, x)))).filter((x): x is string => x !== undefined))];
    const events = [
      { type: 'created' as const, key, number, kindId: kind.id, workspaceId: kind.workspace_id, ref: `${f.subject}@${f.cause}`, title: f.title.slice(0, 200), state: start.id, class: start.class, askerId: null, labels: {}, revision: null, bodyId },
      ...f.records.map((r) => ({ type: 'linked' as const, rel: 'decision' as const, target: r })),
      ...holders.map((userId) => ({ type: 'held' as const, userId })),
    ];
    let before = undefined as Awaited<ReturnType<typeof append>> | undefined;
    for (const data of events) before = await append(tx, { orgId, itemId: id, before, data, actor: HUB, key: undefined, answer: `filed ${key}`, named: (s) => namedBy(def, s, members) });
    out.push(key);
  }
  return out;
}

/** The member a steward names, by email or person:<email>. */
async function memberOf(db: Db, orgId: string, steward: string): Promise<string | undefined> {
  const email = steward.includes(':') ? steward.slice(steward.indexOf(':') + 1) : steward;
  return (await maybe<{ id: string }>(db, 'select id from users where org_id = $1 and lower(email) = lower($2) and disabled_at is null', [orgId, email]))?.id;
}

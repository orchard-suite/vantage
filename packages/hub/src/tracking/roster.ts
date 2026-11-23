/**
 * Who a kind's roles name, read again (VAN-2008). An item's names are
 * written with each of its events, from the roster as it resolved then. A
 * roster that comes to resolve differently (a kind saved with other roles, a
 * person or a team the roster names arriving later) names its items again
 * here, so a role's person is offered the item without waiting for an event.
 */
import type { Db } from '../db/db.ts';
import { membersOf, namedBy } from './gate.ts';
import { stateById, writeNamed } from './store.ts';
import type { KindDef } from './kinds.ts';

/** Who arrived: a person by address, or a team by slug. */
export type Arrival = { readonly email: string } | { readonly team: string };

/** Names again every item of these kinds, from their rosters as they resolve now. */
export async function renameKinds(tx: Db, orgId: string, kindIds: readonly string[]): Promise<void> {
  if (!kindIds.length) return;
  const kinds = await tx.query<{ id: string; definition: KindDef }>('select id, definition from item_kinds where org_id = $1 and id = any($2::text[])', [orgId, [...kindIds]]);
  for (const k of kinds) {
    const members = await membersOf(tx, orgId, k.definition);
    for (const { id } of await tx.query<{ id: string }>('select id from items where kind_id = $1', [k.id])) {
      const s = await stateById(tx, id);
      if (s) await writeNamed(tx, id, namedBy(k.definition, s, members));
    }
  }
}

/** Names again the items of the kinds whose roles name who arrived. */
export async function renameFor(tx: Db, orgId: string, who: Arrival): Promise<void> {
  const want = 'email' in who ? who.email.toLowerCase() : `team:${who.team}`;
  const kinds = await tx.query<{ id: string; definition: KindDef }>('select id, definition from item_kinds where org_id = $1', [orgId]);
  await renameKinds(tx, orgId, kinds.filter((k) => Object.values(k.definition.roles).flat().some((w) => w.toLowerCase() === want)).map((k) => k.id));
}

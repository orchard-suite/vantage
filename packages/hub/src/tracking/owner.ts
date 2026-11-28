/**
 * Who answers for an item, who it was handed to, and the scope it serves
 * (VAN-3024). An owner is a person or a team, named as `me`, an email, or
 * `team:<slug>`. A delegation hands the item to the owner's agents or to
 * one named agent. A scope is one of the tree's (VAN-3017); a new item
 * serves its workspace's, and with no owner takes that scope's steward.
 */
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import type { Principal } from '../auth/principal.ts';
import { agentLabels, agentLabel } from '../auth/agents.ts';
import { HttpError, badRequest, forbidden } from '../http.ts';
import type { Delegation, ItemState, Owner } from './state.ts';

/** The owner a caller names: `me`, a person by email, or `team:<slug>`. */
export async function ownerOf(db: Db, p: Principal, who: string): Promise<Owner> {
  const w = who.trim();
  if (w === 'me') return { kind: 'user', id: p.userId };
  const found = await namedOwner(db, p.orgId, w);
  if (!found) throw new HttpError(404, w.startsWith('team:') ? `no team ${w.slice(5)} in this organization` : `no person ${w} in this organization; name an owner as me, an email, or team:<slug>`);
  return found;
}

/** A person by email (or `person:<email>`) or a team by `team:<slug>`; undefined when the organization has neither. */
async function namedOwner(db: Db, orgId: string, name: string): Promise<Owner | undefined> {
  if (name.startsWith('team:')) {
    const t = await maybe<{ id: string }>(db, 'select id from teams where org_id = $1 and slug = $2', [orgId, name.slice(5)]);
    return t ? { kind: 'team', id: t.id } : undefined;
  }
  const email = name.replace(/^person:/, '');
  if (!email.includes('@')) return undefined;
  const u = await maybe<{ id: string }>(db, 'select id from users where org_id = $1 and lower(email) = lower($2) and disabled_at is null', [orgId, email]);
  return u ? { kind: 'user', id: u.id } : undefined;
}

/** A scope the tree has, or a refusal that names where the tree is read. */
export async function checkScope(db: Db, orgId: string, scope: string): Promise<string> {
  const row = await maybe<{ id: string }>(db, 'select id from scopes where org_id = $1 and id = $2', [orgId, scope]);
  if (!row) throw badRequest(`no scope ${scope} in the scope tree; vantage_outline scopes lists them`);
  return row.id;
}

/** Where a new item sits and who answers for it when the caller names neither: its workspace's scope, and that scope's steward. */
export async function defaultsFor(db: Db, orgId: string, workspaceId: string, scope: string | null): Promise<{ scope: string | null; steward: Owner | null }> {
  const at = scope ?? (await maybe<{ scope: string | null }>(db, 'select scope from workspaces where id = $1', [workspaceId]))?.scope ?? null;
  if (!at) return { scope: null, steward: null };
  const steward = (await maybe<{ steward: string | null }>(db, 'select steward from scopes where org_id = $1 and id = $2', [orgId, at]))?.steward;
  return { scope: at, steward: steward ? ((await namedOwner(db, orgId, steward)) ?? null) : null };
}

/** Whether the caller is the item's owner: the person, or a member of the team. */
export function isOwner(owner: Owner | null, caller: { readonly userId: string; readonly teamIds: readonly string[] }): boolean {
  if (!owner) return false;
  return owner.kind === 'user' ? owner.id === caller.userId : caller.teamIds.includes(owner.id);
}

/**
 * What `delegate` names: true hands the item to any agent acting for its
 * owner; an agent's id, or the name of one of the caller's own agents,
 * hands it to that agent alone; false takes it back. Only the owner
 * delegates.
 */
export async function delegationOf(db: Db, p: Principal, item: Pick<ItemState, 'key'> & { readonly owner: Owner | null }, to: boolean | string): Promise<Delegation | null> {
  if (!item.owner) throw badRequest(`${item.key} has no owner; assign it (owner: me) before it is delegated`);
  if (!isOwner(item.owner, p)) throw forbidden(`only ${item.key}'s owner delegates it`);
  if (to === false) return null;
  if (to === true) return { agentId: null, userId: null, by: p.userId };
  const byId = await maybe<{ id: string; user_id: string }>(db, 'select id, user_id from agents where org_id = $1 and id = $2 and revoked_at is null', [p.orgId, to]);
  if (byId) return { agentId: byId.id, userId: byId.user_id, by: p.userId };
  const mine = await db.query<{ id: string; user_id: string; name: string; host: string | null }>('select id, user_id, name, host from agents where user_id = $1 and revoked_at is null order by created_at desc', [p.userId]);
  const named = mine.filter((a) => a.name === to || agentLabel(a) === to);
  if (named.length === 1) return { agentId: named[0]!.id, userId: named[0]!.user_id, by: p.userId };
  throw badRequest(`${named.length ? 'more than one' : 'no'} agent ${to}; name it by its id (${mine.map((a) => `${a.id} ${agentLabel(a)}`).join(', ') || 'you have no agents'}), or delegate: true for any agent acting for the owner`);
}

/** Each owner's label: a person's email, or `team:<slug>`. */
export async function ownerLabels(db: Db, owners: readonly (Owner | null)[]): Promise<Map<string, string>> {
  const users = [...new Set(owners.filter((o): o is Owner => o?.kind === 'user').map((o) => o.id))];
  const teams = [...new Set(owners.filter((o): o is Owner => o?.kind === 'team').map((o) => o.id))];
  const out = new Map<string, string>();
  if (users.length) for (const r of await db.query<{ id: string; label: string }>('select id, coalesce(email, display_name, subject) as label from users where id = any($1::text[])', [users])) out.set(`user:${r.id}`, r.label);
  if (teams.length) for (const r of await db.query<{ id: string; slug: string }>('select id, slug from teams where id = any($1::text[])', [teams])) out.set(`team:${r.id}`, `team:${r.slug}`);
  return out;
}

export const ownerKey = (o: Owner): string => `${o.kind}:${o.id}`;

/** A delegation in one line: to whom, and by whom. */
export async function delegationText(db: Db, item: Pick<ItemState, 'owner' | 'delegate'>): Promise<string | undefined> {
  const d = item.delegate;
  if (!d) return undefined;
  const people = await ownerLabels(db, [item.owner, { kind: 'user', id: d.by }, ...(d.userId ? [{ kind: 'user' as const, id: d.userId }] : [])]);
  const by = people.get(`user:${d.by}`) ?? 'a person';
  if (!d.agentId) return `to agents of ${item.owner ? (people.get(ownerKey(item.owner)) ?? 'its owner') : 'its owner'}, by ${by}`;
  const agent = (await agentLabels(db, [d.agentId])).get(d.agentId) ?? 'an agent';
  return `to ${agent} for ${d.userId ? (people.get(`user:${d.userId}`) ?? 'a person') : 'a person'}, by ${by}`;
}

/**
 * The condition a list of items (aliased `i`) adds to hold the items in a
 * scope and every scope under it; an item that names none serves its
 * workspace's. `n` is the parameter that holds the scope's id, `org` the
 * one that holds the organization.
 */
export function scopeSql(org: number, n: number): string {
  return `coalesce(i.scope, (select w.scope from workspaces w where w.id = i.workspace_id)) in (with recursive under(id) as (select id from scopes where org_id = $${org} and id = $${n} union select s.id from scopes s join under u on s.parent = u.id where s.org_id = $${org}) select id from under)`;
}

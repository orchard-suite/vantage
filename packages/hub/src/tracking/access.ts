/**
 * Who sees an item (docs/decisions/2004): the people its workspace lets
 * in, and the people it names. Every read path goes through here: one item
 * by its key, and the condition a list puts in its own query, so a page of
 * twenty rows is twenty the caller may see.
 */
import type { AppContext } from '../context.ts';
import type { Principal, Role } from '../auth/principal.ts';
import { accessibleWorkspaces } from '../authz.ts';
import { maybe } from '../db/db.ts';
import { HttpError, forbidden } from '../http.ts';
import { kindById, kindByPrefix, type KindRow } from './kinds.ts';
import { stateById } from './store.ts';
import { appOf } from './apps.ts';
import type { ItemState } from './state.ts';
import type { Caller } from './gate.ts';

/** `VAN-12`, the hub's key. */
export const ITEM_KEY = /^([A-Z][A-Z0-9]{1,11})-(\d{1,9})$/;
/** `VAN:forms/1842`, a kind's prefix and the owner's own key. */
export const OWNER_KEY = /^([A-Z][A-Z0-9]{1,11}):(.{1,200})$/;

export interface Reach {
  /** The workspaces the caller may open, with the role they hold there. */
  readonly roles: ReadonlyMap<string, Role>;
  readonly userId: string;
  readonly teamIds: readonly string[];
  /** For a module's app: the kinds it works, which it reads whole, and nothing else. */
  readonly appKinds?: readonly string[];
}

export async function reachOf(ctx: AppContext, p: Principal): Promise<Reach> {
  if (p.module) {
    const app = await appOf(ctx.db, p.orgId, p.module.clientId);
    const kinds = app ? (await ctx.db.query<{ id: string }>('select id from item_kinds where org_id = $1 and prefix = any($2::text[])', [p.orgId, [...app.kinds]])).map((r) => r.id) : [];
    return { roles: new Map(), userId: p.userId, teamIds: [], appKinds: kinds };
  }
  const ws = await accessibleWorkspaces(ctx.db, p);
  return { roles: new Map(ws.map((w) => [w.id, w.role])), userId: p.userId, teamIds: p.teamIds };
}

/**
 * The condition a list of items (aliased `i`) adds to its query so it holds
 * only items the caller may see. `next` is the number of the first
 * parameter it uses; it answers the SQL and the parameters to append.
 */
export function visibleWhere(r: Reach, next: number): { sql: string; params: unknown[] } {
  if (r.appKinds) return { sql: `i.kind_id = any($${next}::text[])`, params: [[...r.appKinds]] };
  return {
    sql: `(i.workspace_id = any($${next}::text[]) or exists (select 1 from item_named n where n.item_id = i.id and ((n.subject_kind = 'user' and n.subject_id = $${next + 1}) or (n.subject_kind = 'team' and n.subject_id = any($${next + 2}::text[])))))`,
    params: [[...r.roles.keys()], r.userId, [...r.teamIds]],
  };
}

export interface Found {
  readonly item: ItemState;
  readonly kind: KindRow;
  readonly caller: Caller;
  /** The caller is the module app that works this item's kind. */
  readonly app?: true;
}

const missing = (ref: string): HttpError => new HttpError(404, `no item ${ref} that you may see; vantage_outline a kind's prefix lists its items`);

/** The item a key names, as the caller may see it. An item they may not see is answered exactly as one that does not exist. */
export async function findItem(ctx: AppContext, p: Principal, ref: string, r?: Reach): Promise<Found> {
  const reach = r ?? (await reachOf(ctx, p));
  const id = await itemIdOf(ctx, p.orgId, ref.trim());
  if (!id) throw missing(ref);
  const item = await stateById(ctx.db, id);
  if (!item || item.orgId !== p.orgId) throw missing(ref);
  const role = reach.roles.get(item.workspaceId);
  const app = reach.appKinds?.includes(item.kindId) === true;
  if (reach.appKinds && !app) throw missing(ref);
  if (!app && !role && !(await isNamed(ctx, item.id, reach))) throw missing(ref);
  const kind = await kindById(ctx.db, item.kindId);
  if (!kind) throw missing(ref);
  return { item, kind, caller: { userId: p.userId, teamIds: p.teamIds, role }, ...(app ? { app: true as const } : {}) };
}

/** Throws 403 unless the caller writes the item's workspace: being named grants moves, and no other write. */
export function requireAuthor(f: Found): void {
  if (f.app) return;
  if (f.caller.role !== 'author') throw forbidden(`${f.item.key} names you, which lets you make the moves its lifecycle gives you and nothing else; other changes are for people who write its workspace`);
}

async function isNamed(ctx: AppContext, itemId: string, r: Reach): Promise<boolean> {
  return !!(await maybe(ctx.db, "select 1 as x from item_named where item_id = $1 and ((subject_kind = 'user' and subject_id = $2) or (subject_kind = 'team' and subject_id = any($3::text[]))) limit 1", [itemId, r.userId, [...r.teamIds]]));
}

/** The id behind a hub key or an owner's key, whoever may see it. */
export async function itemIdOf(ctx: AppContext, orgId: string, ref: string): Promise<string | undefined> {
  if (ITEM_KEY.test(ref)) return (await maybe<{ id: string }>(ctx.db, 'select id from items where org_id = $1 and key = $2', [orgId, ref]))?.id;
  const m = OWNER_KEY.exec(ref);
  if (!m) throw new HttpError(400, `${ref} is not an item; name one by its key (VAN-12) or its kind and your own key (VAN:forms/1842)`);
  const kind = await kindByPrefix(ctx.db, orgId, m[1]!);
  if (!kind) return undefined;
  return (await maybe<{ id: string }>(ctx.db, 'select id from items where kind_id = $1 and ref = $2', [kind.id, m[2]!]))?.id;
}

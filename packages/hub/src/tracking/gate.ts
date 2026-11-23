/**
 * The one gate every move passes (VAN-3008). It answers which
 * moves a caller may make from where an item stands, and refuses any other
 * with that same list, so a refusal and the way forward cannot disagree.
 * A lifecycle that does not draw a move makes it impossible.
 */
import { BUILT_IN_ROLES, type LifecycleMove } from '@vantage/model';
import type { Db } from '../db/db.ts';
import type { Role } from '../auth/principal.ts';
import { stateOf, type KindDef } from './kinds.ts';
import type { ItemState } from './state.ts';
import type { Named } from './store.ts';

/** What the gate knows of the caller. */
export interface Caller {
  readonly userId: string;
  readonly teamIds: readonly string[];
  /** Their role in the item's workspace; undefined when they see it only because it names them. */
  readonly role: Role | undefined;
}

/** The people and teams each role the kind declares resolves to. */
export type Members = ReadonlyMap<string, { readonly users: ReadonlySet<string>; readonly teams: ReadonlySet<string> }>;

export interface MoveOption {
  readonly to: string;
  readonly toText: string;
  readonly label: string;
  readonly needs: readonly string[];
  readonly approval: boolean;
}

export interface Given {
  readonly note?: string | undefined;
  readonly revision?: string | undefined;
}

/** Resolves the roles a kind declares to the people (by email) and teams (by slug) the organization has. */
export async function membersOf(db: Db, orgId: string, def: KindDef): Promise<Members> {
  const out = new Map<string, { users: Set<string>; teams: Set<string> }>();
  const emails = [...new Set(Object.values(def.roles).flat().filter((w) => !w.startsWith('team:')).map((w) => w.toLowerCase()))];
  const slugs = [...new Set(Object.values(def.roles).flat().filter((w) => w.startsWith('team:')).map((w) => w.slice(5)))];
  const users = emails.length ? await db.query<{ id: string; email: string }>('select id, lower(email) as email from users where org_id = $1 and lower(email) = any($2::text[]) and disabled_at is null', [orgId, emails]) : [];
  const teams = slugs.length ? await db.query<{ id: string; slug: string }>('select id, slug from teams where org_id = $1 and slug = any($2::text[])', [orgId, slugs]) : [];
  for (const [role, who] of Object.entries(def.roles)) {
    const m = { users: new Set<string>(), teams: new Set<string>() };
    for (const w of who) {
      if (w.startsWith('team:')) teams.filter((t) => t.slug === w.slice(5)).forEach((t) => m.teams.add(t.id));
      else users.filter((u) => u.email === w.toLowerCase()).forEach((u) => m.users.add(u.id));
    }
    out.set(role, m);
  }
  return out;
}

function holds(who: string, item: ItemState, caller: Caller, members: Members): boolean {
  switch (who) {
    case 'author':
      return caller.role === 'author';
    case 'holder':
      return item.holders.includes(caller.userId);
    case 'asker':
      return item.askerId === caller.userId;
  }
  const m = members.get(who);
  return !!m && (m.users.has(caller.userId) || caller.teamIds.some((t) => m.teams.has(t)));
}

/** Whether the caller may make this move on this item, need aside. */
export function mayMake(move: LifecycleMove, item: ItemState, caller: Caller, members: Members): boolean {
  if (move.approval && item.askerId === caller.userId) return false;
  return (move.who ?? ['author']).some((w) => holds(w, item, caller, members));
}

const option = (def: KindDef, m: LifecycleMove): MoveOption => ({ to: m.to, toText: stateOf(def, m.to)?.text ?? m.to, label: m.label ?? `to ${m.to}`, needs: [...(m.needs ?? [])], approval: !!m.approval });

/** The moves open to this caller from where the item stands. */
export function openMoves(def: KindDef, item: ItemState, caller: Caller, members: Members): MoveOption[] {
  return def.moves.filter((m) => m.from === item.state && mayMake(m, item, caller, members)).map((m) => option(def, m));
}

/** How a move reads in one line: `finish → done`, with what it needs. */
export function moveText(o: MoveOption): string {
  return `${o.label} → ${o.to}${o.needs.length ? ` (needs ${o.needs.join(', ')})` : ''}`;
}

export type GateAnswer = { readonly ok: true; readonly move: LifecycleMove } | { readonly ok: false; readonly why: string; readonly open: readonly MoveOption[] };

/** Lets a move through, or refuses it naming the moves this caller may make instead. */
export function checkMove(def: KindDef, item: ItemState, to: string, caller: Caller, members: Members, given: Given): GateAnswer {
  const open = openMoves(def, item, caller, members);
  const refuse = (why: string): GateAnswer => ({ ok: false, why: `${why}. ${open.length ? `Open to you from ${item.state}: ${open.map(moveText).join('; ')}` : `No move from ${item.state} is open to you`}`, open });
  const target = stateOf(def, to);
  if (!target) return refuse(`${def.prefix} has no state ${to}`);
  const move = def.moves.find((m) => m.from === item.state && m.to === to);
  if (!move) return refuse(`the lifecycle draws no move from ${item.state} to ${to}`);
  if (move.approval && item.askerId === caller.userId) return refuse(`${move.label ?? 'this move'} is an approval, and the person who asked for ${item.key} never approves it`);
  if (!mayMake(move, item, caller, members)) return refuse(`${move.label ?? `the move to ${to}`} is for ${(move.who ?? ['author']).join(' or ')}`);
  for (const n of move.needs ?? []) {
    if (n === 'note' && !given.note?.trim()) return refuse(`${move.label ?? `the move to ${to}`} needs a note`);
    if (n === 'revision' && !given.revision?.trim()) return refuse(`${move.label ?? `the move to ${to}`} needs the content revision it is about`);
    if (n.startsWith('label:') && item.labels[n.slice(6)] === undefined) return refuse(`${move.label ?? `the move to ${to}`} needs label ${n.slice(6)} set first`);
  }
  return { ok: true, move };
}

/** Who an item names: its asker, its holders, and the people and teams a role on a move out of its state resolves to. */
export function namedBy(def: KindDef, item: ItemState, members: Members): Named[] {
  const out: Named[] = [];
  if (item.askerId) out.push({ kind: 'user', id: item.askerId, why: 'asker' });
  for (const h of item.holders) out.push({ kind: 'user', id: h, why: 'holder' });
  for (const m of def.moves.filter((x) => x.from === item.state)) {
    for (const role of (m.who ?? []).filter((w) => !BUILT_IN_ROLES.includes(w))) {
      const r = members.get(role);
      r?.users.forEach((id) => out.push({ kind: 'user', id, why: `role:${role}` }));
      r?.teams.forEach((id) => out.push({ kind: 'team', id, why: `role:${role}` }));
    }
  }
  return out;
}

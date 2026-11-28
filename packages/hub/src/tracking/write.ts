/**
 * The verbs that change an item (VAN-5001): put, move, hold,
 * release, note, attach, link; an agent's forms of them are in work.ts.
 * Each commits alone, in one transaction that
 * holds the feed lock, appends one event, and answers one line. A write sent
 * twice with the same key answers the first line again and changes nothing.
 */
import type { AppContext } from '../context.ts';
import { isAgent, runOf, type Principal } from '../auth/principal.ts';
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { randomId } from '../crypto.ts';
import { HttpError, badRequest, forbidden } from '../http.ts';
import { accessibleWorkspaces } from '../authz.ts';
import { classOf, kindByPrefix, startState, type KindDef, type KindRow } from './kinds.ts';
import { checkMove, membersOf, namedBy, type Members } from './gate.ts';
import { answered, append, lockFeed, stateById, type Actor } from './store.ts';
import { CLAIM_MINUTES, LABEL_TEXT_MAX, LINK_RELS, NOTE_MAX, TITLE_MAX, type Claim, type EventData, type ItemState, type LabelValue, type LinkRel } from './state.ts';
import { findItem, requireAuthor, type Found } from './access.ts';
import { linkTarget } from './links.ts';
import { requireApp, requirePerson } from './apps.ts';
import { dependents, rework } from './worked.ts';
import { placement, type Place, type Placement } from './rank.ts';
import { checkDates } from './dates.ts';
import { checkScope, defaultsFor, delegationOf, isOwner, ownerOf } from './owner.ts';

/** What a write answers: one line, and the item as it stands after. */
export interface WriteAnswer {
  readonly status: 'done' | 'unchanged' | 'repeat';
  readonly line: string;
  readonly key: string;
}

export function actorOf(p: Principal): Actor {
  if (p.module) return { userId: `app:${p.module.clientId}`, kind: 'app', agentId: null, surface: `app:${p.module.clientId}` };
  // A person who acted through a module's client is the actor, and the module is where it came from. An agent acts for its person, and both are recorded.
  return { userId: p.userId, kind: isAgent(p) ? 'agent' : 'person', agentId: p.agent?.id ?? null, surface: p.client ? `${p.surface}:${p.client}` : p.surface };
}

/** Whether this call comes from the run that holds the claim: the same person, and the same run (VAN-2009). */
export function claimedBy(c: Claim, p: Principal): boolean {
  return c.userId === p.userId && c.run === runOf(p);
}

/** Checks label values against the kind: a declared name, its type, a choice it offers, a size it keeps. `null` removes one. */
export function checkLabels(def: KindDef, labels: Readonly<Record<string, unknown>>): Record<string, LabelValue | null> {
  const out: Record<string, LabelValue | null> = {};
  for (const [name, value] of Object.entries(labels)) {
    const l = def.labels.find((x) => x.name === name);
    if (!l) throw badRequest(`${def.prefix} has no label ${name}; its labels: ${def.labels.map((x) => `${x.name} (${x.type})`).join(', ') || 'none'}`);
    if (value === null) {
      out[name] = null;
      continue;
    }
    switch (l.type) {
      case 'number':
      case 'money':
        if (typeof value !== 'number' || !Number.isFinite(value)) throw badRequest(`label ${name} is a ${l.type}; give a number`);
        out[name] = value;
        break;
      case 'date':
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw badRequest(`label ${name} is a date; give it as 2026-03-01`);
        out[name] = value;
        break;
      case 'choice':
        if (typeof value !== 'string' || !l.choices!.includes(value)) throw badRequest(`label ${name} is one of ${l.choices!.join(', ')}`);
        out[name] = value;
        break;
      case 'text':
        if (typeof value !== 'string' || value.length > LABEL_TEXT_MAX) throw badRequest(`label ${name} is text of at most ${LABEL_TEXT_MAX} characters; a nested value or a document is never a label`);
        out[name] = value;
        break;
    }
  }
  return out;
}

/** A write sent again answers what it answered the first time, before any read: the item may have moved out of the caller's sight since. */
export async function repeat(ctx: AppContext, p: Principal, key: string | undefined): Promise<WriteAnswer | undefined> {
  const prior = await answered(ctx.db, p.orgId, key, p.userId);
  return prior ? { status: 'repeat', line: prior.answer, key: prior.key } : undefined;
}

export interface Commit {
  readonly ctx: AppContext;
  readonly p: Principal;
  readonly key: string | undefined;
}

/**
 * Runs one write: the feed lock, a repeat answered as before, the item read
 * again under its row lock, and the events `act` makes appended. `act`
 * answers no events when nothing would change.
 */
export async function commit(c: Commit, itemId: string | undefined, act: (tx: Db, before: ItemState | undefined) => Promise<{ events: { id: string; data: EventData }[]; line: string; key: string; named: (s: ItemState) => ReturnType<typeof namedBy> }>): Promise<WriteAnswer> {
  return c.ctx.db.transaction(async (tx) => {
    await lockFeed(tx, c.p.orgId);
    const prior = await answered(tx, c.p.orgId, c.key, c.p.userId);
    if (prior) return { status: 'repeat' as const, line: prior.answer, key: prior.key };
    const before = itemId ? await stateById(tx, itemId, true) : undefined;
    const out = await act(tx, before);
    // Any call the claiming run makes on its item renews the claim once half of it has run, so no model spends a turn on a heartbeat.
    const claimed = before?.claim;
    if (claimed && claimedBy(claimed, c.p) && Date.parse(claimed.until) - Date.now() < (CLAIM_MINUTES * 60_000) / 2 && Date.parse(claimed.until) > Date.now() && !out.events.some((e) => e.data.type === 'claimed' || e.data.type === 'renewed' || (e.data.type === 'released' && e.data.userId === c.p.userId))) {
      out.events.push({ id: before!.id, data: { type: 'renewed', until: new Date(Date.now() + CLAIM_MINUTES * 60_000).toISOString() } });
    }
    if (!out.events.length) return { status: 'unchanged' as const, line: out.line, key: out.key };
    // A write changes its own item, and sometimes others beside it (a placement ranks the items shown before it): each folds from its own state.
    const states = new Map<string, ItemState | undefined>(before ? [[before.id, before]] : []);
    const touched = new Set<string>();
    for (const [i, e] of out.events.entries()) {
      const prior = states.has(e.id) ? states.get(e.id) : await stateById(tx, e.id, true);
      // The key rides on the first event: a repeat finds it and answers the line, and the rest of the write is already in.
      states.set(e.id, await append(tx, { orgId: c.p.orgId, itemId: e.id, before: prior, data: e.data, actor: actorOf(c.p), key: i === 0 ? c.key : undefined, answer: out.line, named: out.named }));
      touched.add(e.id);
      if ((e.data.type === 'linked' || e.data.type === 'unlinked') && (e.data.rel === 'part-of' || e.data.rel === 'toward')) touched.add(e.data.target);
    }
    // A worked item moves with its proof, in this same transaction: the item itself, its parent, and whatever names it as proof.
    const moved = await rework(tx, c.p.orgId, [...touched, ...(await dependents(tx, [...touched]))]);
    return { status: 'done' as const, line: moved.length ? `${out.line}; by its proof, ${moved.join(', ')} moved` : out.line, key: out.key };
  });
}

export interface PutInput {
  /** The kind's prefix, for a new item or one named by the owner's key. */
  readonly kind?: string | undefined;
  /** An item to change, by its key (VAN-12) or owner's key (VAN:forms/1842). */
  readonly item?: string | undefined;
  /** The owner's own key for an item another system keeps: put by it is safe to send twice. */
  readonly ref?: string | undefined;
  readonly title?: string | undefined;
  readonly labels?: Readonly<Record<string, unknown>> | undefined;
  readonly revision?: string | undefined;
  readonly body?: string | undefined;
  /** How a body changes: each old string matches the body exactly once and becomes the new one. */
  readonly edits?: readonly { readonly old: string; readonly new: string }[] | undefined;
  /** The item this one is part of, by key. */
  readonly parent?: string | undefined;
  /** Where it goes among the items of its kind in its horizon. */
  readonly place?: Place | undefined;
  /** Who answers for it (VAN-3024): me, a person by email, or team:<slug>; null leaves it with nobody. A new item with none takes its scope's steward. */
  readonly owner?: string | null | undefined;
  /** The scope it serves, from the scope tree; null serves its workspace's. A new item with none serves its workspace's. */
  readonly scope?: string | null | undefined;
  /** The owner hands it to agents: true for any agent acting for the owner, an agent by id or name for that one, false to take it back. */
  readonly delegate?: boolean | string | undefined;
}

/** A put that only delegates: the owner may send it without writing the workspace. */
const onlyDelegates = (input: PutInput): boolean => input.delegate !== undefined && Object.entries(input).every(([k, v]) => v === undefined || ['item', 'kind', 'ref', 'delegate'].includes(k));

/** Makes an item or changes the fields it names. Fields it does not name stay as they are. */
export async function put(ctx: AppContext, p: Principal, input: PutInput, key: string | undefined): Promise<WriteAnswer> {
  const again = await repeat(ctx, p, key);
  if (again) return again;
  if (input.title !== undefined && (!input.title.trim() || input.title.length > TITLE_MAX)) throw badRequest(`a title is 1 to ${TITLE_MAX} characters`);
  let found: Found | undefined;
  if (input.item) found = await findItem(ctx, p, input.item);
  else if (input.ref && input.kind) found = await findItem(ctx, p, `${input.kind.toUpperCase()}:${input.ref}`).catch((err: unknown) => (err instanceof HttpError && err.status === 404 ? undefined : Promise.reject(err)));
  if (found) return change(ctx, p, found, input, key);
  if (!input.kind) throw badRequest('a new item names its kind by prefix (kind: VAN); to change one, name it (item: VAN-12)');
  const kind = await kindByPrefix(ctx.db, p.orgId, input.kind);
  if (!kind) throw new HttpError(404, `no kind ${input.kind}; a kind is a document with a kind block (guide#kinds-and-items)`);
  if (p.module) {
    const app = await requireApp(ctx, p);
    if (!app.kinds.includes(kind.prefix)) throw forbidden(`app ${app.name} works ${app.kinds.join(', ') || 'no kinds'}, not ${kind.prefix}`);
  } else {
    const ws = (await accessibleWorkspaces(ctx.db, p)).find((w) => w.id === kind.workspace_id);
    if (ws?.role !== 'author') throw forbidden(`a new ${kind.prefix} item needs the author role in the workspace that holds the kind`);
  }
  if (!input.title?.trim()) throw badRequest('a new item needs a title');
  const def = kind.definition;
  if (input.body !== undefined && def.owner) throw badRequest(`${kind.prefix} items are kept by ${def.owner}; the hub holds no body for them, only their state`);
  if (input.edits) throw badRequest('a new item has no body to edit; send its body');
  const labels = Object.fromEntries(Object.entries(checkLabels(def, input.labels ?? {})).filter((e): e is [string, LabelValue] => e[1] !== null));
  checkDates(def, labels);
  const parent = input.parent ? await parentLink(ctx, p, kind, input.parent) : undefined;
  const members = await membersOf(ctx.db, p.orgId, def);
  // An item serves the scope it names, or its workspace's; with no owner named it takes that scope's steward.
  const at = await defaultsFor(ctx.db, p.orgId, kind.workspace_id, input.scope ? await checkScope(ctx.db, p.orgId, input.scope) : null);
  const owner = input.owner ? await ownerOf(ctx.db, p, input.owner) : input.owner === null ? null : at.steward;
  const delegation = input.delegate !== undefined && input.delegate !== false ? await delegationOf(ctx.db, p, { key: `a new ${kind.prefix} item`, owner }, input.delegate) : null;
  const id = randomId();
  return commit({ ctx, p, key }, undefined, async (tx) => {
    const n = await tx.query<{ number: number }>('update item_kinds set next_number = next_number + 1 where id = $1 returning next_number - 1 as number', [kind.id]);
    const number = Number(n[0]!.number);
    const itemKey = `${kind.prefix}-${number}`;
    const bodyId = input.body !== undefined ? await saveBody(tx, id, input.body) : null;
    const start = startState(def);
    const placed = input.place ? await placement(tx, kind, { id, key: itemKey }, labels, input.place) : undefined;
    const events: { id: string; data: EventData }[] = [
      { id, data: { type: 'created', key: itemKey, number, kindId: kind.id, workspaceId: kind.workspace_id, ref: input.ref ?? null, title: input.title!.trim(), state: start.id, class: start.class, askerId: p.module ? null : p.userId, labels, revision: input.revision ?? null, bodyId, owner, scope: at.scope } },
      ...(delegation ? [{ id, data: { type: 'delegated' as const, to: delegation } }] : []),
      ...(parent ? [{ id, data: { type: 'linked' as const, rel: 'part-of' as const, target: parent } }] : []),
      ...(placed ? placedEvents(id, placed) : []),
    ];
    return { events, line: `created ${itemKey}: ${input.title!.trim()} (${start.text})${placed ? `, placed ${placed.words}` : ''}`, key: itemKey, named: (s) => namedBy(def, s, members) };
  });
}

async function change(ctx: AppContext, p: Principal, f: Found, input: PutInput, key: string | undefined): Promise<WriteAnswer> {
  // The owner delegates what they answer for, whether or not they write its workspace.
  if (!(onlyDelegates(input) && isOwner(f.item.owner, p))) requireAuthor(f);
  const def = f.kind.definition;
  if ((input.body !== undefined || input.edits) && def.owner) throw badRequest(`${f.item.key} is kept by ${def.owner}; the hub holds no body for it`);
  if (input.body !== undefined && input.edits) throw badRequest('send the body or edits to it, not both');
  const labels = checkLabels(def, input.labels ?? {});
  const parent = input.parent !== undefined ? await parentLink(ctx, p, f.kind, input.parent) : undefined;
  const members = await membersOf(ctx.db, p.orgId, def);
  const owner = input.owner === undefined ? undefined : input.owner === null ? null : await ownerOf(ctx.db, p, input.owner);
  const scope = input.scope === undefined ? undefined : input.scope === null ? null : await checkScope(ctx.db, p.orgId, input.scope);
  return commit({ ctx, p, key }, f.item.id, async (tx, before) => {
    const s = before!;
    const set: { title?: string; labels?: Record<string, LabelValue | null>; revision?: string; bodyId?: string } = {};
    if (input.title !== undefined && input.title.trim() !== s.title) set.title = input.title.trim();
    const changedLabels = Object.fromEntries(Object.entries(labels).filter(([k, v]) => (v === null ? s.labels[k] !== undefined : s.labels[k] !== v)));
    if (Object.keys(changedLabels).length) set.labels = changedLabels;
    if (input.revision !== undefined && input.revision !== s.revision) set.revision = input.revision;
    if (input.body !== undefined || input.edits) {
      const current = (s.bodyId ? (await maybe<{ text: string }>(tx, 'select text from item_bodies where id = $1', [s.bodyId]))?.text : undefined) ?? '';
      const next = input.edits ? editBody(s.key, current, input.edits) : input.body!;
      if (current !== next) set.bodyId = await saveBody(tx, s.id, next);
    }
    const events: { id: string; data: EventData }[] = [];
    if (Object.keys(set).length) events.push({ id: s.id, data: { type: 'changed', ...set } });
    const who = ownership(s, owner, scope, input.delegate === undefined ? undefined : await delegationOf(tx, p, { key: s.key, owner: owner === undefined ? s.owner : owner }, input.delegate));
    events.push(...who.events);
    const oldParent = s.links.find((l) => l.rel === 'part-of')?.target;
    if (parent !== undefined && parent !== oldParent) {
      if (oldParent) events.push({ id: s.id, data: { type: 'unlinked', rel: 'part-of', target: oldParent } });
      events.push({ id: s.id, data: { type: 'linked', rel: 'part-of', target: parent } });
    }
    const after = mergeLabels(s.labels, set.labels ?? {});
    if (set.labels) checkDates(def, after);
    // A new horizon without a place puts the item after the ranked ones there, until it is placed.
    const placed = input.place ? await placement(tx, f.kind, s, after, input.place) : undefined;
    const moved = set.labels && 'horizon' in set.labels && s.rank !== null;
    if (placed) events.push(...placedEvents(s.id, placed));
    else if (moved) events.push({ id: s.id, data: { type: 'placed', rank: null } });
    const what = [...Object.keys(set).map((k) => (k === 'bodyId' ? 'body' : k)), ...who.what, ...(parent !== undefined && parent !== oldParent ? ['parent'] : []), ...(placed ? [`placed ${placed.words}`] : [])];
    return { events, line: what.length ? `saved ${s.key} (${what.join(', ')})` : `unchanged: ${s.key}`, key: s.key, named: (x) => namedBy(def, x, members) };
  });
}

/** The events a change to who answers for an item, who it is delegated to, and its scope makes; a new owner ends the old owner's delegation. */
function ownership(s: ItemState, owner: ItemState['owner'] | undefined, scope: string | null | undefined, delegation: ItemState['delegate'] | undefined): { events: { id: string; data: EventData }[]; what: string[] } {
  const events: { id: string; data: EventData }[] = [];
  const what: string[] = [];
  const same = <T,>(a: T, b: T): boolean => JSON.stringify(a) === JSON.stringify(b);
  if (owner !== undefined && !same(owner, s.owner)) {
    events.push({ id: s.id, data: { type: 'assigned', owner } });
    what.push('owner');
  }
  const next = delegation !== undefined ? delegation : owner !== undefined && !same(owner, s.owner) ? null : s.delegate;
  if (!same(next, s.delegate) && !(next && s.delegate && next.agentId === s.delegate.agentId && next.userId === s.delegate.userId)) {
    events.push({ id: s.id, data: { type: 'delegated', to: next } });
    what.push(next ? 'delegated' : 'delegation taken back');
  }
  if (scope !== undefined && scope !== s.scope) {
    events.push({ id: s.id, data: { type: 'scoped', scope } });
    what.push('scope');
  }
  return { events, what };
}

/** Labels as they stand once a change lands: a null takes one away. */
function mergeLabels(before: Readonly<Record<string, LabelValue>>, change: Readonly<Record<string, LabelValue | null>>): Record<string, LabelValue> {
  const out: Record<string, LabelValue> = { ...before };
  for (const [k, v] of Object.entries(change)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

/** The events a placement makes: a rank for each unranked item shown before it, then the item's own. */
function placedEvents(id: string, p: Placement): { id: string; data: EventData }[] {
  return [...p.peers.map((x) => ({ id: x.id, data: { type: 'placed' as const, rank: x.rank } })), { id, data: { type: 'placed', rank: p.rank } }];
}

/** Applies body edits in order; each old string must stand in the body exactly once, which is the guard that needs no version. */
export function editBody(key: string, text: string, edits: readonly { readonly old: string; readonly new: string }[]): string {
  let out = text;
  for (const [i, e] of edits.entries()) {
    const at = out.indexOf(e.old);
    if (at < 0) throw badRequest(`edit ${i + 1} to ${key}'s body: the old text is not in it; read ${key} and send text as it stands`);
    if (out.indexOf(e.old, at + 1) >= 0) throw badRequest(`edit ${i + 1} to ${key}'s body: the old text stands more than once; send more of the text around it`);
    out = out.slice(0, at) + e.new + out.slice(at + e.old.length);
  }
  return out;
}

async function saveBody(tx: Db, itemId: string, text: string): Promise<string> {
  const id = randomId();
  await tx.query('insert into item_bodies (id, item_id, text) values ($1, $2, $3)', [id, itemId, text]);
  return id;
}

/** The parent an item may be part of: a kind that lists this kind among its parts. */
async function parentLink(ctx: AppContext, p: Principal, kind: KindRow, parent: string): Promise<string> {
  const f = await findItem(ctx, p, parent);
  if (!f.kind.definition.parts.includes(kind.prefix)) throw badRequest(`a ${kind.prefix} item cannot be part of ${f.item.key}: kind ${f.kind.prefix} lists ${f.kind.definition.parts.join(', ') || 'no kinds'} as its parts`);
  return f.item.id;
}

export interface MoveInput {
  readonly to: string;
  readonly note?: string | undefined;
  readonly revision?: string | undefined;
}

/** Moves an item to another state through the gate. A refusal names the moves open instead. */
export async function move(ctx: AppContext, p: Principal, ref: string, input: MoveInput, key: string | undefined): Promise<WriteAnswer> {
  const again = await repeat(ctx, p, key);
  if (again) return again;
  const f = await findItem(ctx, p, ref);
  if (input.note !== undefined && input.note.length > NOTE_MAX) throw badRequest(`a note is at most ${NOTE_MAX} characters; attach a longer text as a file`);
  const def = f.kind.definition;
  const members = await membersOf(ctx.db, p.orgId, def);
  return commit({ ctx, p, key }, f.item.id, async (_tx, before) => {
    const s = before!;
    if (s.state === input.to) return { events: [], line: `unchanged: ${s.key} is already ${input.to}`, key: s.key, named: (x) => namedBy(def, x, members) };
    const gate = checkMove(def, s, input.to, f.caller, members, input);
    if (!gate.ok) throw new HttpError(409, `${s.key} did not move: ${gate.why}`, { open: gate.open });
    const data: EventData = { type: 'moved', from: s.state, to: input.to, class: classOf(def, input.to)!, ...(input.note?.trim() ? { note: input.note.trim() } : {}), ...(input.revision ? { revision: input.revision } : {}) };
    return { events: [{ id: s.id, data }], line: `${s.key} moved ${s.state} → ${input.to} (${gate.move.label ?? 'move'})`, key: s.key, named: (x) => namedBy(def, x, members) };
  });
}

/** Who a hold or release names: `me`, or a person by email. */
async function personOf(ctx: AppContext, p: Principal, who: string | undefined): Promise<string> {
  if (!who || who === 'me') return p.userId;
  const u = await maybe<{ id: string }>(ctx.db, 'select id from users where org_id = $1 and lower(email) = lower($2) and disabled_at is null', [p.orgId, who]);
  if (!u) throw new HttpError(404, `no person ${who} in this organization`);
  return u.id;
}

export async function hold(ctx: AppContext, p: Principal, ref: string, person: string | undefined, key: string | undefined): Promise<WriteAnswer> {
  requirePerson(p, 'holding an item');
  const again = await repeat(ctx, p, key);
  if (again) return again;
  const f = await findItem(ctx, p, ref);
  requireAuthor(f);
  const userId = await personOf(ctx, p, person);
  const members = await membersOf(ctx.db, p.orgId, f.kind.definition);
  return commit({ ctx, p, key }, f.item.id, async (_tx, before) => {
    const s = before!;
    const name = userId === p.userId ? 'you' : person!;
    if (s.holders.includes(userId)) return { events: [], line: `unchanged: ${name} already hold ${s.key}`, key: s.key, named: (x) => namedBy(f.kind.definition, x, members) };
    return { events: [{ id: s.id, data: { type: 'held', userId } }], line: `${s.key} is held by ${name}`, key: s.key, named: (x) => namedBy(f.kind.definition, x, members) };
  });
}

export async function release(ctx: AppContext, p: Principal, ref: string, person: string | undefined, key: string | undefined): Promise<WriteAnswer> {
  const again = await repeat(ctx, p, key);
  if (again) return again;
  const f = await findItem(ctx, p, ref);
  const userId = await personOf(ctx, p, person);
  if (userId !== p.userId) requireAuthor(f);
  const members = await membersOf(ctx.db, p.orgId, f.kind.definition);
  return commit({ ctx, p, key }, f.item.id, async (_tx, before) => {
    const s = before!;
    const name = userId === p.userId ? 'you' : person!;
    if (!s.holders.includes(userId)) return { events: [], line: `unchanged: ${name} do not hold ${s.key}`, key: s.key, named: (x) => namedBy(f.kind.definition, x, members) };
    return { events: [{ id: s.id, data: { type: 'released', userId } }], line: `${s.key} is released by ${name}`, key: s.key, named: (x) => namedBy(f.kind.definition, x, members) };
  });
}

export async function note(ctx: AppContext, p: Principal, ref: string, text: string, key: string | undefined): Promise<WriteAnswer> {
  const again = await repeat(ctx, p, key);
  if (again) return again;
  const f = await findItem(ctx, p, ref);
  requireAuthor(f);
  const t = text.trim();
  if (!t) throw badRequest('a note has text');
  if (t.length > NOTE_MAX) throw badRequest(`a note is at most ${NOTE_MAX} characters; attach a longer text as a file`);
  const members = await membersOf(ctx.db, p.orgId, f.kind.definition);
  return commit({ ctx, p, key }, f.item.id, async (_tx, before) => ({ events: [{ id: before!.id, data: { type: 'noted', text: t } }], line: `noted on ${before!.key}`, key: before!.key, named: (x) => namedBy(f.kind.definition, x, members) }));
}

/** The longest file an item takes. */
export const FILE_MAX = 25 * 1024 * 1024;

/** Stores the file first, then commits the event that names it (VAN-3007). */
export async function attach(ctx: AppContext, p: Principal, ref: string, file: { name: string; contentType: string; bytes: Uint8Array }, key: string | undefined): Promise<WriteAnswer> {
  const again = await repeat(ctx, p, key);
  if (again) return again;
  const f = await findItem(ctx, p, ref);
  requireAuthor(f);
  const name = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  if (!name) throw badRequest('a file has a name');
  if (file.bytes.length > FILE_MAX) throw badRequest(`a file on an item is at most ${FILE_MAX / 1024 / 1024} MB`);
  const fileId = randomId();
  const blobKey = `items/${p.orgId}/${f.item.id}/${fileId}`;
  await ctx.blob.put(blobKey, file.bytes, file.contentType);
  const members = await membersOf(ctx.db, p.orgId, f.kind.definition);
  return commit({ ctx, p, key }, f.item.id, async (tx, before) => {
    await tx.query('insert into item_files (id, item_id, name, content_type, size, blob_key) values ($1, $2, $3, $4, $5, $6)', [fileId, before!.id, name, file.contentType, file.bytes.length, blobKey]);
    return { events: [{ id: before!.id, data: { type: 'attached', fileId, name, size: file.bytes.length, contentType: file.contentType } }], line: `attached ${name} to ${before!.key} (${file.bytes.length} bytes)`, key: before!.key, named: (x) => namedBy(f.kind.definition, x, members) };
  });
}

/** Links an item to another item, a box, a view, or a decision record; `remove` takes the link away. */
export async function link(ctx: AppContext, p: Principal, ref: string, input: { rel: string; target: string; remove?: boolean | undefined }, key: string | undefined): Promise<WriteAnswer> {
  const again = await repeat(ctx, p, key);
  if (again) return again;
  const f = await findItem(ctx, p, ref);
  requireAuthor(f);
  if (!(LINK_RELS as readonly string[]).includes(input.rel)) throw badRequest(`a link is one of ${LINK_RELS.join(', ')}`);
  const rel = input.rel as LinkRel;
  const target = await linkTarget(ctx, p, f, rel, input.target);
  const members = await membersOf(ctx.db, p.orgId, f.kind.definition);
  return commit({ ctx, p, key }, f.item.id, async (_tx, before) => {
    const s = before!;
    const has = s.links.some((l) => l.rel === rel && l.target === target);
    const named = (x: ItemState): ReturnType<typeof namedBy> => namedBy(f.kind.definition, x, members);
    if (input.remove) return has ? { events: [{ id: s.id, data: { type: 'unlinked', rel, target } }], line: `${s.key} no longer ${rel} ${input.target}`, key: s.key, named } : { events: [], line: `unchanged: ${s.key} has no ${rel} link to ${input.target}`, key: s.key, named };
    if (has) return { events: [], line: `unchanged: ${s.key} already ${rel} ${input.target}`, key: s.key, named };
    const events: { id: string; data: EventData }[] = [];
    const old = rel === 'part-of' ? s.links.find((l) => l.rel === 'part-of') : undefined;
    if (old) events.push({ id: s.id, data: { type: 'unlinked', rel, target: old.target } });
    events.push({ id: s.id, data: { type: 'linked', rel, target } });
    return { events, line: `${s.key} ${rel} ${input.target}`, key: s.key, named };
  });
}

export type { Members };

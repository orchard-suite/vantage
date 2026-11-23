/**
 * The verbs that change an item (VAN-5001): put, move, hold,
 * release, note, attach, link. Each commits alone, in one transaction that
 * holds the feed lock, appends one event, and answers one line. A write sent
 * twice with the same key answers the first line again and changes nothing.
 */
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { randomId } from '../crypto.ts';
import { HttpError, badRequest, forbidden } from '../http.ts';
import { accessibleWorkspaces } from '../authz.ts';
import { classOf, kindByPrefix, startState, type KindDef, type KindRow } from './kinds.ts';
import { checkMove, membersOf, namedBy, type Members } from './gate.ts';
import { answered, append, lockFeed, stateById, type Actor } from './store.ts';
import { CLAIM_MINUTES, LABEL_TEXT_MAX, LINK_RELS, NOTE_MAX, RUN_TEXT_MAX, TITLE_MAX, type EventData, type ItemState, type LabelValue, type LinkRel, type RunRecord } from './state.ts';
import { findItem, requireAuthor, type Found } from './access.ts';
import { linkTarget } from './links.ts';
import { requireApp, requirePerson } from './apps.ts';
import { dependents, rework } from './worked.ts';

/** What a write answers: one line, and the item as it stands after. */
export interface WriteAnswer {
  readonly status: 'done' | 'unchanged' | 'repeat';
  readonly line: string;
  readonly key: string;
}

export function actorOf(p: Principal): Actor {
  if (p.module) return { userId: `app:${p.module.clientId}`, kind: 'app', surface: `app:${p.module.clientId}` };
  // A person who acted through a module's client is the actor, and the module is where it came from.
  return { userId: p.userId, kind: p.surface === 'mcp' ? 'agent' : 'person', surface: p.client ? `${p.surface}:${p.client}` : p.surface };
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
async function repeat(ctx: AppContext, p: Principal, key: string | undefined): Promise<WriteAnswer | undefined> {
  const prior = await answered(ctx.db, p.orgId, key, p.userId);
  return prior ? { status: 'repeat', line: prior.answer, key: prior.key } : undefined;
}

interface Commit {
  readonly ctx: AppContext;
  readonly p: Principal;
  readonly key: string | undefined;
}

/**
 * Runs one write: the feed lock, a repeat answered as before, the item read
 * again under its row lock, and the events `act` makes appended. `act`
 * answers no events when nothing would change.
 */
async function commit(c: Commit, itemId: string | undefined, act: (tx: Db, before: ItemState | undefined) => Promise<{ events: { id: string; data: EventData }[]; line: string; key: string; named: (s: ItemState) => ReturnType<typeof namedBy> }>): Promise<WriteAnswer> {
  return c.ctx.db.transaction(async (tx) => {
    await lockFeed(tx, c.p.orgId);
    const prior = await answered(tx, c.p.orgId, c.key, c.p.userId);
    if (prior) return { status: 'repeat' as const, line: prior.answer, key: prior.key };
    const before = itemId ? await stateById(tx, itemId, true) : undefined;
    const out = await act(tx, before);
    // Any call a claimant makes on its item renews the claim once half of it has run, so no model spends a turn on a heartbeat.
    const claimed = before?.claim;
    if (claimed?.userId === c.p.userId && Date.parse(claimed.until) - Date.now() < (CLAIM_MINUTES * 60_000) / 2 && Date.parse(claimed.until) > Date.now() && !out.events.some((e) => e.data.type === 'claimed' || e.data.type === 'renewed' || (e.data.type === 'released' && e.data.userId === c.p.userId))) {
      out.events.push({ id: before!.id, data: { type: 'renewed', until: new Date(Date.now() + CLAIM_MINUTES * 60_000).toISOString() } });
    }
    if (!out.events.length) return { status: 'unchanged' as const, line: out.line, key: out.key };
    let s = before;
    const touched = new Set<string>();
    for (const [i, e] of out.events.entries()) {
      // The key rides on the first event: a repeat finds it and answers the line, and the rest of the write is already in.
      s = await append(tx, { orgId: c.p.orgId, itemId: e.id, before: s, data: e.data, actor: actorOf(c.p), key: i === 0 ? c.key : undefined, answer: out.line, named: out.named });
      touched.add(e.id);
      if ((e.data.type === 'linked' || e.data.type === 'unlinked') && e.data.rel === 'part-of') touched.add(e.data.target);
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
  /** The item this one is part of, by key. */
  readonly parent?: string | undefined;
}

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
  const labels = Object.fromEntries(Object.entries(checkLabels(def, input.labels ?? {})).filter((e): e is [string, LabelValue] => e[1] !== null));
  const parent = input.parent ? await parentLink(ctx, p, kind, input.parent) : undefined;
  const members = await membersOf(ctx.db, p.orgId, def);
  const id = randomId();
  return commit({ ctx, p, key }, undefined, async (tx) => {
    const n = await tx.query<{ number: number }>('update item_kinds set next_number = next_number + 1 where id = $1 returning next_number - 1 as number', [kind.id]);
    const number = Number(n[0]!.number);
    const itemKey = `${kind.prefix}-${number}`;
    const bodyId = input.body !== undefined ? await saveBody(tx, id, input.body) : null;
    const start = startState(def);
    const events: { id: string; data: EventData }[] = [
      { id, data: { type: 'created', key: itemKey, number, kindId: kind.id, workspaceId: kind.workspace_id, ref: input.ref ?? null, title: input.title!.trim(), state: start.id, class: start.class, askerId: p.module ? null : p.userId, labels, revision: input.revision ?? null, bodyId } },
      ...(parent ? [{ id, data: { type: 'linked' as const, rel: 'part-of' as const, target: parent } }] : []),
    ];
    return { events, line: `created ${itemKey}: ${input.title!.trim()} (${start.text})`, key: itemKey, named: (s) => namedBy(def, s, members) };
  });
}

async function change(ctx: AppContext, p: Principal, f: Found, input: PutInput, key: string | undefined): Promise<WriteAnswer> {
  requireAuthor(f);
  const def = f.kind.definition;
  if (input.body !== undefined && def.owner) throw badRequest(`${f.item.key} is kept by ${def.owner}; the hub holds no body for it`);
  const labels = checkLabels(def, input.labels ?? {});
  const parent = input.parent !== undefined ? await parentLink(ctx, p, f.kind, input.parent) : undefined;
  const members = await membersOf(ctx.db, p.orgId, def);
  return commit({ ctx, p, key }, f.item.id, async (tx, before) => {
    const s = before!;
    const set: { title?: string; labels?: Record<string, LabelValue | null>; revision?: string; bodyId?: string } = {};
    if (input.title !== undefined && input.title.trim() !== s.title) set.title = input.title.trim();
    const changedLabels = Object.fromEntries(Object.entries(labels).filter(([k, v]) => (v === null ? s.labels[k] !== undefined : s.labels[k] !== v)));
    if (Object.keys(changedLabels).length) set.labels = changedLabels;
    if (input.revision !== undefined && input.revision !== s.revision) set.revision = input.revision;
    if (input.body !== undefined) {
      const current = s.bodyId ? (await maybe<{ text: string }>(tx, 'select text from item_bodies where id = $1', [s.bodyId]))?.text : undefined;
      if ((current ?? '') !== input.body) set.bodyId = await saveBody(tx, s.id, input.body);
    }
    const events: { id: string; data: EventData }[] = [];
    if (Object.keys(set).length) events.push({ id: s.id, data: { type: 'changed', ...set } });
    const oldParent = s.links.find((l) => l.rel === 'part-of')?.target;
    if (parent !== undefined && parent !== oldParent) {
      if (oldParent) events.push({ id: s.id, data: { type: 'unlinked', rel: 'part-of', target: oldParent } });
      events.push({ id: s.id, data: { type: 'linked', rel: 'part-of', target: parent } });
    }
    const what = [...Object.keys(set).map((k) => (k === 'bodyId' ? 'body' : k)), ...(parent !== undefined && parent !== oldParent ? ['parent'] : [])];
    return { events, line: what.length ? `saved ${s.key} (${what.join(', ')})` : `unchanged: ${s.key}`, key: s.key, named: (x) => namedBy(def, x, members) };
  });
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

const live = (claim: ItemState['claim'], now = Date.now()): boolean => !!claim && Date.parse(claim.until) > now;
const until = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

/**
 * Takes an item for a set time (VAN-3010). Two claims on one
 * item cannot both hold: the row lock and the feed lock order them, and the
 * second finds the first. A claim past its end holds nothing; the next
 * claim lets the lapsed claimant go first.
 */
export async function claim(ctx: AppContext, p: Principal, ref: string, minutes: number | undefined, key: string | undefined): Promise<WriteAnswer> {
  requirePerson(p, 'a claim');
  const again = await repeat(ctx, p, key);
  if (again) return again;
  const f = await findItem(ctx, p, ref);
  requireAuthor(f);
  const mins = Math.min(Math.max(1, minutes ?? CLAIM_MINUTES), 240);
  const members = await membersOf(ctx.db, p.orgId, f.kind.definition);
  return commit({ ctx, p, key }, f.item.id, async (_tx, before) => {
    const s = before!;
    const named = (x: ItemState): ReturnType<typeof namedBy> => namedBy(f.kind.definition, x, members);
    if (s.class === 'done' || s.class === 'parked') throw new HttpError(409, `${s.key} is ${s.state}; there is no work to claim`);
    if (live(s.claim) && s.claim!.userId !== p.userId) throw new HttpError(409, `${s.key} is claimed until ${s.claim!.until.slice(0, 16).replace('T', ' ')} UTC; vantage_queue offers it again when the claim runs out`);
    const events: { id: string; data: EventData }[] = [];
    if (s.claim && !live(s.claim) && s.claim.userId !== p.userId) events.push({ id: s.id, data: { type: 'released', userId: s.claim.userId } });
    events.push({ id: s.id, data: { type: 'claimed', userId: p.userId, until: until(mins) } });
    return { events, line: `${s.key} is claimed by you for ${mins} minutes; any call you make on it renews the claim`, key: s.key, named };
  });
}

/** Keeps a claim alive. The bridge sends it while its session lives; the claimant's own calls renew too. */
export async function renew(ctx: AppContext, p: Principal, ref: string, key: string | undefined): Promise<WriteAnswer> {
  const again = await repeat(ctx, p, key);
  if (again) return again;
  const f = await findItem(ctx, p, ref);
  const members = await membersOf(ctx.db, p.orgId, f.kind.definition);
  return commit({ ctx, p, key }, f.item.id, async (_tx, before) => {
    const s = before!;
    if (s.claim?.userId !== p.userId) throw new HttpError(409, `you hold no claim on ${s.key}; take one with claim`);
    return { events: [{ id: s.id, data: { type: 'renewed', until: until(CLAIM_MINUTES) } }], line: `${s.key} is claimed by you for ${CLAIM_MINUTES} more minutes`, key: s.key, named: (x) => namedBy(f.kind.definition, x, members) };
  });
}

export interface FinishInput {
  /** The state to move to, through the gate. */
  readonly move?: string | undefined;
  readonly run: RunRecord;
}

/** Ends a run in one call: its run record, its move, and letting the item go, each its own event. */
export async function finish(ctx: AppContext, p: Principal, ref: string, input: FinishInput, key: string | undefined): Promise<WriteAnswer> {
  requirePerson(p, 'finishing a run');
  const again = await repeat(ctx, p, key);
  if (again) return again;
  const r = input.run;
  if (!r.summary.trim()) throw badRequest('a run record says what the run did');
  if (r.summary.length > RUN_TEXT_MAX || (r.handoff?.length ?? 0) > RUN_TEXT_MAX) throw badRequest(`a run summary and a handoff note are at most ${RUN_TEXT_MAX} characters each; attach a longer account as a file`);
  if (r.proof.length > 20 || r.proof.some((x) => x.length > 300)) throw badRequest('a run names at most 20 pieces of proof, each a short address or link');
  const f = await findItem(ctx, p, ref);
  const def = f.kind.definition;
  const members = await membersOf(ctx.db, p.orgId, def);
  return commit({ ctx, p, key }, f.item.id, async (_tx, before) => {
    const s = before!;
    const events: { id: string; data: EventData }[] = [{ id: s.id, data: { type: 'ran', run: { summary: r.summary.trim(), proof: r.proof, ...(r.handoff?.trim() ? { handoff: r.handoff.trim() } : {}), ...(r.seconds !== undefined ? { seconds: r.seconds } : {}), ...(r.cost ? { cost: r.cost } : {}) } } }];
    let moved = '';
    if (input.move && input.move !== s.state) {
      const gate = checkMove(def, s, input.move, f.caller, members, { note: r.summary });
      if (!gate.ok) throw new HttpError(409, `${s.key} did not finish: ${gate.why}`, { open: gate.open });
      events.push({ id: s.id, data: { type: 'moved', from: s.state, to: input.move, class: classOf(def, input.move)!, note: r.summary.trim() } });
      moved = `, moved ${s.state} → ${input.move}`;
    }
    if (s.holders.includes(p.userId) || s.claim?.userId === p.userId) events.push({ id: s.id, data: { type: 'released', userId: p.userId } });
    return { events, line: `${s.key} run recorded${moved}, and released`, key: s.key, named: (x) => namedBy(def, x, members) };
  });
}

/** Asks a person on the item: it moves to the state where its lifecycle waits for an answer, carrying the question. */
export async function ask(ctx: AppContext, p: Principal, ref: string, question: string, key: string | undefined): Promise<WriteAnswer> {
  requirePerson(p, 'asking on an item');
  const again = await repeat(ctx, p, key);
  if (again) return again;
  const q = question.trim();
  if (!q) throw badRequest('a question has words');
  if (q.length > NOTE_MAX) throw badRequest(`a question is at most ${NOTE_MAX} characters`);
  const f = await findItem(ctx, p, ref);
  const def = f.kind.definition;
  const members = await membersOf(ctx.db, p.orgId, def);
  return commit({ ctx, p, key }, f.item.id, async (_tx, before) => {
    const s = before!;
    const waits = def.states.filter((x) => x.waits).map((x) => x.id);
    const to = def.moves.find((m) => m.from === s.state && waits.includes(m.to))?.to;
    if (!to) throw new HttpError(409, `${s.key}'s lifecycle draws no move from ${s.state} to a state that waits for a person; note the question instead`);
    const gate = checkMove(def, s, to, f.caller, members, { note: q });
    if (!gate.ok) throw new HttpError(409, `${s.key} did not move: ${gate.why}`, { open: gate.open });
    return { events: [{ id: s.id, data: { type: 'moved', from: s.state, to, class: classOf(def, to)!, note: q, question: true } }], line: `${s.key} waits in ${to} for an answer`, key: s.key, named: (x) => namedBy(def, x, members) };
  });
}

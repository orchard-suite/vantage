/**
 * Worked-out state (VAN-3009). A kind whose lifecycle gives
 * moves to `proof` is moved by the hub, never by a person, when its proof
 * says so: its parts and the items it names as proof, by their state; the
 * boxes it names as proof, by whether a connector saw their real thing; and
 * the commits that name it (VAN-3026), which say work landed and so put it
 * under way, but never finish it alone.
 * Done lands only on proof a machine read. Every worked move is an event
 * like any other, made by the hub in the same transaction as the change
 * that caused it.
 */
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { loadStored } from '../documents/model.ts';
import type { ImportMap } from '../documents/model.ts';
import { classOf, type KindDef, type KindRow } from './kinds.ts';
import { membersOf, namedBy } from './gate.ts';
import { append, lockFeed, stateById } from './store.ts';
import type { ItemState } from './state.ts';
import { isCommitTarget, parseCommitTarget, type CommitProof } from './commit-target.ts';

/** Whether the hub moves items of this kind from their proof. */
export function isWorked(def: KindDef): boolean {
  return def.moves.some((m) => (m.who ?? []).includes('proof'));
}

export interface Proof {
  /** Parts and items named as proof, with their state's class and since when. */
  readonly items: readonly { readonly key: string; readonly class: ItemState['class']; readonly since: string }[];
  /** Boxes named as proof: seen when a connector read their real thing, unread when nothing binds them to one. */
  readonly boxes: readonly { readonly target: string; readonly seen: boolean | 'unread'; readonly at: string | null }[];
  /** Commits that name the item in a Work trailer, oldest first. */
  readonly commits: readonly CommitProof[];
  /** When the newest piece of proof changed. */
  readonly at: string | null;
}

const iso = (d: Date | string): string => new Date(d).toISOString();

/** What an item's proof says now. */
export async function readProof(db: Db, item: Pick<ItemState, 'id' | 'links'>): Promise<Proof> {
  const named = item.links.filter((l) => l.rel === 'proof');
  const itemIds = named.filter((l) => !l.target.includes('#') && !l.target.startsWith('ticket:') && !isCommitTarget(l.target)).map((l) => l.target);
  // Its parts, the items it names as proof, and the items that link toward it, as a milestone's are.
  // A part not started whose own commits have landed is under way: a parent reads the work on its parts.
  const rows = await db.query<{ key: string; class: ItemState['class']; state_since: Date; landed: Date | null }>(
    "select i.key, i.class, i.state_since, (select max(substring(l.target from '@([^@]+)$'))::timestamptz from item_links l where l.item_id = i.id and l.rel = 'proof' and l.target like 'commit:%') as landed from items i where i.parent_id = $1 or i.id = any($2::text[]) or i.id in (select item_id from item_links where rel = 'toward' and target = $1) order by i.key",
    [item.id, itemIds],
  );
  const items: { key: string; class: ItemState['class']; since: string }[] = rows.map((r) => (r.class === 'not-started' && r.landed ? { key: r.key, class: 'in-progress', since: iso(r.landed) } : { key: r.key, class: r.class, since: iso(r.state_since) }));
  // A ticket a connector reads: open while the connector still reports it, done once it has dropped out of what is open.
  for (const l of named.filter((x) => x.target.startsWith('ticket:'))) {
    const [, sourceId, id] = l.target.split(':') as [string, string, string];
    const open = await maybe<{ data: { status?: string }; observed: string }>(db, 'select data, observed from observed_items where source_id = $1 and key like $2 limit 1', [sourceId, `%:${id}@%`]);
    const ran = await maybe<{ at: Date }>(db, "select coalesce(max(finished_at), max(started_at)) as at from source_runs where source_id = $1", [sourceId]).catch(() => undefined);
    const waiting = /^(to ?do|backlog|open|new|selected)/i.test(open?.data.status ?? '');
    items.push({ key: id, class: open ? (waiting ? 'not-started' : 'in-progress') : 'done', since: open ? open.observed : ran?.at ? iso(ran.at) : new Date(0).toISOString() });
  }
  const boxes: { target: string; seen: boolean | 'unread'; at: string | null }[] = [];
  for (const l of named.filter((x) => x.target.includes('#'))) {
    const [docId, node] = l.target.split('#') as [string, string];
    const head = await maybe<{ yaml: string; imports: ImportMap }>(db, 'select v.yaml, v.imports from documents d join versions v on v.id = d.head_version_id where d.id = $1', [docId]);
    const bound = head ? loadStored(head.yaml, head.imports).model?.nodes.get(node)?.bind : undefined;
    if (!bound) {
      boxes.push({ target: l.target, seen: 'unread', at: null });
      continue;
    }
    const report = await maybe<{ report: { items: { kind: string; nodeId?: string }[] }; updated_at: Date }>(db, 'select report, updated_at from drift_reports where document_id = $1', [docId]);
    const missing = !report || report.report.items.some((i) => i.kind === 'declared-not-observed' && i.nodeId === node);
    boxes.push({ target: l.target, seen: !missing, at: report ? iso(report.updated_at) : null });
  }
  const commits = named.flatMap((l) => parseCommitTarget(l.target) ?? []).sort((a, b) => a.at.localeCompare(b.at));
  const times = [...items.map((i) => i.since), ...boxes.flatMap((b) => (b.at ? [b.at] : [])), ...commits.map((c) => iso(c.at))].sort();
  return { items, boxes, commits, at: times[times.length - 1] ?? null };
}

/**
 * The state the proof says an item is in, by class: done when every piece
 * of proof is done or seen, in progress when any is, not started when none
 * is. Parked parts do not count. A commit puts an item under way and never
 * finishes it: with commits and nothing else, it is in progress. No proof
 * says nothing.
 */
export function provenClass(p: Proof): ItemState['class'] | undefined {
  const items = p.items.filter((i) => i.class !== 'parked');
  const boxes = p.boxes.filter((b) => b.seen !== 'unread');
  if (!items.length && !boxes.length) return p.commits.length ? 'in-progress' : undefined;
  const done = items.every((i) => i.class === 'done') && boxes.every((b) => b.seen === true);
  if (done) return 'done';
  if (p.commits.length || items.some((i) => i.class !== 'not-started') || boxes.some((b) => b.seen === true)) return 'in-progress';
  return 'not-started';
}

/** The path of proof moves from where the item stands to a state of the class the proof says; empty when none is drawn. */
export function provenPath(def: KindDef, from: string, want: ItemState['class']): string[] {
  if (classOf(def, from) === want) return [];
  const proofMoves = def.moves.filter((m) => (m.who ?? []).includes('proof'));
  const seen = new Set([from]);
  let frontier: string[][] = [[from]];
  while (frontier.length) {
    const next: string[][] = [];
    for (const path of frontier) {
      for (const m of proofMoves.filter((x) => x.from === path[path.length - 1])) {
        if (seen.has(m.to)) continue;
        const p = [...path, m.to];
        if (classOf(def, m.to) === want) return p.slice(1);
        seen.add(m.to);
        next.push(p);
      }
    }
    frontier = next;
  }
  return [];
}

/**
 * Moves each worked item the proof has moved, by the hub, inside the
 * caller's transaction. Each step is a `moved` event that names the proof.
 * Answers the keys it moved.
 */
export async function rework(tx: Db, orgId: string, itemIds: Iterable<string>): Promise<string[]> {
  const moved: string[] = [];
  for (const id of new Set(itemIds)) {
    let s = await stateById(tx, id, true);
    if (!s) continue;
    const kind = await maybe<KindRow>(tx, 'select * from item_kinds where id = $1', [s.kindId]);
    if (!kind || !isWorked(kind.definition)) continue;
    const def = kind.definition;
    const proof = await readProof(tx, s);
    const want = provenClass(proof);
    if (!want) continue;
    const path = provenPath(def, s.state, want);
    if (!path.length) continue;
    const members = await membersOf(tx, orgId, def);
    const summary = `${proof.items.length} item${proof.items.length === 1 ? '' : 's'}, ${proof.boxes.length} box${proof.boxes.length === 1 ? '' : 'es'}${proof.commits.length ? `, ${proof.commits.length} commit${proof.commits.length === 1 ? '' : 's'}` : ''}`;
    for (const to of path) {
      s = await append(tx, { orgId, itemId: s.id, before: s, data: { type: 'moved', from: s.state, to, class: classOf(def, to)!, note: `worked out from its proof (${summary})` }, actor: { userId: null, kind: 'system', agentId: null, surface: 'system' }, key: undefined, answer: `${s.key} moved ${s.state} → ${to} by its proof`, named: (x) => namedBy(def, x, members) });
    }
    moved.push(s.key);
  }
  return moved;
}

/** The worked items a change to these items may move: their parents, the items that name them as proof, and the milestones they link toward. */
export async function dependents(tx: Db, itemIds: readonly string[]): Promise<string[]> {
  if (!itemIds.length) return [];
  const rows = await tx.query<{ id: string }>(
    "select parent_id as id from items where id = any($1::text[]) and parent_id is not null union select item_id as id from item_links where rel = 'proof' and target = any($1::text[]) union select target as id from item_links where rel = 'toward' and item_id = any($1::text[])",
    [[...itemIds]],
  );
  return rows.map((r) => r.id);
}

/** The worked items that name a box of this document as proof: a connector's run may have moved them. */
export async function boxDependents(tx: Db, documentId: string): Promise<string[]> {
  return (await tx.query<{ item_id: string }>("select item_id from item_links where rel = 'proof' and target like $1", [`${documentId}#%`])).map((r) => r.item_id);
}

/** After a connector run changed what a document's boxes saw: moves the worked items that name one of them as proof. */
export async function reworkDocument(db: Db, orgId: string, documentId: string): Promise<string[]> {
  return db.transaction(async (tx) => {
    const ids = await boxDependents(tx, documentId);
    if (!ids.length) return [];
    await lockFeed(tx, orgId);
    return rework(tx, orgId, ids);
  });
}

/** The nightly review's pass: every worked item in a workspace, worked out again from its proof. */
export async function reworkWorkspace(db: Db, orgId: string, workspaceId: string): Promise<string[]> {
  const ids = (await db.query<{ id: string }>("select i.id from items i where i.workspace_id = $1 and i.class <> 'parked'", [workspaceId])).map((r) => r.id);
  if (!ids.length) return [];
  return db.transaction(async (tx) => {
    await lockFeed(tx, orgId);
    return rework(tx, orgId, ids);
  });
}

/** After a connector run: moves the worked items that name one of its tickets as proof. */
export async function reworkSource(db: Db, orgId: string, sourceId: string): Promise<string[]> {
  const ids = (await db.query<{ item_id: string }>("select item_id from item_links where rel = 'proof' and target like $1", [`ticket:${sourceId}:%`])).map((r) => r.item_id);
  if (!ids.length) return [];
  return db.transaction(async (tx) => {
    await lockFeed(tx, orgId);
    return rework(tx, orgId, ids);
  });
}

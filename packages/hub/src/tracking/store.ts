/**
 * Where an item's events and its current state are written, in one
 * transaction (docs/decisions/3006, 3007). An append takes the
 * organization's feed lock, so positions commit in the order they were
 * handed out; answers a write sent twice with the line it answered the first
 * time; folds the event into the state; and writes the state, its links, and
 * who it names. Nothing else writes these tables.
 */
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { HttpError } from '../http.ts';
import type { Surface } from '../audit.ts';
import { fold, parentOf, replay, type EventData, type ItemEvent, type ItemState, type LabelValue, type LinkRel } from './state.ts';
import { ulid } from '../decisions/ulid.ts';

export type ActorKind = 'person' | 'agent' | 'app' | 'system';

export interface Actor {
  readonly userId: string | null;
  readonly kind: ActorKind;
  /** Where the change came from: a surface, with the client a person acted through when it was another app's, or a module's own app. */
  readonly surface: Surface | `${Surface}:${string}` | `app:${string}`;
}

/** Who an item names besides its workspace's members: a person or a team, and why. */
export interface Named {
  readonly kind: 'user' | 'team';
  readonly id: string;
  readonly why: string;
}

interface ItemRow {
  readonly id: string;
  readonly org_id: string;
  readonly kind_id: string;
  readonly workspace_id: string;
  readonly number: number;
  readonly key: string;
  readonly ref: string | null;
  readonly title: string;
  readonly state: string;
  readonly class: ItemState['class'];
  readonly asker_id: string | null;
  readonly holders: string[];
  readonly labels: Record<string, LabelValue>;
  readonly revision: string | null;
  readonly body_id: string | null;
  readonly claim_user: string | null;
  readonly claim_until: Date | null;
  readonly runs: number;
  readonly position: string | number;
  readonly events: number;
  readonly notes: number;
  readonly files: number;
  readonly state_since: Date;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const iso = (d: Date | string): string => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

/** Serializes the organization's appends, so the feed's positions commit in order. */
export async function lockFeed(tx: Db, orgId: string): Promise<void> {
  await tx.query("select pg_advisory_xact_lock(hashtext('vantage.items.' || $1))", [orgId]);
}

/**
 * The answer a write with this key already gave, when one did. A key is the
 * caller's own: another caller's key is refused, so it never reads an answer
 * that was not theirs.
 */
export async function answered(tx: Db, orgId: string, key: string | undefined, actorId: string | null): Promise<{ answer: string; itemId: string; key: string } | undefined> {
  if (!key) return undefined;
  const row = await maybe<{ answer: string; item_id: string; actor_id: string | null; item_key: string }>(tx, 'select e.answer, e.item_id, e.actor_id, i.key as item_key from item_events e left join items i on i.id = e.item_id where e.org_id = $1 and e.idempotency_key = $2', [orgId, key]);
  if (!row) return undefined;
  if (row.actor_id !== actorId) throw new HttpError(409, 'that Idempotency-Key was used by another caller; make a new one for each write');
  return { answer: row.answer, itemId: row.item_id, key: row.item_key ?? '' };
}

export async function stateById(db: Db, id: string, lock = false): Promise<ItemState | undefined> {
  const row = await maybe<ItemRow>(db, `select * from items where id = $1${lock ? ' for update' : ''}`, [id]);
  if (!row) return undefined;
  const links = await db.query<{ rel: LinkRel; target: string }>('select rel, target from item_links where item_id = $1 order by rel, target', [id]);
  return {
    id: row.id,
    orgId: row.org_id,
    kindId: row.kind_id,
    workspaceId: row.workspace_id,
    number: Number(row.number),
    key: row.key,
    ref: row.ref,
    title: row.title,
    state: row.state,
    class: row.class,
    askerId: row.asker_id,
    holders: row.holders,
    labels: row.labels,
    revision: row.revision,
    bodyId: row.body_id,
    claim: row.claim_user && row.claim_until ? { userId: row.claim_user, until: iso(row.claim_until) } : null,
    runs: Number(row.runs),
    links,
    position: Number(row.position),
    events: Number(row.events),
    notes: Number(row.notes),
    files: Number(row.files),
    stateSince: iso(row.state_since),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export interface AppendInput {
  readonly orgId: string;
  readonly itemId: string;
  readonly before: ItemState | undefined;
  readonly data: EventData;
  readonly actor: Actor;
  readonly key: string | undefined;
  /** The one line the write answers, kept on the event so a repeat answers it again. */
  readonly answer: string;
  /** Who the item names once the event is folded in. */
  readonly named: (after: ItemState) => readonly Named[];
}

/** Appends one event and writes the state it folds to. Call inside a transaction that holds the feed lock. */
export async function append(tx: Db, input: AppendInput): Promise<ItemState> {
  const id = ulid();
  const row = (
    await tx.query<{ position: string | number; at: Date }>(
      'insert into item_events (id, org_id, item_id, kind_id, type, actor_id, actor_kind, surface, data, idempotency_key, answer) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning position, at',
      [id, input.orgId, input.itemId, input.data.type === 'created' ? input.data.kindId : input.before!.kindId, input.data.type, input.actor.userId, input.actor.kind, input.actor.surface, JSON.stringify(input.data), input.key ?? null, input.answer],
    )
  )[0]!;
  const event: ItemEvent = { position: Number(row.position), id, itemId: input.itemId, at: iso(row.at), data: input.data };
  const after = fold(input.before, event, input.orgId);
  await writeState(tx, after, input.before === undefined);
  await writeNamed(tx, after.id, input.named(after));
  return after;
}

async function writeState(tx: Db, s: ItemState, fresh: boolean): Promise<void> {
  const values = [s.id, s.orgId, s.kindId, s.workspaceId, s.number, s.key, s.ref, s.title, s.state, s.class, s.askerId, JSON.stringify(s.holders), JSON.stringify(s.labels), s.revision, s.bodyId, parentOf(s), s.position, s.events, s.notes, s.files, s.stateSince, s.createdAt, s.updatedAt, s.claim?.userId ?? null, s.claim?.until ?? null, s.runs];
  const search = "to_tsvector('english', $8 || ' ' || $6 || ' ' || coalesce((select string_agg(value::text, ' ') from jsonb_each_text($13::jsonb)), '') || ' ' || coalesce((select text from item_bodies where id = $15), ''))";
  if (fresh) {
    await tx.query(`insert into items (id, org_id, kind_id, workspace_id, number, key, ref, title, state, class, asker_id, holders, labels, revision, body_id, parent_id, position, events, notes, files, state_since, created_at, updated_at, claim_user, claim_until, runs, search) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, ${search})`, values);
  } else {
    await tx.query(
      `update items set kind_id = $3, workspace_id = $4, number = $5, key = $6, ref = $7, title = $8, state = $9, class = $10, asker_id = $11, holders = $12, labels = $13, revision = $14, body_id = $15, parent_id = $16, position = $17, events = $18, notes = $19, files = $20, state_since = $21, created_at = $22, updated_at = $23, claim_user = $24, claim_until = $25, runs = $26, search = ${search} where id = $1 and org_id = $2`,
      values,
    );
  }
  await tx.query('delete from item_links where item_id = $1', [s.id]);
  for (const l of s.links) await tx.query('insert into item_links (item_id, rel, target) values ($1, $2, $3)', [s.id, l.rel, l.target]);
}

async function writeNamed(tx: Db, itemId: string, named: readonly Named[]): Promise<void> {
  await tx.query('delete from item_named where item_id = $1', [itemId]);
  const seen = new Set<string>();
  for (const n of named) {
    const k = `${n.kind}:${n.id}:${n.why}`;
    if (seen.has(k)) continue;
    seen.add(k);
    await tx.query('insert into item_named (item_id, subject_kind, subject_id, why) values ($1, $2, $3, $4)', [itemId, n.kind, n.id, n.why]);
  }
}

interface EventRow {
  readonly position: string | number;
  readonly id: string;
  readonly item_id: string;
  readonly at: Date;
  readonly data: EventData;
}

const eventOf = (r: EventRow): ItemEvent => ({ position: Number(r.position), id: r.id, itemId: r.item_id, at: iso(r.at), data: r.data });

/** Every event of one item in order; for a rebuild, never for a read an agent asks for. */
export async function logOf(db: Db, itemId: string): Promise<ItemEvent[]> {
  return (await db.query<EventRow>('select position, id, item_id, at, data from item_events where item_id = $1 order by position', [itemId])).map(eventOf);
}

/** The state an item's log folds to, beside the state the table holds; equal when the table comes from the events. */
export async function rebuild(db: Db, itemId: string): Promise<{ folded: ItemState | undefined; stored: ItemState | undefined }> {
  const stored = await stateById(db, itemId);
  return { folded: replay(await logOf(db, itemId), stored?.orgId ?? ''), stored };
}

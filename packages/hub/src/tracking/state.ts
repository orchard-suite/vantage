/**
 * An item's state is what its events say (docs/decisions/3006). Every verb
 * makes events, and one pure function folds an event into the state before
 * it. The store writes what the fold answers; a rebuild folds the log from
 * the start and must answer the same. No other code sets an item's state.
 */
import type { StateClass } from '@vantage/model';

export const LINK_RELS = ['came-from', 'part-of', 'box', 'view', 'decision', 'proof', 'adds', 'changes', 'retires'] as const;
export type LinkRel = (typeof LINK_RELS)[number];

export type LabelValue = string | number;

export interface ItemState {
  readonly id: string;
  readonly orgId: string;
  readonly kindId: string;
  readonly workspaceId: string;
  readonly number: number;
  readonly key: string;
  readonly ref: string | null;
  readonly title: string;
  readonly state: string;
  readonly class: StateClass;
  readonly askerId: string | null;
  readonly holders: readonly string[];
  readonly labels: Readonly<Record<string, LabelValue>>;
  readonly revision: string | null;
  readonly bodyId: string | null;
  /** Targets by relation: `part-of` and `came-from` name item ids; `box`, `view`, `adds`, `changes`, and `retires` name document-id#id; `decision` names a record's ULID; `proof` names an item id or a document-id#box. */
  readonly links: readonly { readonly rel: LinkRel; readonly target: string }[];
  /** Who claims the item and until when; a claim past its end holds nothing. */
  readonly claim: { readonly userId: string; readonly until: string } | null;
  readonly position: number;
  readonly events: number;
  readonly notes: number;
  readonly files: number;
  readonly runs: number;
  readonly stateSince: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What each kind of event sets. An event holds the values it set and never a body's text. */
export type EventData =
  | { readonly type: 'created'; readonly key: string; readonly number: number; readonly kindId: string; readonly workspaceId: string; readonly ref: string | null; readonly title: string; readonly state: string; readonly class: StateClass; readonly askerId: string | null; readonly labels: Readonly<Record<string, LabelValue>>; readonly revision: string | null; readonly bodyId: string | null }
  | { readonly type: 'changed'; readonly title?: string; readonly labels?: Readonly<Record<string, LabelValue | null>>; readonly revision?: string; readonly bodyId?: string }
  | { readonly type: 'moved'; readonly from: string; readonly to: string; readonly class: StateClass; readonly note?: string; readonly revision?: string; readonly question?: true }
  | { readonly type: 'claimed'; readonly userId: string; readonly until: string }
  | { readonly type: 'renewed'; readonly until: string }
  | { readonly type: 'ran'; readonly run: RunRecord }
  | { readonly type: 'erased'; readonly reason: string }
  | { readonly type: 'held'; readonly userId: string }
  | { readonly type: 'released'; readonly userId: string }
  | { readonly type: 'noted'; readonly text: string }
  | { readonly type: 'attached'; readonly fileId: string; readonly name: string; readonly size: number; readonly contentType: string }
  | { readonly type: 'linked'; readonly rel: LinkRel; readonly target: string }
  | { readonly type: 'unlinked'; readonly rel: LinkRel; readonly target: string };

export type EventType = EventData['type'];

/** What one agent run did on an item, as the run reports it. */
export interface RunRecord {
  readonly summary: string;
  /** Where the work can be checked: a commit, a release, a link, an item. */
  readonly proof: readonly string[];
  /** What the next run must know. */
  readonly handoff?: string;
  readonly seconds?: number;
  /** What the run cost, as its runtime reported it. */
  readonly cost?: { readonly amount: number; readonly currency: string; readonly tokens?: number };
}

/** The longest run summary and handoff note; a longer account is a file on the item. */
export const RUN_TEXT_MAX = 2_000;
/** How long a claim lasts unless the claimant renews it. */
export const CLAIM_MINUTES = 20;

export interface ItemEvent {
  readonly position: number;
  readonly id: string;
  readonly itemId: string;
  readonly at: string;
  readonly data: EventData;
}

/** The longest note; a longer text is a file on the item. */
export const NOTE_MAX = 4_000;
/** The longest text label. */
export const LABEL_TEXT_MAX = 200;
export const TITLE_MAX = 200;

/** Folds one event into the state before it; `undefined` before the first event. */
export function fold(before: ItemState | undefined, e: ItemEvent, orgId: string): ItemState {
  const d = e.data;
  if (d.type === 'created') {
    if (before) throw new Error(`item ${e.itemId} is created twice`);
    return {
      id: e.itemId,
      orgId,
      kindId: d.kindId,
      workspaceId: d.workspaceId,
      number: d.number,
      key: d.key,
      ref: d.ref,
      title: d.title,
      state: d.state,
      class: d.class,
      askerId: d.askerId,
      holders: [],
      claim: null,
      labels: d.labels,
      revision: d.revision,
      bodyId: d.bodyId,
      links: [],
      position: e.position,
      events: 1,
      notes: 0,
      files: 0,
      runs: 0,
      stateSince: e.at,
      createdAt: e.at,
      updatedAt: e.at,
    };
  }
  if (!before) throw new Error(`event ${e.id} comes before item ${e.itemId} was created`);
  const s = { ...before, position: e.position, events: before.events + 1, updatedAt: e.at };
  switch (d.type) {
    case 'changed': {
      const labels: Record<string, LabelValue> = { ...before.labels };
      for (const [k, v] of Object.entries(d.labels ?? {})) {
        if (v === null) delete labels[k];
        else labels[k] = v;
      }
      return { ...s, ...(d.title !== undefined ? { title: d.title } : {}), labels, ...(d.revision !== undefined ? { revision: d.revision } : {}), ...(d.bodyId !== undefined ? { bodyId: d.bodyId } : {}) };
    }
    case 'moved':
      return { ...s, state: d.to, class: d.class, stateSince: e.at, ...(d.revision !== undefined ? { revision: d.revision } : {}), notes: before.notes + (d.note ? 1 : 0) };
    case 'held':
      return before.holders.includes(d.userId) ? s : { ...s, holders: [...before.holders, d.userId] };
    case 'released':
      return { ...s, holders: before.holders.filter((h) => h !== d.userId), claim: before.claim?.userId === d.userId ? null : before.claim };
    case 'claimed':
      return { ...s, holders: before.holders.includes(d.userId) ? before.holders : [...before.holders, d.userId], claim: { userId: d.userId, until: d.until } };
    case 'renewed':
      return { ...s, claim: before.claim ? { ...before.claim, until: d.until } : null };
    case 'ran':
      return { ...s, runs: before.runs + 1 };
    case 'erased':
      return { ...s, title: ERASED, labels: {}, ref: null, revision: null, bodyId: null };
    case 'noted':
      return { ...s, notes: before.notes + 1 };
    case 'attached':
      return { ...s, files: before.files + 1 };
    case 'linked':
      return before.links.some((l) => l.rel === d.rel && l.target === d.target) ? s : { ...s, links: [...before.links, { rel: d.rel, target: d.target }] };
    case 'unlinked':
      return { ...s, links: before.links.filter((l) => !(l.rel === d.rel && l.target === d.target)) };
  }
}

export const ERASED = '(erased)';

/**
 * An event with what it said blanked, for a hard delete (docs/decisions/3006):
 * every value a person wrote goes, and what the history needs to keep its
 * order and fold (types, states, who, when) stays.
 */
export function blank(d: EventData): EventData {
  switch (d.type) {
    case 'created':
      return { ...d, title: ERASED, labels: {}, ref: null, revision: null, bodyId: null };
    case 'changed':
      return { type: 'changed', ...(d.title !== undefined ? { title: ERASED } : {}), ...(d.labels ? { labels: Object.fromEntries(Object.keys(d.labels).map((k) => [k, null])) } : {}) };
    case 'moved': {
      const { note: _note, revision: _revision, ...rest } = d;
      return rest;
    }
    case 'noted':
      return { type: 'noted', text: '' };
    case 'attached':
      return { ...d, name: ERASED };
    case 'ran':
      return { type: 'ran', run: { summary: '', proof: [] } };
    default:
      return d;
  }
}

/** The item a log folds to. */
export function replay(events: readonly ItemEvent[], orgId: string): ItemState | undefined {
  return events.reduce<ItemState | undefined>((s, e) => fold(s, e, orgId), undefined);
}

/** The one item a `part-of` link names, as an item's parent. */
export function parentOf(s: Pick<ItemState, 'links'>): string | null {
  return s.links.find((l) => l.rel === 'part-of')?.target ?? null;
}

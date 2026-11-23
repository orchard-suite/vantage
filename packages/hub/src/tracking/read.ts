/**
 * The verbs that read (VAN-5001): get, find, changes, describe.
 * An item reads as a card of a fixed size; its notes, history, links, and
 * files are parts read in pages. A list is asked for by field and by page,
 * filled after the access check in its own query, and answers its total.
 */
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { maybe } from '../db/db.ts';
import { badRequest } from '../http.ts';
import { kindByPrefix, kindsIn, stateOf, type KindRow } from './kinds.ts';
import { membersOf, moveText, openMoves } from './gate.ts';
import { findItem, reachOf, visibleWhere, type Found, type Reach } from './access.ts';
import { linkText } from './links.ts';
import { isWorked, readProof, type Proof } from './worked.ts';
import type { EventData, ItemState, LabelValue, LinkRel } from './state.ts';

export interface Card {
  readonly key: string;
  readonly kind: string;
  readonly kindName: string;
  readonly title: string;
  readonly state: string;
  readonly stateText: string;
  readonly class: ItemState['class'];
  readonly since: string;
  readonly asker: string | null;
  readonly holders: readonly string[];
  readonly labels: Readonly<Record<string, LabelValue>>;
  readonly ref: string | null;
  readonly revision: string | null;
  readonly parent: string | null;
  readonly counts: { readonly notes: number; readonly files: number; readonly links: number; readonly events: number };
  /** The moves open to this caller now, each as `label → state (needs …)`. */
  readonly moves: readonly string[];
  /** The item's version: the position of its last event. */
  readonly version: number;
  readonly hasBody: boolean;
  /** For a kind the hub moves from its proof: what the proof says, and how old it is. */
  readonly proof?: string;
  /** Who claims it and until when, while the claim holds. */
  readonly claim?: string;
  readonly runs: number;
}

/** A worked item's proof in one line: its pieces by state, and the age of the newest. */
export function proofText(p: Proof): string {
  if (!p.items.length && !p.boxes.length) return 'none named; name parts or proof, or it can only be reported done';
  const byClass = (c: string): number => p.items.filter((i) => i.class === c).length;
  const parts = p.items.length ? `${p.items.length} item${p.items.length === 1 ? '' : 's'} (${[['done', 'done'], ['in-progress', 'under way'], ['not-started', 'not started'], ['parked', 'parked']].flatMap(([c, w]) => (byClass(c!) ? [`${byClass(c!)} ${w}`] : [])).join(', ')})` : '';
  const seen = p.boxes.filter((b) => b.seen === true).length;
  const unread = p.boxes.filter((b) => b.seen === 'unread').length;
  const boxes = p.boxes.length ? `${p.boxes.length} box${p.boxes.length === 1 ? '' : 'es'} (${seen} seen${unread ? `, ${unread} bound to nothing a connector reads` : ''})` : '';
  return `${[parts, boxes].filter(Boolean).join(', ')}; newest ${p.at ? p.at.slice(0, 10) : 'never'}`;
}

async function people(ctx: AppContext, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const rows = await ctx.db.query<{ id: string; label: string }>("select id, coalesce(email, display_name, subject) as label from users where id = any($1::text[])", [want]);
  return new Map(rows.map((r) => [r.id, r.label]));
}

export async function cardOf(ctx: AppContext, f: Found): Promise<Card> {
  const { item, kind } = f;
  const def = kind.definition;
  const who = await people(ctx, [item.askerId, ...item.holders]);
  const parentId = item.links.find((l) => l.rel === 'part-of')?.target;
  const members = await membersOf(ctx.db, item.orgId, def);
  return {
    key: item.key,
    kind: kind.prefix,
    kindName: kind.name,
    title: item.title,
    state: item.state,
    stateText: stateOf(def, item.state)?.text ?? item.state,
    class: item.class,
    since: item.stateSince.slice(0, 10),
    asker: item.askerId ? (who.get(item.askerId) ?? 'a person') : null,
    holders: item.holders.map((h) => who.get(h) ?? 'a person'),
    labels: item.labels,
    ref: item.ref,
    revision: item.revision,
    parent: parentId ? await linkText(ctx, 'part-of', parentId) : null,
    counts: { notes: item.notes, files: item.files, links: item.links.length, events: item.events },
    moves: openMoves(def, item, f.caller, members).map(moveText),
    version: item.position,
    hasBody: !def.owner,
    ...(isWorked(def) ? { proof: proofText(await readProof(ctx.db, item)) } : {}),
    ...(item.claim && Date.parse(item.claim.until) > Date.now() ? { claim: `${(await people(ctx, [item.claim.userId])).get(item.claim.userId) ?? 'a person'} until ${item.claim.until.slice(0, 16).replace('T', ' ')} UTC` } : {}),
    runs: item.runs,
  };
}

export async function bodyOf(ctx: AppContext, item: Pick<ItemState, 'bodyId'>): Promise<string> {
  if (!item.bodyId) return '';
  return (await maybe<{ text: string }>(ctx.db, 'select text from item_bodies where id = $1', [item.bodyId]))?.text ?? '';
}

/** One or many items by key, as cards. An item the caller holds at `held` answers as unchanged. */
export async function get(ctx: AppContext, p: Principal, refs: readonly string[], held: Readonly<Record<string, number>> = {}): Promise<({ card: Card } | { key: string; unchanged: number } | { key: string; error: string })[]> {
  if (refs.length > 50) throw badRequest('get reads at most 50 items in one call');
  const reach = await reachOf(ctx, p);
  const out: ({ card: Card } | { key: string; unchanged: number } | { key: string; error: string })[] = [];
  for (const ref of refs) {
    try {
      const f = await findItem(ctx, p, ref, reach);
      if (held[ref] === f.item.position) out.push({ key: f.item.key, unchanged: f.item.position });
      else out.push({ card: await cardOf(ctx, f) });
    } catch (err) {
      out.push({ key: ref, error: (err as Error).message });
    }
  }
  return out;
}

export interface FindQuery {
  readonly kinds?: readonly string[];
  readonly state?: string;
  readonly class?: ItemState['class'];
  /** `me`, or a person's email. */
  readonly holder?: string;
  readonly asker?: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly parent?: string;
  /** Words in the title, the labels, or the body. */
  readonly q?: string;
  readonly limit?: number;
  readonly offset?: number;
  /** Answer counts by this field instead of rows. */
  readonly countBy?: 'state' | 'class' | 'kind' | 'holder';
}

export interface Row {
  readonly key: string;
  readonly title: string;
  readonly state: string;
  readonly class: ItemState['class'];
  readonly holders: readonly string[];
  readonly labels: Readonly<Record<string, LabelValue>>;
  readonly updated: string;
  /** When the newest of its parts and the items it names as proof last moved; absent when it has none. */
  readonly proofAt?: string;
}

export const FIND_LIMIT = 100;

/** Lists or counts the items the caller may see that match. A page never holds a row the caller may not see. */
export async function find(ctx: AppContext, p: Principal, q: FindQuery, r?: Reach): Promise<{ rows: Row[]; total: number; counts?: Record<string, number>; others?: number }> {
  const reach = r ?? (await reachOf(ctx, p));
  const params: unknown[] = [p.orgId];
  const where = ['i.org_id = $1'];
  const add = (sql: (n: number) => string, v: unknown): void => {
    params.push(v);
    where.push(sql(params.length));
  };
  if (q.kinds?.length) add((n) => `k.prefix = any($${n}::text[])`, q.kinds.map((k) => k.toUpperCase()));
  if (q.state) add((n) => `i.state = $${n}`, q.state);
  if (q.class) add((n) => `i.class = $${n}`, q.class);
  for (const [field, who] of [['holders', q.holder], ['asker_id', q.asker]] as const) {
    if (!who) continue;
    const id = who === 'me' ? p.userId : (await maybe<{ id: string }>(ctx.db, 'select id from users where org_id = $1 and lower(email) = lower($2)', [p.orgId, who]))?.id ?? '-';
    if (field === 'holders') add((n) => `i.holders ? $${n}`, id);
    else add((n) => `i.asker_id = $${n}`, id);
  }
  for (const [name, value] of Object.entries(q.labels ?? {})) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw badRequest(`${name} is not a label name`);
    add((n) => `i.labels ->> '${name}' = $${n}`, value);
  }
  if (q.parent) {
    const parent = await findItem(ctx, p, q.parent, reach);
    add((n) => `i.parent_id = $${n}`, parent.item.id);
  }
  if (q.q?.trim()) add((n) => `i.search @@ plainto_tsquery('english', $${n})`, q.q.trim());
  const vis = visibleWhere(reach, params.length + 1);
  params.push(...vis.params);
  where.push(vis.sql);
  const from = `from items i join item_kinds k on k.id = i.kind_id where ${where.join(' and ')}`;
  const total = Number((await ctx.dbRead.query<{ n: number }>(`select count(*)::int as n ${from}`, params))[0]?.n ?? 0);
  if (q.countBy) {
    const col = { state: 'i.state', class: 'i.class', kind: 'k.prefix', holder: "coalesce(i.holders ->> 0, 'nobody')" }[q.countBy];
    // A count answers its largest groups, never more than a page of them; the rest are counted as one.
    const grouped = await ctx.dbRead.query<{ v: string; n: number }>(`select ${col} as v, count(*)::int as n ${from} group by 1 order by 2 desc, 1 limit ${FIND_LIMIT + 1}`, params);
    const rows = grouped.slice(0, FIND_LIMIT);
    const holders = q.countBy === 'holder' ? await people(ctx, rows.map((x) => x.v)) : new Map<string, string>();
    const counts = Object.fromEntries(rows.map((x) => [holders.get(x.v) ?? x.v, Number(x.n)]));
    const counted = rows.reduce((sum, x) => sum + Number(x.n), 0);
    return { rows: [], total, counts, ...(grouped.length > FIND_LIMIT ? { others: total - counted } : {}) };
  }
  const limit = Math.min(Math.max(1, q.limit ?? 20), FIND_LIMIT);
  const rows = await ctx.dbRead.query<{ key: string; title: string; state: string; class: ItemState['class']; holders: string[]; labels: Record<string, LabelValue>; updated_at: Date; proof_at: Date | null }>(
    `select i.key, i.title, i.state, i.class, i.holders, i.labels, i.updated_at,
            (select max(c.state_since) from items c where c.parent_id = i.id or c.id in (select l.target from item_links l where l.item_id = i.id and l.rel = 'proof')) as proof_at
       ${from} order by i.updated_at desc, i.key limit ${limit} offset ${Math.max(0, q.offset ?? 0)}`,
    params,
  );
  const who = await people(ctx, rows.flatMap((x) => x.holders));
  return { rows: rows.map((x) => ({ key: x.key, title: x.title, state: x.state, class: x.class, holders: x.holders.map((h) => who.get(h) ?? 'a person'), labels: x.labels, updated: new Date(x.updated_at).toISOString().slice(0, 10), ...(x.proof_at ? { proofAt: new Date(x.proof_at).toISOString().slice(0, 10) } : {}) })), total };
}

export interface Change {
  readonly position: number;
  readonly item: string;
  readonly kind: string;
  readonly type: EventData['type'];
  readonly at: string;
  readonly actor: string | null;
  readonly actorKind: string;
  readonly surface: string;
  readonly data: EventData;
}

export const CHANGES_LIMIT = 500;

/** Everything that changed after a position, in order, on items the caller may see. A reader carries on from the last position it got. */
export async function changes(ctx: AppContext, p: Principal, opts: { after?: number; limit?: number; kinds?: readonly string[] }): Promise<{ changes: Change[]; next: number }> {
  const reach = await reachOf(ctx, p);
  const params: unknown[] = [p.orgId, Math.max(0, opts.after ?? 0)];
  let kinds = '';
  if (opts.kinds?.length) {
    params.push(opts.kinds.map((k) => k.toUpperCase()));
    kinds = ` and k.prefix = any($${params.length}::text[])`;
  }
  const vis = visibleWhere(reach, params.length + 1);
  params.push(...vis.params);
  const limit = Math.min(Math.max(1, opts.limit ?? 100), CHANGES_LIMIT);
  // The feed reads the primary: a reader that saw a position must never miss an event a replica has not caught up to.
  const rows = await ctx.db.query<{ position: string; key: string; prefix: string; type: EventData['type']; at: Date; actor_id: string | null; actor_kind: string; surface: string; data: EventData }>(
    `select e.position, i.key, k.prefix, e.type, e.at, e.actor_id, e.actor_kind, e.surface, e.data from item_events e join items i on i.id = e.item_id join item_kinds k on k.id = i.kind_id where e.org_id = $1 and e.position > $2${kinds} and ${vis.sql} order by e.position limit ${limit}`,
    params,
  );
  const who = await people(ctx, rows.map((x) => x.actor_id));
  const out = rows.map((x) => ({ position: Number(x.position), item: x.key, kind: x.prefix, type: x.type, at: new Date(x.at).toISOString(), actor: x.actor_id ? (who.get(x.actor_id) ?? 'a person') : null, actorKind: x.actor_kind, surface: x.surface, data: x.data }));
  return { changes: out, next: out.length ? out[out.length - 1]!.position : Math.max(0, opts.after ?? 0) };
}

/** One line of an event, for an item's history. */
export function eventLine(c: Pick<Change, 'type' | 'data' | 'actor' | 'at'>): string {
  const d = c.data;
  const what = (() => {
    switch (d.type) {
      case 'created':
        return `created in ${d.state}`;
      case 'changed':
        return `changed ${[d.title !== undefined ? 'title' : '', d.labels ? `labels ${Object.keys(d.labels).join(', ')}` : '', d.revision !== undefined ? `revision ${d.revision}` : '', d.bodyId ? 'body' : ''].filter(Boolean).join(', ')}`;
      case 'moved':
        return `${d.question ? 'asked' : 'moved'} ${d.from} → ${d.to}${d.note ? `: ${d.note.split('\n')[0]!.slice(0, 160)}` : ''}`;
      case 'held':
        return 'held';
      case 'released':
        return 'released';
      case 'noted':
        return `noted: ${d.text.split('\n')[0]!.slice(0, 160)}`;
      case 'attached':
        return `attached ${d.name}`;
      case 'linked':
        return `linked ${d.rel}`;
      case 'unlinked':
        return `unlinked ${d.rel}`;
      case 'claimed':
        return `claimed until ${d.until.slice(11, 16)} UTC`;
      case 'renewed':
        return `renewed the claim until ${d.until.slice(11, 16)} UTC`;
      case 'ran':
        return `ran: ${d.run.summary.split('\n')[0]!.slice(0, 160)}`;
      case 'erased':
        return `erased: ${d.reason.split('\n')[0]!.slice(0, 160)}`;
    }
  })();
  return `${c.at.slice(0, 16).replace('T', ' ')} UTC ${c.actor ?? 'the hub'}: ${what}`;
}

export const PART_PAGE = 20;

/** An item's history, newest first, a page at a time. */
export async function history(ctx: AppContext, f: Found, opts: { before?: number; limit?: number } = {}): Promise<{ lines: string[]; total: number; next?: number }> {
  const limit = Math.min(Math.max(1, opts.limit ?? PART_PAGE), 100);
  const rows = await ctx.db.query<{ position: string; type: EventData['type']; at: Date; actor_id: string | null; data: EventData }>(
    `select position, type, at, actor_id, data from item_events where item_id = $1${opts.before ? ' and position < $2' : ''} order by position desc limit ${limit}`,
    opts.before ? [f.item.id, opts.before] : [f.item.id],
  );
  const who = await people(ctx, rows.map((x) => x.actor_id));
  const lines = rows.map((x) => eventLine({ type: x.type, data: x.data, actor: x.actor_id ? (who.get(x.actor_id) ?? 'a person') : null, at: new Date(x.at).toISOString() }));
  const last = rows[rows.length - 1];
  return { lines, total: f.item.events, ...(rows.length === limit && last ? { next: Number(last.position) } : {}) };
}

/** An item's notes, newest first: the notes and the notes a move carried. */
export async function notes(ctx: AppContext, f: Found, opts: { before?: number; limit?: number } = {}): Promise<{ lines: string[]; total: number; next?: number }> {
  const limit = Math.min(Math.max(1, opts.limit ?? PART_PAGE), 100);
  const rows = await ctx.db.query<{ position: string; at: Date; actor_id: string | null; data: EventData }>(
    `select position, at, actor_id, data from item_events where item_id = $1 and (type = 'noted' or (type = 'moved' and data ? 'note'))${opts.before ? ' and position < $2' : ''} order by position desc limit ${limit}`,
    opts.before ? [f.item.id, opts.before] : [f.item.id],
  );
  const who = await people(ctx, rows.map((x) => x.actor_id));
  const lines = rows.map((x) => {
    const d = x.data;
    const text = d.type === 'noted' ? d.text : d.type === 'moved' ? `(moving ${d.from} → ${d.to}) ${d.note ?? ''}` : '';
    return `### ${new Date(x.at).toISOString().slice(0, 16).replace('T', ' ')} UTC ${x.actor_id ? (who.get(x.actor_id) ?? 'a person') : 'the hub'}\n\n${text}`;
  });
  const last = rows[rows.length - 1];
  return { lines, total: f.item.notes, ...(rows.length === limit && last ? { next: Number(last.position) } : {}) };
}

export async function linksOf(ctx: AppContext, f: Found): Promise<string[]> {
  return Promise.all(f.item.links.map(async (l) => `${l.rel}: ${await linkText(ctx, l.rel as LinkRel, l.target)}`));
}

export async function filesOf(ctx: AppContext, f: Found): Promise<{ id: string; name: string; size: number; contentType: string }[]> {
  return ctx.db.query('select id, name, size, content_type as "contentType" from item_files where item_id = $1 order by created_at', [f.item.id]);
}

/** A kind's states and labels, with a live count of items in each state the caller may see. */
export async function describeKind(ctx: AppContext, p: Principal, prefix: string): Promise<{ kind: KindRow; counts: Record<string, number> }> {
  const kind = await kindByPrefix(ctx.db, p.orgId, prefix);
  const reach = await reachOf(ctx, p);
  if (!kind) throw badRequest(`no kind ${prefix}`);
  const counts = (await find(ctx, p, { kinds: [kind.prefix], countBy: 'state' }, reach)).counts ?? {};
  if (!reach.roles.has(kind.workspace_id) && !Object.keys(counts).length) throw badRequest(`no kind ${prefix}`);
  return { kind, counts };
}

/** The kinds in the workspaces the caller may open. */
export async function kindsFor(ctx: AppContext, p: Principal): Promise<KindRow[]> {
  const reach = await reachOf(ctx, p);
  return kindsIn(ctx.db, p.orgId, [...reach.roles.keys()]);
}

/** One item's part in a document's plan: what it does to which boxes and views, and where it stands. */
export interface PlanEntry {
  readonly key: string;
  readonly title: string;
  readonly state: string;
  readonly stateText: string;
  readonly class: ItemState['class'];
  readonly horizon: string | null;
  readonly workspace: string;
  readonly effects: readonly { readonly rel: 'adds' | 'changes' | 'retires'; readonly id: string }[];
}

/** The items the caller may see that add, change, or retire a box or a view of this document. */
export async function planOf(ctx: AppContext, p: Principal, documentId: string): Promise<PlanEntry[]> {
  const reach = await reachOf(ctx, p);
  const vis = visibleWhere(reach, 3);
  const rows = await ctx.dbRead.query<{ key: string; title: string; state: string; class: ItemState['class']; labels: Record<string, LabelValue>; kind_id: string; slug: string; rel: 'adds' | 'changes' | 'retires'; target: string }>(
    `select i.key, i.title, i.state, i.class, i.labels, i.kind_id, w.slug, l.rel, l.target
       from item_links l join items i on i.id = l.item_id join workspaces w on w.id = i.workspace_id
      where i.org_id = $1 and l.rel in ('adds', 'changes', 'retires') and l.target like $2 and ${vis.sql}
      order by i.key, l.rel, l.target`,
    [p.orgId, `${documentId}#%`, ...vis.params],
  );
  const kinds = new Map<string, KindRow>();
  const out = new Map<string, PlanEntry & { effects: { rel: 'adds' | 'changes' | 'retires'; id: string }[] }>();
  for (const r of rows) {
    if (!kinds.has(r.kind_id)) kinds.set(r.kind_id, (await ctx.db.query<KindRow>('select * from item_kinds where id = $1', [r.kind_id]))[0]!);
    const def = kinds.get(r.kind_id)!.definition;
    const e = out.get(r.key) ?? { key: r.key, title: r.title, state: r.state, stateText: stateOf(def, r.state)?.text ?? r.state, class: r.class, horizon: typeof r.labels['horizon'] === 'string' ? (r.labels['horizon'] as string) : null, workspace: r.slug, effects: [] };
    e.effects.push({ rel: r.rel, id: r.target.slice(r.target.indexOf('#') + 1) });
    out.set(r.key, e);
  }
  return [...out.values()];
}

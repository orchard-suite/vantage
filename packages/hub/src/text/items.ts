/**
 * Kinds and items in the text space. A kind's prefix outlines its items as
 * rows; an item reads as its card and body, and its notes, history, links,
 * and files are parts read a page at a time. Write makes an item at a
 * kind's prefix; patch and write change its title, labels, parent, owner, scope, and body
 * through the same put every other door calls.
 */
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { randomId } from '../crypto.ts';
import { HttpError, badRequest } from '../http.ts';
import { headingOutline } from '@vantage/mcp';
import { kindByPrefix, type KindDef } from '../tracking/kinds.ts';
import { horizonOf } from '../tracking/rank.ts';
import { spanText } from '../tracking/dates.ts';
import { dueText, readsDue, type DueFilter } from '../tracking/due.ts';
import { rollupText } from '../tracking/milestone.ts';
import { findItem } from '../tracking/access.ts';
import { bodyOf, cardOf, describeKind, filesOf, kindsFor, find as findItems, history, linksOf, notes, type Row } from '../tracking/read.ts';
import { put } from '../tracking/write.ts';
import type { Address } from './address.ts';
import { itemTemplate, itemText, parseItemText, refuseFixed } from './item-text.ts';
import type { TextThing } from './things.ts';
import { itemLink, workspaceSlug } from './links.ts';

const n = (x: number): string => x.toLocaleString('en-US');

/** Turns a prefix or a key the hub knows as a kind's into a kind or an item address. */
export async function placeAddress(ctx: AppContext, p: Principal, a: Address): Promise<Address> {
  if (a.kind === 'registry' && (await kindByPrefix(ctx.db, p.orgId, a.prefix))) return { kind: 'kind', prefix: a.prefix, ...(a.part !== undefined ? { part: a.part } : {}) };
  if (a.kind === 'record' && !a.ref.startsWith('adr:')) {
    const prefix = a.ref.slice(0, a.ref.lastIndexOf('-'));
    if (await kindByPrefix(ctx.db, p.orgId, prefix)) return { kind: 'item', key: a.ref, ...(a.part !== undefined ? { part: a.part } : {}) };
  }
  return a;
}

/** An item's whole text, with its position as its version. */
export async function itemThing(ctx: AppContext, p: Principal, key: string): Promise<TextThing> {
  const f = await findItem(ctx, p, key);
  const card = await cardOf(ctx, f);
  return { address: f.item.key, version: String(f.item.position), text: itemText(card, await bodyOf(ctx, f.item)), kind: 'markdown', link: itemLink(ctx, await workspaceSlug(ctx, f.item.workspaceId), f.item.key) };
}

const PARTS = ['notes', 'history', 'links', 'files'] as const;

/** A part of an item that is not a run of its text: its notes, history, links, or files, a page at a time. `history<120` reads on before position 120. */
export async function itemPart(ctx: AppContext, p: Principal, key: string, part: string): Promise<string | undefined> {
  const m = /^(notes|history|links|files)(?:<(\d+))?$/.exec(part);
  if (!m) return undefined;
  const f = await findItem(ctx, p, key);
  const before = m[2] ? Number(m[2]) : undefined;
  switch (m[1] as (typeof PARTS)[number]) {
    case 'notes': {
      const r = await notes(ctx, f, before ? { before } : {});
      return [`${f.item.key} notes: ${r.total}, newest first`, ...r.lines, ...(r.next ? [`more: vantage_read ${f.item.key}#notes<${r.next}`] : [])].join('\n\n');
    }
    case 'history': {
      const r = await history(ctx, f, before ? { before } : {});
      return [`${f.item.key} history: ${r.total} events, newest first`, ...r.lines, ...(r.next ? [`more: vantage_read ${f.item.key}#history<${r.next}`] : [])].join('\n');
    }
    case 'links': {
      const lines = await linksOf(ctx, f);
      return [`${f.item.key} links: ${lines.length}`, ...lines].join('\n');
    }
    case 'files': {
      const files = await filesOf(ctx, f);
      return [`${f.item.key} files: ${files.length}`, ...files.map((x) => `${x.name}  ${x.contentType}  ${n(x.size)} bytes  ${ctx.config.PUBLIC_URL}/api/v1/items/${f.item.key}/files/${x.id}`)].join('\n');
    }
  }
}

const rowLine = (r: Row): string => `  ${r.key}  ${r.state}  ${r.title}${r.owner ? `  owner ${r.owner}` : ''}${r.holders.length ? `  held by ${r.holders.join(', ')}` : ''}${r.run ? `  working: ${r.run}` : ''}${r.proofAt ? `  proof ${r.proofAt}` : ''}${Object.keys(r.labels).length ? `  ${Object.entries(r.labels).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''}${r.span ? `  span ${r.span.start ?? '?'}..${r.span.end ?? '?'}` : ''}${r.due?.overdue ? '  OVERDUE' : r.due?.soon ? '  due soon' : ''}`;

/** The order a kind's rows come in, in words, as `find` sorts one kind. */
function orderWords(def: KindDef): string {
  return horizonOf(def) ? 'by horizon, then in their place, then newest first' : 'in their place, then newest first';
}

/** The parts of a kind's outline that list its items by their due date, for a kind that reads one. */
const DUE_PARTS: Readonly<Record<string, DueFilter>> = { overdue: 'overdue', 'due-soon': 'soon' };

/** A kind's outline: its states with live counts, its labels, how many are overdue and due soon, and its items as rows in the kind's order. A part names a state, a class, a label choice, or overdue or due-soon. */
export async function kindOutline(ctx: AppContext, p: Principal, prefix: string, part: string | undefined): Promise<string> {
  const { kind, counts } = await describeKind(ctx, p, prefix);
  const def = kind.definition;
  const within = (await kindsFor(ctx, p)).filter((k) => k.prefix !== kind.prefix && k.definition.parts.includes(kind.prefix)).map((k) => k.prefix);
  const filter: { state?: string; class?: (typeof def.states)[number]['class']; labels?: Record<string, string>; due?: DueFilter } = {};
  const dated = readsDue(def);
  if (part !== undefined) {
    const cls = def.states.find((s) => s.class === part)?.class;
    const choice = def.labels.find((l) => l.type === 'choice' && l.choices?.includes(part));
    if (def.states.some((s) => s.id === part)) filter.state = part;
    else if (cls) filter.class = cls;
    else if (choice) filter.labels = { [choice.name]: part };
    else if (dated && DUE_PARTS[part]) filter.due = DUE_PARTS[part];
    else throw badRequest(`${kind.prefix} has no state, class, or label choice ${part}${dated ? ', and it is not overdue or due-soon' : ''}; its states: ${def.states.map((s) => s.id).join(', ')}${def.labels.some((l) => l.choices) ? `; its choices: ${def.labels.flatMap((l) => l.choices ?? []).join(', ')}` : ''}`);
  }
  const total = Object.values(counts).reduce((s, x) => s + x, 0);
  const lines = [
    `${kind.prefix}: ${kind.name}  ${n(total)} item${total === 1 ? '' : 's'}${def.owner ? `, kept by ${def.owner}` : ''}`,
    `states: ${def.states.map((s) => `${s.id} (${s.class}) ${counts[s.id] ?? 0}`).join(', ')}`,
    `moves: ${def.moves.map((m) => `${m.from}→${m.to}${m.label ? ` ${m.label}` : ''}${(m.who ?? []).length ? ` [${m.who!.join(', ')}]` : ''}${(m.needs ?? []).length ? ` needs ${m.needs!.join(', ')}` : ''}`).join('; ')}`,
    ...(def.labels.length ? [`labels: ${def.labels.map((l) => `${l.name} (${l.type}${l.choices ? `: ${l.choices.join(', ')}` : ''})`).join(', ')}`] : []),
    ...(Object.keys(def.roles).length ? [`roles: ${Object.entries(def.roles).map(([r, w]) => `${r} = ${w.join(', ')}`).join('; ')}`] : []),
    ...(def.parts.length ? [`parts may be: ${def.parts.join(', ')}`] : []),
    ...(within.length ? [`part of: ${within.join(', ')}`] : []),
    ...(dated ? [`due: ${n((await findItems(ctx, p, { kinds: [kind.prefix], due: 'overdue', limit: 1 })).total)} overdue (${kind.prefix}#overdue), ${n((await findItems(ctx, p, { kinds: [kind.prefix], due: 'soon', limit: 1 })).total)} due within ${ctx.config.DUE_SOON_DAYS} days (${kind.prefix}#due-soon)`] : []),
  ];
  const page = await findItems(ctx, p, { kinds: [kind.prefix], ...filter, limit: 40 });
  lines.push('', `items${part ? ` in ${part}` : ''}, ${orderWords(def)} (${n(page.total)}):`, ...page.rows.map(rowLine));
  if (page.total > page.rows.length) lines.push(`  ${n(page.total - page.rows.length)} more. more: vantage_outline ${kind.prefix}#<state>, or vantage_find with in: ${kind.prefix}`);
  if (!part) lines.push('', `A new item: vantage_write to ${kind.prefix} with this text, filled in:`, itemTemplate(def.labels, !def.owner));
  return lines.join('\n');
}

/** An item's outline: its card's fields, its body's headings, and the parts with their sizes. */
export async function itemOutline(ctx: AppContext, p: Principal, key: string): Promise<string> {
  const f = await findItem(ctx, p, key);
  const c = await cardOf(ctx, f);
  const body = await bodyOf(ctx, f.item);
  const hs = c.hasBody ? headingOutline(body) : [];
  return [
    `${c.key}: ${c.title}  version ${c.version}  ${c.kind} ${c.kindName}`,
    `${c.state} (${c.stateText}) since ${c.since}; asked by ${c.asker ?? 'nobody'}; owner ${c.owner ?? 'none'}; held by ${c.holders.join(', ') || 'nobody'}`,
    ...(c.delegated ? [`delegated ${c.delegated}`] : []),
    ...(c.claim ? [`working now: ${c.claim}`] : []),
    `moves open to you: ${c.moves.join('; ') || 'none'}`,
    ...(c.span ? [`span: ${spanText(c.span)}`] : []),
    ...(c.due ? [`due: ${dueText(c.due)}`] : []),
    ...(c.milestone ? [`milestone: ${rollupText(c.milestone)}`] : []),
    `link: ${itemLink(ctx, await workspaceSlug(ctx, f.item.workspaceId), c.key)}`,
    ...(c.hasBody ? [`body: ${n(body.length)} chars${hs.length ? '' : ', no headings'}`, ...hs] : []),
    `parts: ${c.key}#notes ${c.counts.notes}, #history ${c.counts.events}, #links ${c.counts.links}, #files ${c.counts.files}`,
  ].join('\n');
}

/** The things a find looks through in a kind: every item the caller may see, up to a cap, picked by the search index past it. */
export async function itemHays(ctx: AppContext, p: Principal, prefix: string, query: string): Promise<{ hays: { address: string; text: string; first: number; link?: string }[]; picked?: string }> {
  const all = await findItems(ctx, p, { kinds: [prefix], limit: 1 });
  const cap = 60;
  const rows = all.total <= cap ? await findItems(ctx, p, { kinds: [prefix], limit: cap }) : await findItems(ctx, p, { kinds: [prefix], q: query, limit: 12 });
  const hays = [];
  for (const r of rows.rows) {
    const t = await itemThing(ctx, p, r.key);
    hays.push({ address: t.address, text: t.text, first: 1, ...(t.link ? { link: t.link } : {}) });
  }
  return { hays, ...(all.total > cap ? { picked: `the ${rows.rows.length} best matching of ${all.total} items` } : {}) };
}

export interface ItemChange {
  readonly address: string;
  readonly status: 'saved' | 'created' | 'unchanged' | 'refused' | 'conflict';
  readonly version?: string;
  readonly message: string;
}

/** Writes an item's text: a new one at a kind's prefix, or a change to one, compared with the item as it stands. */
export async function commitItem(ctx: AppContext, p: Principal, target: { create: true; prefix: string } | { create: false; key: string }, text: string, base: string | undefined): Promise<ItemChange> {
  const key = randomId();
  const next = parseItemText(text);
  if (target.create) {
    const kind = await kindByPrefix(ctx.db, p.orgId, target.prefix);
    if (!kind) throw new HttpError(404, `no kind ${target.prefix}`);
    const r = await put(ctx, p, { kind: kind.prefix, ...(next.title !== undefined ? { title: next.title } : {}), labels: next.labels, ...(next.parent ? { parent: next.parent } : {}), ...(next.owner && next.owner !== 'none' ? { owner: next.owner } : {}), ...(next.scope ? { scope: next.scope } : {}), ...(kind.definition.owner ? {} : { body: next.body }) }, key);
    const v = await itemThing(ctx, p, r.key);
    return { address: r.key, status: 'created', version: v.version, message: `${r.line}. ${v.link ?? ''}` };
  }
  const current = await itemThing(ctx, p, target.key);
  if (base !== undefined && base !== current.version) return { address: current.address, status: 'conflict', version: current.version, message: `conflict: ${current.address} changed since version ${base}; it is version ${current.version} now. Read it again and patch the text as it stands` };
  if (text === current.text) return { address: current.address, status: 'unchanged', version: current.version, message: `unchanged: ${current.address}` };
  const before = parseItemText(current.text);
  refuseFixed(before, next, current.address);
  const labels: Record<string, string | number | null> = { ...next.labels };
  for (const k of Object.keys(before.labels)) if (!(k in next.labels)) labels[k] = null;
  const f = await findItem(ctx, p, current.address);
  const r = await put(
    ctx,
    p,
    {
      item: current.address,
      ...(next.title !== undefined && next.title !== before.title ? { title: next.title } : {}),
      labels,
      ...(next.parent !== undefined && next.parent !== before.parent ? { parent: next.parent } : {}),
      ...(next.owner !== before.owner ? { owner: next.owner === undefined || next.owner === 'none' ? null : next.owner } : {}),
      ...(next.scope !== before.scope ? { scope: next.scope ?? null } : {}),
      ...(!f.kind.definition.owner && next.body !== before.body ? { body: next.body } : {}),
    },
    key,
  );
  const v = await itemThing(ctx, p, current.address);
  return { address: current.address, status: r.status === 'unchanged' ? 'unchanged' : 'saved', version: v.version, message: r.line };
}

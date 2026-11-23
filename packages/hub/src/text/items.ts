/**
 * Kinds and items in the text space. A kind's prefix outlines its items as
 * rows; an item reads as its card and body, and its notes, history, links,
 * and files are parts read a page at a time. Write makes an item at a
 * kind's prefix; patch and write change its title, labels, parent, and body
 * through the same put every other door calls.
 */
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { randomId } from '../crypto.ts';
import { HttpError, badRequest } from '../http.ts';
import { headingOutline } from '@vantage/mcp';
import { kindByPrefix } from '../tracking/kinds.ts';
import { findItem } from '../tracking/access.ts';
import { bodyOf, cardOf, describeKind, filesOf, find as findItems, history, linksOf, notes, type Row } from '../tracking/read.ts';
import { put } from '../tracking/write.ts';
import type { Address } from './address.ts';
import { itemTemplate, itemText, parseItemText, refuseFixed } from './item-text.ts';
import type { TextThing } from './things.ts';

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
  return { address: f.item.key, version: String(f.item.position), text: itemText(card, await bodyOf(ctx, f.item)), kind: 'markdown' };
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

const rowLine = (r: Row): string => `  ${r.key}  ${r.state}  ${r.title}${r.holders.length ? `  held by ${r.holders.join(', ')}` : ''}${r.proofAt ? `  proof ${r.proofAt}` : ''}${Object.keys(r.labels).length ? `  ${Object.entries(r.labels).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''}`;

/** A kind's outline: its states with live counts, its labels, and its items as rows, newest first. A part names a state or a class. */
export async function kindOutline(ctx: AppContext, p: Principal, prefix: string, part: string | undefined): Promise<string> {
  const { kind, counts } = await describeKind(ctx, p, prefix);
  const def = kind.definition;
  const filter: { state?: string; class?: (typeof def.states)[number]['class']; labels?: Record<string, string> } = {};
  if (part !== undefined) {
    const cls = def.states.find((s) => s.class === part)?.class;
    const choice = def.labels.find((l) => l.type === 'choice' && l.choices?.includes(part));
    if (def.states.some((s) => s.id === part)) filter.state = part;
    else if (cls) filter.class = cls;
    else if (choice) filter.labels = { [choice.name]: part };
    else throw badRequest(`${kind.prefix} has no state, class, or label choice ${part}; its states: ${def.states.map((s) => s.id).join(', ')}${def.labels.some((l) => l.choices) ? `; its choices: ${def.labels.flatMap((l) => l.choices ?? []).join(', ')}` : ''}`);
  }
  const total = Object.values(counts).reduce((s, x) => s + x, 0);
  const lines = [
    `${kind.prefix}: ${kind.name}  ${n(total)} item${total === 1 ? '' : 's'}${def.owner ? `, kept by ${def.owner}` : ''}`,
    `states: ${def.states.map((s) => `${s.id} (${s.class}) ${counts[s.id] ?? 0}`).join(', ')}`,
    `moves: ${def.moves.map((m) => `${m.from}→${m.to}${m.label ? ` ${m.label}` : ''}${(m.who ?? []).length ? ` [${m.who!.join(', ')}]` : ''}${(m.needs ?? []).length ? ` needs ${m.needs!.join(', ')}` : ''}`).join('; ')}`,
    ...(def.labels.length ? [`labels: ${def.labels.map((l) => `${l.name} (${l.type}${l.choices ? `: ${l.choices.join(', ')}` : ''})`).join(', ')}`] : []),
    ...(Object.keys(def.roles).length ? [`roles: ${Object.entries(def.roles).map(([r, w]) => `${r} = ${w.join(', ')}`).join('; ')}`] : []),
    ...(def.parts.length ? [`parts may be: ${def.parts.join(', ')}`] : []),
  ];
  const page = await findItems(ctx, p, { kinds: [kind.prefix], ...filter, limit: 40 });
  lines.push('', `items${part ? ` in ${part}` : ''}, newest first (${n(page.total)}):`, ...page.rows.map(rowLine));
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
    `${c.state} (${c.stateText}) since ${c.since}; asked by ${c.asker ?? 'nobody'}; held by ${c.holders.join(', ') || 'nobody'}`,
    `moves open to you: ${c.moves.join('; ') || 'none'}`,
    `link: ${ctx.config.PUBLIC_URL}/w/${encodeURIComponent((await ctx.db.query<{ slug: string }>('select slug from workspaces where id = $1', [f.item.workspaceId]))[0]?.slug ?? '')}/work/${c.key}`,
    ...(c.hasBody ? [`body: ${n(body.length)} chars${hs.length ? '' : ', no headings'}`, ...hs] : []),
    `parts: ${c.key}#notes ${c.counts.notes}, #history ${c.counts.events}, #links ${c.counts.links}, #files ${c.counts.files}`,
  ].join('\n');
}

/** The things a find looks through in a kind: every item the caller may see, up to a cap, picked by the search index past it. */
export async function itemHays(ctx: AppContext, p: Principal, prefix: string, query: string): Promise<{ hays: { address: string; text: string; first: number }[]; picked?: string }> {
  const all = await findItems(ctx, p, { kinds: [prefix], limit: 1 });
  const cap = 60;
  const rows = all.total <= cap ? await findItems(ctx, p, { kinds: [prefix], limit: cap }) : await findItems(ctx, p, { kinds: [prefix], q: query, limit: 12 });
  const hays = [];
  for (const r of rows.rows) {
    const t = await itemThing(ctx, p, r.key);
    hays.push({ address: t.address, text: t.text, first: 1 });
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
    const r = await put(ctx, p, { kind: kind.prefix, ...(next.title !== undefined ? { title: next.title } : {}), labels: next.labels, ...(next.parent ? { parent: next.parent } : {}), ...(kind.definition.owner ? {} : { body: next.body }) }, key);
    const v = await itemThing(ctx, p, r.key);
    return { address: r.key, status: 'created', version: v.version, message: `${r.line}. ${ctx.config.PUBLIC_URL}/w/~/work/${r.key}` };
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
      ...(!f.kind.definition.owner && next.body !== before.body ? { body: next.body } : {}),
    },
    key,
  );
  const v = await itemThing(ctx, p, current.address);
  return { address: current.address, status: r.status === 'unchanged' ? 'unchanged' : 'saved', version: v.version, message: r.line };
}

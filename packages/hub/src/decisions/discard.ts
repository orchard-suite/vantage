/**
 * Discarding a record (VAN-3023): its writer takes back a record nothing
 * points to, and its number is free for the next record in its category.
 * Nothing points to it when no document or other record cites it, no
 * record names it in Related or in a supersede link, no item links it, no
 * old citation of it still resolves, and every revision of it is the
 * caller's. What it governs, its revisions, and its own citations go with
 * it. A record anything points to is refused with the list, and is retired
 * as before: deprecated or superseded. A dry run answers the same list and
 * writes nothing. The audit log keeps the record's whole text.
 */
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import type { Db } from '../db/db.ts';
import { accessibleWorkspaces } from '../authz.ts';
import { audit } from '../audit.ts';
import { badRequest, HttpError } from '../http.ts';
import { documentById } from '../documents/repo.ts';
import { recordText } from '../text/record-text.ts';
import { documentUrl } from './backlinks.ts';
import { present, recordUrl, requireDecision } from './read.ts';
import { aliasesOf, lockRegistry, placedById, placedByIds, refOf, type PlacedRow } from './repo.ts';
import { whoOf } from './write.ts';

export const DiscardSchema = z
  .object({
    dryRun: z.boolean().optional(),
    message: z.string().max(500).optional(),
  })
  .strict();
export type DiscardInput = z.input<typeof DiscardSchema>;

/** One thing that points to the record. */
export interface Pointer {
  readonly kind: 'document' | 'record' | 'item' | 'alias' | 'writer';
  /** workspace/document, a record's citation, an item's key, an old citation, or a writer's name. */
  readonly source: string;
  readonly title: string;
  readonly url?: string;
  /** How it points: the boxes and pages, the record's fields or links, the revisions. */
  readonly how: readonly string[];
}

export interface DiscardReport {
  readonly dryRun: boolean;
  readonly discarded: boolean;
  readonly id: string;
  readonly ref: string;
  readonly title: string;
  readonly pointers: readonly Pointer[];
  /** Documents and records that point to it in places the caller cannot open. */
  readonly hidden: number;
}

const placeOf = (kind: string, id: string): string => (kind === 'body' ? id : `${kind} ${id}`);

/** Everything that points to the record, as the caller may see it. */
async function pointersTo(ctx: AppContext, db: Db, p: Principal, row: PlacedRow): Promise<{ pointers: Pointer[]; hidden: number }> {
  const workspaces = new Map((await accessibleWorkspaces(db, p)).map((w) => [w.id, w.slug]));
  const docs = new Map<string, Set<string>>();
  const records = new Map<string, Set<string>>();
  const add = (into: Map<string, Set<string>>, key: string, how: string): void => {
    into.set(key, (into.get(key) ?? new Set()).add(how));
  };

  // Citations in documents and in other records' prose. Related is read from the records themselves, below.
  const cites = await db.query<{ document_id: string | null; source_decision_id: string | null; place_kind: string; place_id: string }>(
    "select document_id, source_decision_id, place_kind, place_id from decision_citations where decision_id = $1 and place_kind <> 'related' and (source_decision_id is null or source_decision_id <> $1)",
    [row.id],
  );
  for (const c of cites) {
    if (c.document_id) add(docs, c.document_id, placeOf(c.place_kind, c.place_id));
    else if (c.source_decision_id) add(records, c.source_decision_id, c.place_id);
  }
  const linked = await db.query<{ id: string; related: boolean; supersedes: boolean; superseded: boolean }>(
    `select id, related @> $3::jsonb as related, supersedes_id is not distinct from $2 as supersedes, superseded_by_id is not distinct from $2 as superseded
       from decisions where org_id = $1 and id <> $2 and (related @> $3::jsonb or supersedes_id = $2 or superseded_by_id = $2)`,
    [p.orgId, row.id, JSON.stringify([row.id])],
  );
  for (const l of linked) {
    if (l.related) add(records, l.id, 'related');
    if (l.supersedes) add(records, l.id, 'supersedes it');
    if (l.superseded) add(records, l.id, 'is superseded by it');
  }

  const pointers: Pointer[] = [];
  let hidden = 0;
  for (const [id, how] of docs) {
    const doc = await documentById(db, id);
    const ws = doc ? workspaces.get(doc.workspace_id) : undefined;
    if (!doc || !ws) {
      hidden++;
      continue;
    }
    pointers.push({ kind: 'document', source: `${ws}/${doc.slug}`, title: doc.name, url: documentUrl(ws, doc.slug), how: [...how] });
  }
  for (const src of await placedByIds(db, p.orgId, [...records.keys()])) {
    const ws = workspaces.get(src.workspace_id);
    if (!ws) {
      hidden++;
      continue;
    }
    pointers.push({ kind: 'record', source: refOf(src), title: src.title, url: recordUrl(ws, refOf(src)), how: [...records.get(src.id)!] });
  }
  const items = await db.query<{ key: string; title: string }>("select i.key, i.title from item_links l join items i on i.id = l.item_id where l.rel = 'decision' and l.target = $1 order by i.key", [row.id]);
  for (const i of items) pointers.push({ kind: 'item', source: i.key, title: i.title, how: ['links it'] });
  for (const a of await aliasesOf(db, [row.id])) {
    const old = refOf(a);
    pointers.push({ kind: 'alias', source: old, title: `${old} still resolves to it`, how: ['an old citation'] });
  }
  const writers = await db.query<{ label: string | null; n: number }>(
    `select coalesce(u.display_name, u.email) as label, count(*)::int as n
       from decision_revisions v left join users u on u.id = v.author_user_id
      where v.decision_id = $1 and v.author_user_id is distinct from $2
      group by v.author_user_id, u.display_name, u.email order by label`,
    [row.id, p.userId],
  );
  for (const w of writers) pointers.push({ kind: 'writer', source: w.label ?? 'no signed-in person', title: 'another writer', how: [`${w.n} revision${w.n === 1 ? '' : 's'}`] });
  return { pointers, hidden };
}

/** One pointer as a line a person or an agent reads. */
export function pointerLine(x: Pointer): string {
  return `${x.kind} ${x.source}${x.kind === 'document' || x.kind === 'record' || x.kind === 'item' ? ` (${x.title})` : ''}: ${x.how.join(', ')}`;
}

function refusal(ref: string, found: { pointers: readonly Pointer[]; hidden: number }): HttpError {
  const issues = found.pointers.map(pointerLine);
  if (found.hidden) issues.push(`${found.hidden} more in places you cannot open`);
  return new HttpError(409, `${ref} cannot be discarded, because something points to it. Retire it instead: set its status to deprecated, or supersede it with vantage_decision_supersede. What points to it:`, { issues, pointers: found.pointers, hidden: found.hidden });
}

export async function discardDecision(ctx: AppContext, p: Principal, ref: string, input: DiscardInput): Promise<DiscardReport> {
  const parsed = DiscardSchema.safeParse(input);
  if (!parsed.success) throw badRequest('invalid discard', { issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'discard'}: ${i.message}`) });
  const v = parsed.data;
  const { row } = await requireDecision(ctx, p, ref, 'author');
  const base = { id: row.id, ref: refOf(row), title: row.title };
  if (v.dryRun) {
    const found = await pointersTo(ctx, ctx.db, p, row);
    ctx.log.info('decision.discard.dry', { id: row.id, ref: base.ref, pointers: found.pointers.length, hidden: found.hidden });
    return { ...base, dryRun: true, discarded: false, ...found };
  }

  await ctx.db.transaction(async (tx) => {
    await lockRegistry(tx, row.registry_id);
    await tx.query('select id from decisions where id = $1 for update', [row.id]);
    const found = await pointersTo(ctx, tx, p, row);
    if (found.pointers.length || found.hidden) throw refusal(base.ref, found);
    const fresh = (await placedById(tx, p.orgId, row.id))!;
    const record = (await present({ ...ctx, db: tx }, p, [fresh]))[0]!;
    // Its governs links, its revisions, and its own citations go with it.
    await tx.query('delete from decisions where id = $1', [row.id]);
    await audit(tx, ctx.log, {
      orgId: p.orgId,
      who: whoOf(p),
      what: 'decision.discard',
      surface: p.surface,
      target: `decision:${row.id}`,
      details: { ref: base.ref, message: v.message ?? 'discarded', text: recordText(record), record },
    });
  });
  ctx.log.info('decision.discarded', { id: row.id, ref: base.ref });
  return { ...base, dryRun: false, discarded: true, pointers: [], hidden: 0 };
}

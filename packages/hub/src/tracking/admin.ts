/**
 * What a pipeline and an admin do to tracking: load a kind's file, and
 * erase an item. A kinds file is a plain document a module keeps in its own
 * repository and hands to the hub from its pipeline (docs/decisions/5001); a
 * hard delete is an event that blanks what the earlier events said and keeps
 * their place in the order (docs/decisions/3006).
 */
import { parseDocumentText } from '@vantage/model';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { maybe } from '../db/db.ts';
import { requireAdmin, requireWorkspace } from '../authz.ts';
import { HttpError, badRequest, forbidden } from '../http.ts';
import { saveDocument } from '../documents/save.ts';
import { requireApp } from './apps.ts';
import { findItem } from './access.ts';
import { kindByPrefix } from './kinds.ts';
import { membersOf, namedBy } from './gate.ts';
import { answered, append, lockFeed, stateById } from './store.ts';
import { blank, type EventData } from './state.ts';
import { actorOf, type WriteAnswer } from './write.ts';

/** Saves a kind's file: the document that holds the kind, made or changed. A module loads only its own kinds, into its own workspace. */
export async function loadKind(ctx: AppContext, p: Principal, prefix: string, yaml: string, workspace: string | undefined): Promise<{ status: string; line: string }> {
  const parsed = parseDocumentText(yaml, `${prefix}.vantage.yaml`);
  const kind = parsed.document?.kind;
  if (!kind) throw badRequest('a kinds file is a Vantage document with a kind block');
  if (kind.prefix !== prefix.toUpperCase()) throw badRequest(`the file defines ${kind.prefix}, not ${prefix.toUpperCase()}`);
  let workspaceId: string;
  if (p.module) {
    const app = await requireApp(ctx, p);
    if (!app.kinds.includes(kind.prefix)) throw forbidden(`app ${app.name} works ${app.kinds.join(', ') || 'no kinds'}, not ${kind.prefix}`);
    workspaceId = app.workspace_id;
  } else {
    if (!workspace) throw badRequest('name the workspace the kind lives in');
    workspaceId = (await requireWorkspace(ctx.db, p, workspace, 'author')).id;
  }
  const existing = await kindByPrefix(ctx.db, p.orgId, kind.prefix);
  if (existing && existing.workspace_id !== workspaceId) throw forbidden(`${kind.prefix} lives in another workspace`);
  const r = await saveDocument(ctx, {
    orgId: p.orgId,
    workspaceId,
    documentId: existing?.document_id,
    ...(existing ? {} : { slug: `kind-${kind.prefix.toLowerCase()}` }),
    yaml,
    message: 'kinds file from a pipeline',
    authorUserId: p.module ? null : p.userId,
    who: p.module ? `app:${p.module.clientId}` : p.userId,
    surface: 'api',
  });
  if (r.status === 'conflict') throw new HttpError(409, 'the kind changed while it was loaded; send it again');
  return { status: r.status, line: `${r.status === 'unchanged' ? 'unchanged' : existing ? 'changed' : 'made'} kind ${kind.prefix}` };
}

/**
 * Erases what an item says, for good: its title, labels, body, notes, run
 * records, and files. The events keep their place, who made them, and the
 * states they moved through; the erasing is an event too. Admins only.
 */
export async function erase(ctx: AppContext, p: Principal, ref: string, reason: string, key: string | undefined): Promise<WriteAnswer> {
  requireAdmin(p);
  if (!reason.trim()) throw badRequest('an erase says why');
  const f = await findItem(ctx, p, ref);
  const members = await membersOf(ctx.db, p.orgId, f.kind.definition);
  const files = await ctx.db.query<{ blob_key: string }>('select blob_key from item_files where item_id = $1', [f.item.id]);
  const out = await ctx.db.transaction(async (tx) => {
    await lockFeed(tx, p.orgId);
    const prior = await answered(tx, p.orgId, key, p.userId);
    if (prior) return { status: 'repeat' as const, line: prior.answer, key: prior.key };
    const before = (await stateById(tx, f.item.id, true))!;
    const events = await tx.query<{ position: string; data: EventData }>('select position, data from item_events where item_id = $1 order by position', [f.item.id]);
    for (const e of events) await tx.query('update item_events set data = $2 where position = $1', [e.position, JSON.stringify(blank(e.data))]);
    await tx.query("update item_bodies set text = '' where item_id = $1", [f.item.id]);
    await tx.query("update item_files set name = '(erased)' where item_id = $1", [f.item.id]);
    await append(tx, { orgId: p.orgId, itemId: f.item.id, before, data: { type: 'erased', reason: reason.trim().slice(0, 500) }, actor: actorOf(p), key, answer: `erased ${before.key}`, named: (x) => namedBy(f.kind.definition, x, members) });
    return { status: 'done' as const, line: `erased ${before.key}`, key: before.key };
  });
  // The files go once the events no longer name them.
  for (const file of files) await ctx.blob.delete(file.blob_key).catch(() => undefined);
  return out;
}

export async function documentOfKind(ctx: AppContext, prefix: string, orgId: string): Promise<string | undefined> {
  return (await maybe<{ id: string }>(ctx.db, 'select document_id as id from item_kinds where org_id = $1 and prefix = $2', [orgId, prefix]))?.id;
}

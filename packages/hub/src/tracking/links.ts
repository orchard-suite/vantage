/**
 * What an item links to, in the words people use and in the form the hub
 * keeps. Another item is kept by its id, a box or a view by its document's
 * id and its own, and a record by its ULID, so a rename or a move never
 * breaks a link. A target is checked when the link is made.
 */
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { maybe } from '../db/db.ts';
import { badRequest } from '../http.ts';
import { requireDecision } from '../decisions/read.ts';
import { loadStored } from '../documents/model.ts';
import { documentAt, workspaceAt } from '../text/things.ts';
import { ITEM_KEY, OWNER_KEY, findItem, type Found } from './access.ts';
import type { LinkRel } from './state.ts';
import { isMilestone } from './milestone.ts';

/** The form a link target is kept in, from the words a caller gave. */
export async function linkTarget(ctx: AppContext, p: Principal, f: Found, rel: LinkRel, target: string): Promise<string> {
  const t = target.trim();
  if (rel === 'came-from' || rel === 'part-of' || rel === 'waits-on' || rel === 'toward') {
    const other = await findItem(ctx, p, t);
    if (other.item.id === f.item.id) throw badRequest(`${f.item.key} cannot link to itself`);
    if (rel === 'toward' && !isMilestone(other.kind.definition)) throw badRequest(`${other.item.key} is not a milestone; toward names an item of a kind built on base: milestone`);
    if (rel === 'part-of' && !other.kind.definition.parts.includes(f.kind.prefix)) throw badRequest(`a ${f.kind.prefix} item cannot be part of ${other.item.key}: kind ${other.kind.prefix} lists ${other.kind.definition.parts.join(', ') || 'no kinds'} as its parts`);
    return other.item.id;
  }
  if (rel === 'decision') {
    const { row } = await requireDecision(ctx, p, t, 'viewer');
    return row.id;
  }
  if (rel === 'proof' && t.startsWith('ticket:')) {
    // A ticket in an outside tracker, read through a connector and never written: it must be open now, so the hub has seen it.
    const m = /^ticket:([^/#]+)\/([^/#]+)#(.+)$/.exec(t);
    if (!m) throw badRequest('a ticket is ticket:workspace/connector#ID, as the connector reports it: ticket:ops/jira#OPS-12');
    const ws = await workspaceAt(ctx, p, m[1]!, 'viewer');
    const source = await maybe<{ id: string }>(ctx.db, 'select id from sources where workspace_id = $1 and slug = $2', [ws.id, m[2]!]);
    if (!source) throw badRequest(`${m[1]} has no connector ${m[2]}`);
    const open = await maybe(ctx.db, "select 1 as x from observed_items where source_id = $1 and key like $2 limit 1", [source.id, `%:${m[3]!}@%`]);
    if (!open) throw badRequest(`connector ${m[2]} reports no open ticket ${m[3]}; name one it has read, so its closing can be seen`);
    return `ticket:${source.id}:${m[3]!}`;
  }
  if (rel === 'proof' && (ITEM_KEY.test(t) || OWNER_KEY.test(t))) {
    const other = await findItem(ctx, p, t);
    if (other.item.id === f.item.id) throw badRequest(`${f.item.key} cannot be its own proof`);
    return other.item.id;
  }
  const m = /^([^/#]+)\/([^/#]+)#(.+)$/.exec(t);
  if (!m) throw badRequest(rel === 'proof' ? 'proof names an item (VAN-12) or a box whose real thing a connector should see (workspace/document#box-id)' : `a ${rel} link names workspace/document#${rel === 'view' ? 'view-id' : 'box-id'}`);
  const at = await documentAt(ctx, p, { workspace: m[1]!, document: m[2]! }, 'viewer');
  if (!at?.head) throw badRequest(`no saved document ${m[1]}/${m[2]}`);
  const model = loadStored(at.head.yaml, at.head.imports).model;
  const id = m[3]!;
  if (rel !== 'view' && !model?.nodes.has(id)) throw badRequest(`${m[1]}/${m[2]} has no box ${id}; vantage_outline ${m[1]}/${m[2]} lists its boxes`);
  if (rel === 'view' && !model?.views.some((v) => v.id === id)) throw badRequest(`${m[1]}/${m[2]} has no view ${id}; vantage_outline ${m[1]}/${m[2]} lists its views`);
  return `${at.doc.id}#${id}`;
}

/** A kept link target in the words people use: an item's key, workspace/document#id, a record's citation. */
export async function linkText(ctx: AppContext, rel: LinkRel, target: string): Promise<string> {
  if (target.startsWith('ticket:')) {
    const [, sourceId, id] = target.split(':');
    const s = await maybe<{ ws: string; slug: string }>(ctx.db, 'select w.slug as ws, s.slug from sources s join workspaces w on w.id = s.workspace_id where s.id = $1', [sourceId]);
    return s ? `ticket:${s.ws}/${s.slug}#${id}` : `ticket ${id}`;
  }
  if (rel === 'came-from' || rel === 'part-of' || rel === 'waits-on' || rel === 'toward' || (rel === 'proof' && !target.includes('#'))) return (await maybe<{ key: string }>(ctx.db, 'select key from items where id = $1', [target]))?.key ?? 'an item';
  if (rel === 'decision') {
    const r = await maybe<{ prefix: string; number: number }>(ctx.db, 'select g.prefix, d.number from decisions d join decision_registries g on g.id = d.registry_id where d.id = $1', [target]);
    return r ? `${r.prefix}-${String(r.number).padStart(4, '0')}` : 'a record';
  }
  const [docId, id] = target.split('#');
  const d = await maybe<{ ws: string; slug: string }>(ctx.db, 'select w.slug as ws, d.slug from documents d join workspaces w on w.id = d.workspace_id where d.id = $1', [docId]);
  return d ? `${d.ws}/${d.slug}#${id}` : `a deleted document#${id}`;
}

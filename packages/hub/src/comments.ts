/** Comments on a document, a view, or boxes in a view; resolved by whom and when. */
import { z } from 'zod';
import type { Db } from './db/db.ts';
import { maybe } from './db/db.ts';
import { randomId } from './crypto.ts';
import { audit, type Surface } from './audit.ts';
import type { Logger } from './log.ts';
import { badRequest, notFound } from './http.ts';

export interface CommentRow {
  readonly id: string;
  readonly org_id: string;
  readonly document_id: string;
  readonly view_id: string | null;
  /** The boxes (nodes and groups) of the view the comment points at; empty for the whole view or document. */
  readonly targets: readonly string[];
  readonly text: string;
  readonly author_user_id: string | null;
  readonly resolved_by: string | null;
  readonly resolved_at: Date | null;
  readonly created_at: Date;
}

export interface Actor {
  readonly orgId: string;
  readonly userId: string;
  readonly who: string;
  readonly surface: Surface;
}

export async function listComments(db: Db, documentId: string, opts: { view?: string | undefined; open?: boolean | undefined } = {}): Promise<CommentRow[]> {
  const params: unknown[] = [documentId];
  let where = 'document_id = $1';
  if (opts.view) {
    params.push(opts.view);
    where += ` and view_id = $${params.length}`;
  }
  if (opts.open) where += ' and resolved_at is null';
  return db.query<CommentRow>(`select * from comments where ${where} order by created_at`, params);
}

/** The boxes a new comment points at, as a request names them. */
export const COMMENT_TARGETS = z.array(z.string().min(1).max(200)).max(50).optional();

export interface NewComment {
  readonly text: string;
  readonly viewId?: string | undefined;
  readonly targets?: readonly string[] | undefined;
}

export async function addComment(db: Db, log: Logger, actor: Actor, documentId: string, input: NewComment): Promise<CommentRow> {
  const id = randomId();
  const targets = [...new Set(input.targets ?? [])];
  if (targets.length && !input.viewId) throw badRequest('a comment on boxes names the view they are in');
  await db.query('insert into comments (id, org_id, document_id, view_id, targets, text, author_user_id) values ($1, $2, $3, $4, $5, $6, $7)', [id, actor.orgId, documentId, input.viewId ?? null, targets, input.text, actor.userId]);
  await audit(db, log, { orgId: actor.orgId, who: actor.who, what: 'comment.create', surface: actor.surface, target: `document:${documentId}`, details: { commentId: id, viewId: input.viewId ?? null, targets } });
  return (await maybe<CommentRow>(db, 'select * from comments where id = $1', [id]))!;
}

export async function updateComment(db: Db, log: Logger, actor: Actor, documentId: string, id: string, text: string): Promise<CommentRow> {
  const rows = await db.query('update comments set text = $3 where document_id = $1 and id = $2 returning id', [documentId, id, text]);
  if (!rows.length) throw notFound('comment');
  await audit(db, log, { orgId: actor.orgId, who: actor.who, what: 'comment.update', surface: actor.surface, target: `document:${documentId}`, details: { commentId: id } });
  return (await maybe<CommentRow>(db, 'select * from comments where id = $1', [id]))!;
}

export async function resolveComment(db: Db, log: Logger, actor: Actor, documentId: string, id: string, resolved: boolean): Promise<CommentRow> {
  const rows = resolved
    ? await db.query('update comments set resolved_by = $3, resolved_at = now() where document_id = $1 and id = $2 returning id', [documentId, id, actor.userId])
    : await db.query('update comments set resolved_by = null, resolved_at = null where document_id = $1 and id = $2 returning id', [documentId, id]);
  if (!rows.length) throw notFound('comment');
  await audit(db, log, { orgId: actor.orgId, who: actor.who, what: resolved ? 'comment.resolve' : 'comment.reopen', surface: actor.surface, target: `document:${documentId}`, details: { commentId: id } });
  return (await maybe<CommentRow>(db, 'select * from comments where id = $1', [id]))!;
}

export async function deleteComment(db: Db, log: Logger, actor: Actor, documentId: string, id: string): Promise<void> {
  const rows = await db.query('delete from comments where document_id = $1 and id = $2 returning id', [documentId, id]);
  if (!rows.length) throw notFound('comment');
  await audit(db, log, { orgId: actor.orgId, who: actor.who, what: 'comment.delete', surface: actor.surface, target: `document:${documentId}`, details: { commentId: id } });
}

/** A mention in a comment's text: `<@id>`, or `<@email>` as a writer may send it. */
export const MENTION_TOKEN = /<@([^<>\s]{1,200})>/g;

/** The ids and emails a text mentions, in order, once each. */
export function mentionTokens(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION_TOKEN)].map((m) => m[1]!))];
}

/** The comment as the API answers it; `mentions` are the user ids its text names as `<@id>`. */
export function publicComment(c: CommentRow): Record<string, unknown> {
  return { id: c.id, documentId: c.document_id, view: c.view_id, targets: c.targets, text: c.text, mentions: mentionTokens(c.text), author: c.author_user_id, resolvedBy: c.resolved_by, resolvedAt: c.resolved_at, createdAt: c.created_at };
}


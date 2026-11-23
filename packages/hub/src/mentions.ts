/**
 * Mentions in comments. A comment's text names a person as `<@id>`, their
 * stable user id; a writer may also name them `<@email>`, which is stored
 * as the id. Only people who may read the document can be mentioned; a
 * mention of anyone else refuses the whole comment. Every newly mentioned
 * person gets a notification addressed to them, sent through Dispatch when
 * the hub is connected to it, with a deep link to the view and the box.
 */
import type { AppContext } from './context.ts';
import type { Db } from './db/db.ts';
import { accessibleWorkspaces } from './authz.ts';
import type { Principal } from './auth/principal.ts';
import { addComment, MENTION_TOKEN, mentionTokens, updateComment, type Actor, type CommentRow, type NewComment } from './comments.ts';
import { notifyPerson } from './notify/notify.ts';
import { badRequest } from './http.ts';

export interface Person {
  readonly id: string;
  readonly label: string;
  readonly email: string | null;
}

/** Where a comment lives, for the deep link and the notification's words. */
export interface MentionScope {
  readonly workspace: { readonly id: string; readonly slug: string };
  readonly document: { readonly id: string; readonly slug: string; readonly name: string };
}

/** A text with each `<@id>` written as `@Name`, for mail and for agents. */
export function renderMentions(text: string, labels: ReadonlyMap<string, string>): string {
  return text.replace(MENTION_TOKEN, (_, id: string) => `@${labels.get(id) ?? id}`);
}

/**
 * Everyone who may read documents in the workspace: its owner, people
 * granted it, members of teams granted it, everyone when the organization
 * is granted it, and org admins. Disabled people are left out.
 */
export async function documentReaders(db: Db, orgId: string, workspaceId: string): Promise<Person[]> {
  return db.query<Person>(
    `select u.id, coalesce(u.display_name, u.subject) as label, u.email
       from users u
      where u.org_id = $1 and u.disabled_at is null and (
        u.is_admin
        or exists (select 1 from workspaces w where w.id = $2 and w.owner_user_id = u.id)
        or exists (select 1 from grants g where g.workspace_id = $2 and (
             (g.subject_kind = 'org' and g.subject_id = u.org_id)
          or (g.subject_kind = 'user' and g.subject_id = u.id)
          or (g.subject_kind = 'team' and exists (select 1 from team_members m where m.team_id = g.subject_id and m.user_id = u.id)))))
      order by label`,
    [orgId, workspaceId],
  );
}

/**
 * The text with every mention as `<@id>` and the ids it names; throws 400
 * naming each mention that is not someone who may read the document.
 */
export async function prepareMentions(db: Db, orgId: string, workspaceId: string, text: string): Promise<{ text: string; ids: string[] }> {
  const tokens = mentionTokens(text);
  if (!tokens.length) return { text, ids: [] };
  const readers = await documentReaders(db, orgId, workspaceId);
  const byId = new Map(readers.map((r) => [r.id, r]));
  const byEmail = new Map(readers.filter((r) => r.email).map((r) => [r.email!.toLowerCase(), r]));
  const resolved = new Map<string, string>();
  const refused: string[] = [];
  for (const t of tokens) {
    const person = byId.get(t) ?? byEmail.get(t.toLowerCase());
    if (person) resolved.set(t, person.id);
    else refused.push(t);
  }
  if (refused.length) {
    const known = await db.query<{ id: string; email: string | null; label: string }>('select id, email, coalesce(display_name, subject) as label from users where org_id = $1 and (id = any($2::text[]) or lower(email) = any($3::text[]))', [orgId, refused, refused.map((r) => r.toLowerCase())]);
    const name = (t: string): string => known.find((k) => k.id === t || k.email?.toLowerCase() === t.toLowerCase())?.label ?? t;
    throw badRequest(`cannot mention ${refused.map(name).join(', ')}: only people who can read this diagram can be mentioned`, { refused });
  }
  return { text: text.replace(MENTION_TOKEN, (_, t: string) => `<@${resolved.get(t)}>`), ids: [...new Set(resolved.values())] };
}

export interface Mentioned {
  readonly comment: CommentRow;
  /** People this write mentioned for the first time on the comment; each was notified. */
  readonly notified: readonly string[];
  /** Settles when every email has been sent or has failed; never rejects. */
  readonly delivery: Promise<void>;
}

/** Adds a comment, records whom it mentions, and tells each of them. */
export async function postComment(ctx: AppContext, actor: Actor, scope: MentionScope, input: NewComment): Promise<Mentioned> {
  const { text, ids } = await prepareMentions(ctx.db, actor.orgId, scope.workspace.id, input.text);
  const comment = await addComment(ctx.db, ctx.log, actor, scope.document.id, { ...input, text });
  return syncMentions(ctx, actor, scope, comment, ids);
}

/** Changes a comment's text; only people it did not mention before are told. */
export async function editComment(ctx: AppContext, actor: Actor, scope: MentionScope, id: string, input: string): Promise<Mentioned> {
  const { text, ids } = await prepareMentions(ctx.db, actor.orgId, scope.workspace.id, input);
  const comment = await updateComment(ctx.db, ctx.log, actor, scope.document.id, id, text);
  return syncMentions(ctx, actor, scope, comment, ids);
}

/** The page and hash that open a comment's view with its first box selected. */
export function commentLink(publicUrl: string, scope: MentionScope, comment: Pick<CommentRow, 'view_id' | 'targets'>): string {
  const page = `${publicUrl}/w/${encodeURIComponent(scope.workspace.slug)}/${encodeURIComponent(scope.document.slug)}`;
  if (!comment.view_id) return page;
  const box = comment.targets[0];
  return `${page}#${encodeURIComponent(comment.view_id)}${box ? `/${encodeURIComponent(box)}` : ''}`;
}

async function syncMentions(ctx: AppContext, actor: Actor, scope: MentionScope, comment: CommentRow, ids: readonly string[]): Promise<Mentioned> {
  const before = new Set((await ctx.db.query<{ user_id: string }>('select user_id from comment_mentions where comment_id = $1', [comment.id])).map((r) => r.user_id));
  const fresh = ids.filter((id) => !before.has(id));
  await ctx.db.query('delete from comment_mentions where comment_id = $1 and not (user_id = any($2::text[]))', [comment.id, [...ids]]);
  for (const id of fresh) await ctx.db.query('insert into comment_mentions (comment_id, user_id, org_id, document_id) values ($1, $2, $3, $4) on conflict do nothing', [comment.id, id, actor.orgId, scope.document.id]);
  const told = fresh.filter((id) => id !== actor.userId);
  if (!told.length) return { comment, notified: [], delivery: Promise.resolve() };
  const labels = await userLabels(ctx.db, [actor.userId, ...ids]);
  const author = labels.get(actor.userId) ?? 'Someone';
  const link = commentLink(ctx.config.PUBLIC_URL, scope, comment);
  const body = renderMentions(comment.text, labels).slice(0, 2000);
  const deliveries: Promise<void>[] = [];
  for (const userId of told) {
    const n = await notifyPerson(ctx, { orgId: actor.orgId, workspaceId: scope.workspace.id, userId, kind: 'mention', title: `${author} mentioned you in ${scope.document.name}`, body, link });
    deliveries.push(n.delivery);
  }
  ctx.log.info('mention.notified', { commentId: comment.id, documentId: scope.document.id, people: told.length });
  ctx.metrics.mentions.add(told.length, { surface: actor.surface });
  return { comment, notified: told, delivery: Promise.all(deliveries).then(() => undefined) };
}

/** Display name or subject per user id. */
export async function userLabels(db: Db, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (!wanted.length) return new Map();
  const rows = await db.query<{ id: string; label: string }>('select id, coalesce(display_name, subject) as label from users where id = any($1::text[])', [wanted]);
  return new Map(rows.map((r) => [r.id, r.label]));
}

export interface MentionItem {
  readonly commentId: string;
  readonly text: string;
  readonly author: string | null;
  readonly authorLabel: string | null;
  readonly workspace: string;
  readonly document: string;
  readonly documentName: string;
  readonly view: string | null;
  readonly targets: readonly string[];
  readonly resolved: boolean;
  readonly link: string;
  readonly createdAt: Date;
}

interface MentionRow {
  readonly comment_id: string;
  readonly created_at: Date;
  readonly text: string;
  readonly view_id: string | null;
  readonly targets: readonly string[];
  readonly resolved_at: Date | null;
  readonly author_user_id: string | null;
  readonly workspace_id: string;
  readonly workspace_slug: string;
  readonly document_id: string;
  readonly document_slug: string;
  readonly document_name: string;
}

/** Where the person was mentioned, newest first, in documents they may still read; the text names people, not ids. */
export async function listMentions(ctx: AppContext, p: Principal, limit = 50): Promise<MentionItem[]> {
  const readable = new Set((await accessibleWorkspaces(ctx.db, p)).map((w) => w.id));
  const rows = await ctx.db.query<MentionRow>(
    `select m.comment_id, m.created_at, c.text, c.view_id, c.targets, c.resolved_at, c.author_user_id,
            w.id as workspace_id, w.slug as workspace_slug, d.id as document_id, d.slug as document_slug, d.name as document_name
       from comment_mentions m
       join comments c on c.id = m.comment_id
       join documents d on d.id = m.document_id
       join workspaces w on w.id = d.workspace_id
      where m.user_id = $1
      order by m.created_at desc
      limit $2`,
    [p.userId, Math.min(Math.max(limit, 1), 200)],
  );
  const kept = rows.filter((r) => readable.has(r.workspace_id));
  const labels = await userLabels(ctx.db, kept.flatMap((r) => [r.author_user_id, ...mentionTokens(r.text)]));
  return kept.map((r) => {
    const scope: MentionScope = { workspace: { id: r.workspace_id, slug: r.workspace_slug }, document: { id: r.document_id, slug: r.document_slug, name: r.document_name } };
    return {
      commentId: r.comment_id,
      text: renderMentions(r.text, labels),
      author: r.author_user_id,
      authorLabel: r.author_user_id ? labels.get(r.author_user_id) ?? null : null,
      workspace: r.workspace_slug,
      document: r.document_slug,
      documentName: r.document_name,
      view: r.view_id,
      targets: r.targets,
      resolved: r.resolved_at !== null,
      link: commentLink(ctx.config.PUBLIC_URL, scope, r),
      createdAt: r.created_at,
    };
  });
}

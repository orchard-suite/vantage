/**
 * Reactions on boxes for review sessions: a thumbs up, "looks wrong", and a
 * question, one of each per person per box in a view. "Looks wrong" also
 * files a comment on the box, so it enters the comment and revise flow.
 * Every change goes out on the document's live channel, so open viewers
 * redraw their badges. A box a later save drops keeps its reactions; the
 * list marks them orphaned.
 */
import { z } from 'zod';
import type { AppContext } from './context.ts';
import { channelName } from './db/db.ts';
import { audit } from './audit.ts';
import type { Actor, CommentRow } from './comments.ts';
import { headVersion, type DocumentRow } from './documents/repo.ts';
import { loadStored } from './documents/model.ts';
import { fileText, storedArtifact } from './documents/derived.ts';
import { DOC_CHANNEL_PREFIX } from './worker/artifacts.ts';
import { postComment, userLabels, type MentionScope } from './mentions.ts';
import { badRequest } from './http.ts';

export const REACTION_KINDS = ['up', 'wrong', 'question'] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];
export const ReactionKindSchema = z.enum(REACTION_KINDS);

/** What each kind says, in the comment "looks wrong" files and in text for agents. */
export const REACTION_WORDS: Record<ReactionKind, string> = { up: 'thumbs up', wrong: 'looks wrong', question: 'question' };

export const NewReactionSchema = z.object({
  view: z.string().min(1).max(200),
  box: z.string().min(1).max(200),
  kind: ReactionKindSchema,
  /** "Looks wrong" only: the sentence that goes in the comment it files. */
  text: z.string().max(2000).optional(),
});
export type NewReaction = z.output<typeof NewReactionSchema>;

interface ReactionRow {
  readonly view_id: string;
  readonly box_id: string;
  readonly user_id: string;
  readonly kind: ReactionKind;
  readonly comment_id: string | null;
  readonly created_at: Date;
}

export interface ReactionPerson {
  readonly id: string;
  readonly label: string;
}

export interface KindTally {
  readonly count: number;
  readonly people: readonly ReactionPerson[];
  /** Whether the caller holds this one. */
  readonly mine: boolean;
}

export interface BoxReactions {
  readonly view: string;
  readonly box: string;
  /** The box is no longer in the view's head; its reactions are kept. */
  readonly orphaned: boolean;
  readonly total: number;
  readonly kinds: Readonly<Record<ReactionKind, KindTally>>;
}

/** The ids a view of the head draws: every node of the model and every box of the view's stored entry. */
async function headBoxes(ctx: AppContext, document: DocumentRow, views: readonly string[]): Promise<{ views: Set<string>; boxes: Map<string, Set<string>> } | undefined> {
  const head = await headVersion(ctx.db, document);
  const model = head ? loadStored(head.yaml, head.imports).model : undefined;
  if (!head || !model) return undefined;
  const nodes = [...model.nodes.keys()];
  const boxes = new Map<string, Set<string>>();
  for (const view of new Set(views)) {
    const ids = new Set(nodes);
    const entry = await storedArtifact(ctx, head, view, 'view').catch(() => undefined);
    if (entry) {
      const parsed = JSON.parse(fileText(entry)) as { boxes?: { id?: unknown }[] };
      for (const b of parsed.boxes ?? []) if (typeof b.id === 'string') ids.add(b.id);
    }
    boxes.set(view, ids);
  }
  return { views: new Set(model.views.map((v) => v.id)), boxes };
}

/** Tells every open viewer of the document that its reactions changed. */
async function announce(ctx: AppContext, documentId: string): Promise<void> {
  await ctx.db.notify(channelName(DOC_CHANNEL_PREFIX, documentId), JSON.stringify({ reactions: true }));
}

export interface Reacted {
  /** False when the caller already held it. */
  readonly added: boolean;
  /** The comment "looks wrong" filed. */
  readonly comment?: CommentRow;
}

/** Puts a reaction on a box; refuses a view or a box the head does not have. */
export async function addReaction(ctx: AppContext, actor: Actor, scope: MentionScope & { document: DocumentRow }, input: NewReaction): Promise<Reacted> {
  if (input.text !== undefined && input.kind !== 'wrong') throw badRequest('only "looks wrong" takes a sentence');
  const head = await headBoxes(ctx, scope.document, [input.view]);
  if (head && !head.views.has(input.view)) throw badRequest(`view ${input.view} is not in this diagram`);
  if (head && !head.boxes.get(input.view)?.has(input.box)) throw badRequest(`box ${input.box} is not in view ${input.view}`);
  const key = [scope.document.id, input.view, input.box, actor.userId, input.kind];
  if ((await ctx.db.query('select 1 as x from reactions where document_id = $1 and view_id = $2 and box_id = $3 and user_id = $4 and kind = $5', key)).length) return { added: false };
  // The comment goes first: a sentence the comment path refuses (a mention of someone who cannot read) leaves no reaction behind.
  let comment: CommentRow | undefined;
  if (input.kind === 'wrong') {
    const said = input.text?.trim();
    comment = (await postComment(ctx, actor, scope, { text: said ? `Looks wrong: ${said}` : 'Looks wrong.', viewId: input.view, targets: [input.box] })).comment;
  }
  const rows = await ctx.db.query('insert into reactions (document_id, view_id, box_id, user_id, kind, org_id, comment_id) values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing returning kind', [...key, actor.orgId, comment?.id ?? null]);
  if (!rows.length) return { added: false };
  await audit(ctx.db, ctx.log, { orgId: actor.orgId, who: actor.who, what: 'reaction.add', surface: actor.surface, target: `document:${scope.document.id}`, details: { viewId: input.view, boxId: input.box, kind: input.kind, commentId: comment?.id ?? null } });
  ctx.metrics.reactions.add(1, { kind: input.kind, change: 'add' });
  await announce(ctx, scope.document.id);
  return { added: true, ...(comment ? { comment } : {}) };
}

/** Takes the caller's reaction off a box; the comment "looks wrong" filed stays. Answers whether there was one. */
export async function removeReaction(ctx: AppContext, actor: Actor, documentId: string, input: { view: string; box: string; kind: ReactionKind }): Promise<boolean> {
  const rows = await ctx.db.query('delete from reactions where document_id = $1 and view_id = $2 and box_id = $3 and user_id = $4 and kind = $5 returning kind', [documentId, input.view, input.box, actor.userId, input.kind]);
  if (!rows.length) return false;
  await audit(ctx.db, ctx.log, { orgId: actor.orgId, who: actor.who, what: 'reaction.remove', surface: actor.surface, target: `document:${documentId}`, details: { viewId: input.view, boxId: input.box, kind: input.kind } });
  ctx.metrics.reactions.add(1, { kind: input.kind, change: 'remove' });
  await announce(ctx, documentId);
  return true;
}

/** Most flagged first: more "looks wrong", then more questions, then more of all. */
export function byFlags(a: BoxReactions, b: BoxReactions): number {
  return b.kinds.wrong.count - a.kinds.wrong.count || b.kinds.question.count - a.kinds.question.count || b.total - a.total || a.box.localeCompare(b.box);
}

/** Reactions per box, most flagged first, for one view or all; `mine` is the caller's. */
export async function listReactions(ctx: AppContext, document: DocumentRow, callerId: string, view?: string): Promise<BoxReactions[]> {
  const rows = await ctx.db.query<ReactionRow>(`select view_id, box_id, user_id, kind, comment_id, created_at from reactions where document_id = $1${view ? ' and view_id = $2' : ''} order by created_at`, view ? [document.id, view] : [document.id]);
  if (!rows.length) return [];
  const labels = await userLabels(ctx.db, rows.map((r) => r.user_id));
  const head = await headBoxes(ctx, document, rows.map((r) => r.view_id));
  const groups = new Map<string, ReactionRow[]>();
  for (const r of rows) {
    const key = `${r.view_id}\u0000${r.box_id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: BoxReactions[] = [];
  for (const list of groups.values()) {
    const { view_id, box_id } = list[0]!;
    const tally = (kind: ReactionKind): KindTally => {
      const of = list.filter((r) => r.kind === kind);
      return { count: of.length, people: of.map((r) => ({ id: r.user_id, label: labels.get(r.user_id) ?? r.user_id })), mine: of.some((r) => r.user_id === callerId) };
    };
    const orphaned = head ? !head.views.has(view_id) || !head.boxes.get(view_id)?.has(box_id) : false;
    out.push({ view: view_id, box: box_id, orphaned, total: list.length, kinds: { up: tally('up'), wrong: tally('wrong'), question: tally('question') } });
  }
  return out.sort(byFlags);
}

/** One line per box for agents: `view/box  wrong 2 (A, B)  question 1 (C)  up 3`. */
export function reactionsText(list: readonly BoxReactions[]): string {
  return (
    list
      .map((b) => {
        const parts = REACTION_KINDS.filter((k) => b.kinds[k].count).map((k) => `${REACTION_WORDS[k]} ${b.kinds[k].count} (${b.kinds[k].people.map((p) => p.label).join(', ')})`);
        return `${b.view}/${b.box}${b.orphaned ? '  [orphaned: no longer in the view]' : ''}  ${parts.join('  ')}`;
      })
      .join('\n') || 'no reactions'
  );
}

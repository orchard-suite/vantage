/**
 * Revision rows: one per request to the organization's model, kept as the
 * record of who spent what (usage.ts adds it up). A revision carries out a
 * document's open comments; a generation draws a new diagram from words.
 */
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { randomId } from '../crypto.ts';
import { HttpError } from '../http.ts';
import type { Usage } from './provider.ts';

export type RevisionState = 'queued' | 'running' | 'ready' | 'failed' | 'accepted' | 'rejected';

export type RevisionKind = 'revise' | 'generate';

export interface RevisionRow {
  readonly id: string;
  readonly org_id: string;
  readonly kind: RevisionKind;
  readonly document_id: string | null;
  /** Generations only: the workspace it was asked for. */
  readonly workspace_id: string | null;
  /** Generations only: the description and notes as the person wrote them. */
  readonly prompt: string | null;
  readonly base_version_id: string | null;
  readonly requested_by: string;
  readonly comment_ids: readonly string[];
  readonly model: string;
  readonly state: RevisionState;
  readonly yaml: string | null;
  readonly summary: string | null;
  readonly addressed: readonly string[];
  readonly error: string | null;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_read_tokens: number;
  readonly cache_write_tokens: number;
  readonly version_id: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** Minutes after which a queued or running revision is taken as dead: well past two model calls and a queue wait. */
const STALE_MINUTES = 15;

export interface NewRevision {
  readonly orgId: string;
  readonly documentId: string;
  readonly baseVersionId: string;
  readonly requestedBy: string;
  readonly commentIds: readonly string[];
  readonly model: string;
}

/** Records a queued revision; a document runs one at a time, so a second while one is queued or running is a 409. */
export async function createRevision(db: Db, r: NewRevision): Promise<RevisionRow> {
  const id = randomId();
  // A revision whose worker died never moves on; past the longest a run can take it no longer holds the document.
  await db.query(`update revisions set state = 'failed', error = 'the revision stopped without an answer', updated_at = now() where document_id = $1 and state in ('queued', 'running') and updated_at < now() - interval '${STALE_MINUTES} minutes'`, [r.documentId]);
  const rows = await db.query<RevisionRow>(
    `insert into revisions (id, org_id, document_id, base_version_id, requested_by, comment_ids, model, state) values ($1, $2, $3, $4, $5, $6, $7, 'queued')
       on conflict (document_id) where state in ('queued', 'running') do nothing returning *`,
    [id, r.orgId, r.documentId, r.baseVersionId, r.requestedBy, r.commentIds, r.model],
  );
  if (!rows[0]) throw new HttpError(409, 'a revision of this document is already running; wait for it to finish');
  return rows[0];
}

export interface NewGeneration {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly requestedBy: string;
  readonly prompt: string;
  readonly model: string;
}

/** Records a queued generation; a person runs one at a time, so a second while one is queued or running is a 409. */
export async function createGeneration(db: Db, g: NewGeneration): Promise<RevisionRow> {
  await db.query(`update revisions set state = 'failed', error = 'the generation stopped without an answer', updated_at = now() where kind = 'generate' and requested_by = $1 and state in ('queued', 'running') and updated_at < now() - interval '${STALE_MINUTES} minutes'`, [g.requestedBy]);
  const rows = await db.query<RevisionRow>(
    `insert into revisions (id, org_id, kind, workspace_id, requested_by, prompt, model, state) values ($1, $2, 'generate', $3, $4, $5, $6, 'queued')
       on conflict (requested_by) where kind = 'generate' and state in ('queued', 'running') do nothing returning *`,
    [randomId(), g.orgId, g.workspaceId, g.requestedBy, g.prompt, g.model],
  );
  if (!rows[0]) throw new HttpError(409, 'you already have a diagram being drawn; wait for it to finish');
  return rows[0];
}

export async function revisionById(db: Db, id: string): Promise<RevisionRow | undefined> {
  return maybe<RevisionRow>(db, 'select * from revisions where id = $1', [id]);
}

/** The newest revisions of a document, newest first. */
export async function listRevisions(db: Db, documentId: string, limit = 10): Promise<RevisionRow[]> {
  return db.query<RevisionRow>('select * from revisions where document_id = $1 order by created_at desc limit $2', [documentId, limit]);
}

/** Moves a revision on from one of the states it may leave; false when it was already elsewhere. */
export async function moveRevision(db: Db, id: string, from: readonly RevisionState[], to: RevisionState, fields: { yaml?: string; summary?: string; addressed?: readonly string[]; error?: string; versionId?: string } = {}): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    `update revisions set state = $3,
        yaml = coalesce($4, yaml), summary = coalesce($5, summary), addressed = coalesce($6, addressed), error = coalesce($7, error), version_id = coalesce($8, version_id), updated_at = now()
      where id = $1 and state = any($2::text[]) returning id`,
    [id, from, to, fields.yaml ?? null, fields.summary ?? null, fields.addressed ?? null, fields.error ?? null, fields.versionId ?? null],
  );
  return rows.length > 0;
}

/** A generation as its author reads it: the draft, what the hub said about it, and what it cost. */
export function publicGeneration(r: RevisionRow): Record<string, unknown> {
  return {
    id: r.id,
    state: r.state,
    model: r.model,
    yaml: r.yaml,
    summary: r.summary,
    error: r.error,
    tokens: { input: r.input_tokens, output: r.output_tokens, cacheRead: r.cache_read_tokens, cacheWrite: r.cache_write_tokens },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Adds the tokens one model call spent to its revision. */
export async function addUsage(db: Db, id: string, usage: Usage): Promise<void> {
  await db.query('update revisions set input_tokens = input_tokens + $2, output_tokens = output_tokens + $3, cache_read_tokens = cache_read_tokens + $4, cache_write_tokens = cache_write_tokens + $5, updated_at = now() where id = $1', [id, usage.input, usage.output, usage.cacheRead, usage.cacheWrite]);
}

export function publicRevision(r: RevisionRow): Record<string, unknown> {
  return {
    id: r.id,
    kind: r.kind,
    state: r.state,
    model: r.model,
    base: r.base_version_id,
    comments: r.comment_ids,
    summary: r.summary,
    addressed: r.addressed,
    error: r.error,
    tokens: { input: r.input_tokens, output: r.output_tokens, cacheRead: r.cache_read_tokens, cacheWrite: r.cache_write_tokens },
    version: r.version_id,
    requestedBy: r.requested_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

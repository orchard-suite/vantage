/** Rows and reads for publications and their runs. */
import { PublicationSchema, type Publication } from '@vantage/publish';
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';

export type PublicationTrigger = Publication['trigger'];

export interface PublicationLastRun {
  readonly at: string;
  readonly status: 'ok' | 'failed';
  readonly trigger: string;
  readonly written: number;
  readonly skipped: number;
  readonly error?: string;
}

/** An admin's decision on a publication: none yet, approved, or stopped. */
export type Approval = 'pending' | 'approved' | 'stopped';

export interface PublicationRow {
  readonly id: string;
  readonly org_id: string;
  readonly workspace_id: string;
  readonly document_id: string;
  readonly name: string;
  readonly views: readonly string[] | null;
  readonly formats: readonly Publication['formats'][number][];
  readonly target: string;
  readonly config: Record<string, unknown>;
  readonly trigger: PublicationTrigger;
  readonly audience: Publication['audience'];
  readonly theme: Publication['theme'] | null;
  readonly title_block: boolean;
  readonly enabled: boolean;
  readonly created_by: string | null;
  readonly approval: Approval;
  readonly approval_by: string | null;
  readonly approval_at: Date | null;
  readonly last_run: PublicationLastRun | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface PublicationRunRow {
  readonly id: string;
  readonly org_id: string;
  readonly publication_id: string;
  readonly job_id: string | null;
  readonly trigger: string;
  readonly status: 'ok' | 'failed';
  readonly version_id: string | null;
  readonly started_at: Date;
  readonly finished_at: Date;
  readonly written: readonly { artifact: string; location: string; bytes: number }[];
  readonly skipped: readonly { artifact: string; reason: string }[];
  readonly error: string | null;
}

const PUB = 'select * from publications';

/** The SQL condition for a publication that may run: on, not stopped by an admin, and approved when approval is required. */
function live(approvalRequired: boolean): string {
  return `enabled and approval <> 'stopped'${approvalRequired ? " and approval = 'approved'" : ''}`;
}

/** Why an admin's decision keeps a publication from running, or undefined when it may run. Every run path asks it; pausing (enabled) only holds back the automatic triggers. */
export function blockedReason(row: Pick<PublicationRow, 'approval'>, approvalRequired: boolean): string | undefined {
  if (row.approval === 'stopped') return 'an admin stopped this publication';
  if (approvalRequired && row.approval !== 'approved') return 'this publication is waiting for an admin to approve it';
  return undefined;
}

/** Fields that say what leaves the hub and where it goes; changing any of them takes back an approval. */
export const DESTINATION_FIELDS = ['document_id', 'views', 'formats', 'target', 'config', 'trigger', 'audience'] as const;

export function destinationChanged(before: PublicationRow, after: Pick<PublicationRow, (typeof DESTINATION_FIELDS)[number]>): boolean {
  return DESTINATION_FIELDS.some((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]));
}

export async function listPublications(db: Db, workspaceId: string, documentId?: string): Promise<PublicationRow[]> {
  return documentId === undefined
    ? db.query<PublicationRow>(`${PUB} where workspace_id = $1 order by name`, [workspaceId])
    : db.query<PublicationRow>(`${PUB} where workspace_id = $1 and document_id = $2 order by name`, [workspaceId, documentId]);
}

export async function publicationById(db: Db, id: string): Promise<PublicationRow | undefined> {
  return maybe<PublicationRow>(db, `${PUB} where id = $1`, [id]);
}

export async function onSavePublications(db: Db, documentId: string, approvalRequired: boolean): Promise<PublicationRow[]> {
  return db.query<PublicationRow>(`${PUB} where document_id = $1 and ${live(approvalRequired)} and trigger->>'kind' = 'on-save' order by name`, [documentId]);
}

export async function scheduledPublications(db: Db, approvalRequired: boolean): Promise<PublicationRow[]> {
  return db.query<PublicationRow>(`${PUB} where ${live(approvalRequired)} and trigger->>'kind' = 'schedule' order by org_id, name`);
}

/** Every publication in the organization, for admins: waiting ones first, then by workspace and name. */
export async function orgPublications(db: Db, orgId: string): Promise<(PublicationRow & { workspace_slug: string; workspace_name: string; document_slug: string; document_name: string; created_by_name: string | null })[]> {
  return db.query(
    `select p.*, w.slug as workspace_slug, w.name as workspace_name, d.slug as document_slug, d.name as document_name, coalesce(u.display_name, u.email) as created_by_name
       from publications p
       join workspaces w on w.id = p.workspace_id
       join documents d on d.id = p.document_id
       left join users u on u.id = p.created_by
      where p.org_id = $1
      order by case p.approval when 'pending' then 0 when 'approved' then 1 else 2 end, w.name, p.name`,
    [orgId],
  );
}

/** Records an admin's decision. */
export async function setApproval(db: Db, id: string, approval: Exclude<Approval, 'pending'>, by: string): Promise<void> {
  await db.query('update publications set approval = $2, approval_by = $3, approval_at = now(), updated_at = now() where id = $1', [id, approval, by]);
}

/** The @vantage/publish record for a row; the schema is the single source of what a publication may say. */
export function toPublication(row: PublicationRow): Publication {
  return PublicationSchema.parse({
    id: row.id,
    document: row.document_id,
    ...(row.views ? { views: row.views } : {}),
    formats: row.formats,
    target: row.target,
    config: row.config,
    trigger: row.trigger,
    audience: row.audience,
    ...(row.theme ? { theme: row.theme } : {}),
    titleBlock: row.title_block,
  });
}

export async function recordPublicationRun(db: Db, run: Omit<PublicationRunRow, 'org_id'> & { readonly orgId: string }): Promise<void> {
  await db.query('insert into publication_runs (id, org_id, publication_id, job_id, trigger, status, version_id, started_at, finished_at, written, skipped, error) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)', [
    run.id,
    run.orgId,
    run.publication_id,
    run.job_id,
    run.trigger,
    run.status,
    run.version_id,
    run.started_at,
    run.finished_at,
    JSON.stringify(run.written),
    JSON.stringify(run.skipped),
    run.error,
  ]);
  const last: PublicationLastRun = { at: run.finished_at.toISOString(), status: run.status, trigger: run.trigger, written: run.written.length, skipped: run.skipped.length, ...(run.error ? { error: run.error } : {}) };
  await db.query('update publications set last_run = $2, updated_at = now() where id = $1', [run.publication_id, JSON.stringify(last)]);
}

export async function listPublicationRuns(db: Db, publicationId: string, limit = 50): Promise<PublicationRunRow[]> {
  return db.query<PublicationRunRow>('select * from publication_runs where publication_id = $1 order by started_at desc limit $2', [publicationId, Math.min(limit, 500)]);
}

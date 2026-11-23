/** Rows and reads for documents, versions, and artifacts. Writes live in save.ts. */
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import type { ImportMap } from './model.ts';
import type { Attachment } from './assets.ts';

export interface DocumentRow {
  readonly id: string;
  readonly org_id: string;
  readonly workspace_id: string;
  readonly name: string;
  readonly slug: string;
  readonly head_version_id: string | null;
  /** Source slugs the head version binds to. */
  readonly bind_sources: readonly string[];
  /** The person who made it; null for a source, or when they are gone. */
  readonly created_by: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface VersionRow {
  readonly id: string;
  readonly org_id: string;
  readonly document_id: string;
  readonly hash: string;
  readonly yaml: string;
  readonly imports: ImportMap;
  readonly pins: Record<string, unknown>;
  readonly attachments: readonly Attachment[];
  readonly author_user_id: string | null;
  readonly surface: string;
  readonly message: string;
  readonly parent_id: string | null;
  /** Layout score per view id, filled in when the version renders. */
  readonly scores: Readonly<Record<string, number>>;
  readonly created_at: Date;
}

export type VersionSummary = Omit<VersionRow, 'yaml' | 'imports' | 'pins' | 'attachments'>;

/** Drawn with every render: the viewer bundle's shell and each view's entry in it. */
export type RenderedKind = 'bundle' | 'view';
/** Made from a render the first time someone asks: a view's SVG and PNG, and the standalone HTML. */
export type DerivedKind = 'svg' | 'png' | 'html';
export type ArtifactKind = RenderedKind | DerivedKind;

export interface ArtifactRow {
  readonly id: string;
  readonly org_id: string;
  readonly version_hash: string;
  readonly view_id: string;
  readonly kind: ArtifactKind;
  readonly blob_key: string;
  readonly bytes: number;
  readonly content_type: string;
  /** The render that wrote it; null on files from before renders had ids. */
  readonly render_id: string | null;
  /** A view entry's digest; null on every other kind. */
  readonly digest: string | null;
  readonly created_at: Date;
}

const DOC = 'select id, org_id, workspace_id, name, slug, head_version_id, bind_sources, created_by, created_at, updated_at from documents';
const VER_SUMMARY = 'select id, org_id, document_id, hash, author_user_id, surface, message, parent_id, scores, created_at from versions';

export async function listDocuments(db: Db, workspaceId: string): Promise<DocumentRow[]> {
  return db.query<DocumentRow>(`${DOC} where workspace_id = $1 order by name`, [workspaceId]);
}

export async function documentBySlug(db: Db, workspaceId: string, slug: string): Promise<DocumentRow | undefined> {
  return maybe<DocumentRow>(db, `${DOC} where workspace_id = $1 and slug = $2`, [workspaceId, slug]);
}

/** Where the document that left this address went, as workspace/document; undefined when none did, or one is there again. */
export async function movedTo(db: Db, workspaceId: string, slug: string): Promise<string | undefined> {
  const r = await maybe<{ ws: string; slug: string }>(
    db,
    `select w.slug as ws, d.slug from document_aliases a join documents d on d.id = a.document_id join workspaces w on w.id = d.workspace_id
      where a.workspace_id = $1 and a.slug = $2 and not exists (select 1 from documents x where x.workspace_id = $1 and x.slug = $2)`,
    [workspaceId, slug],
  );
  return r ? `${r.ws}/${r.slug}` : undefined;
}

export async function documentById(db: Db, id: string): Promise<DocumentRow | undefined> {
  return maybe<DocumentRow>(db, `${DOC} where id = $1`, [id]);
}

/** Documents in the org whose head version binds to the source. */
/** Documents of a workspace whose head version reads a connector slug: only a connector's own workspace reads it. */
export async function documentsBoundTo(db: Db, workspaceId: string, sourceSlug: string): Promise<DocumentRow[]> {
  return db.query<DocumentRow>(`${DOC} where workspace_id = $1 and bind_sources @> $2::jsonb order by name`, [workspaceId, JSON.stringify([sourceSlug])]);
}

/** Every document of a workspace that binds a box to anything: where open items of any connector may land. */
export async function documentsBindingAny(db: Db, workspaceId: string): Promise<DocumentRow[]> {
  return db.query<DocumentRow>(`${DOC} where workspace_id = $1 and jsonb_array_length(bind_sources) > 0 order by name`, [workspaceId]);
}

export async function versionById(db: Db, id: string): Promise<VersionRow | undefined> {
  return maybe<VersionRow>(db, 'select * from versions where id = $1', [id]);
}

export async function headVersion(db: Db, doc: DocumentRow): Promise<VersionRow | undefined> {
  return doc.head_version_id ? versionById(db, doc.head_version_id) : undefined;
}

export async function listVersions(db: Db, documentId: string, limit = 50): Promise<VersionSummary[]> {
  return db.query<VersionSummary>(`${VER_SUMMARY} where document_id = $1 order by created_at desc limit $2`, [documentId, limit]);
}

export async function artifactsFor(db: Db, hash: string): Promise<ArtifactRow[]> {
  return db.query<ArtifactRow>('select * from artifacts where version_hash = $1 order by view_id, kind', [hash]);
}

export async function artifact(db: Db, hash: string, viewId: string, kind: ArtifactKind): Promise<ArtifactRow | undefined> {
  return maybe<ArtifactRow>(db, 'select * from artifacts where version_hash = $1 and view_id = $2 and kind = $3', [hash, viewId, kind]);
}

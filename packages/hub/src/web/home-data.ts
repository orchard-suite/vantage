/**
 * What the home page shows, in as few queries as it can: every document the
 * reader may open with its head version's view count, last author, whether
 * the worker has drawn it yet, whether it has a picture for a thumbnail,
 * and how far it drifted from its sources; the reader's own name; and
 * which view a card shows.
 */
import type { Db } from '../db/db.ts';
import type { Principal } from '../auth/principal.ts';
import type { AccessibleWorkspace } from '../authz.ts';
import type { ArtifactRow } from '../documents/repo.ts';

export interface HomeDocument {
  readonly id: string;
  readonly workspaceId: string;
  /** The folder it sits in inside its workspace, if any. */
  readonly folderId: string | null;
  /** The reader starred it. */
  readonly starred: boolean;
  readonly slug: string;
  readonly name: string;
  readonly updatedAt: Date;
  /** Views on the head version, from its layout scores; 0 until the worker has drawn it. */
  readonly views: number;
  readonly author: string | null;
  /** The worker has written the head version's bundle. */
  readonly rendered: boolean;
  /** A view picture exists for the thumbnail route. */
  readonly hasThumb: boolean;
  /** Source slugs the head version binds to. */
  readonly sources: readonly string[];
  /** Boxes on the head version that no longer match what its sources found: missing, undeclared, or changed. */
  readonly drift: number;
  /** The person who made it, for the workspace's delete rule. */
  readonly createdBy: string | null;
}

interface Row {
  id: string;
  folder_id: string | null;
  starred: boolean;
  workspace_id: string;
  created_by: string | null;
  slug: string;
  name: string;
  updated_at: Date;
  bind_sources: string[] | null;
  scores: Record<string, number> | null;
  author: string | null;
  rendered: boolean;
  has_thumb: boolean;
  drift: { missing?: number; undeclared?: number; mismatched?: number } | null;
}

/** Every document in these workspaces, most recently changed first, with the reader's stars. */
export async function homeDocuments(db: Db, workspaces: readonly AccessibleWorkspace[], userId = '', limit = 500): Promise<HomeDocument[]> {
  const ids = workspaces.map((w) => w.id);
  if (!ids.length) return [];
  const rows = await db.query<Row>(
    `select d.id, d.folder_id, exists (select 1 from stars s where s.document_id = d.id and s.user_id = $3) as starred, d.workspace_id, d.created_by, d.slug, d.name, d.updated_at, d.bind_sources, v.scores,
            coalesce(u.display_name, u.subject) as author,
            exists (select 1 from artifacts a where a.version_hash = v.hash and a.kind = 'bundle') as rendered,
            exists (select 1 from artifacts a where a.version_hash = v.hash and a.kind in ('view', 'svg') and a.view_id <> '') as has_thumb,
            dr.counts as drift
       from documents d
       left join versions v on v.id = d.head_version_id
       left join users u on u.id = v.author_user_id
       left join drift_reports dr on dr.document_id = d.id and dr.version_id = d.head_version_id
      where d.workspace_id = any($1::text[])
      order by d.updated_at desc, d.name
      limit $2`,
    [ids, limit, userId],
  );
  return rows.map((r) => ({
    id: r.id,
    folderId: r.folder_id,
    starred: Boolean(r.starred),
    workspaceId: r.workspace_id,
    createdBy: r.created_by,
    slug: r.slug,
    name: r.name,
    updatedAt: r.updated_at,
    views: r.scores ? Object.keys(r.scores).length : 0,
    author: r.author,
    rendered: Boolean(r.rendered),
    hasThumb: Boolean(r.has_thumb),
    sources: r.bind_sources ?? [],
    drift: r.drift ? (r.drift.missing ?? 0) + (r.drift.undeclared ?? 0) + (r.drift.mismatched ?? 0) : 0,
  }));
}

/** The reader as the hub knows them: their display name (else the subject the identity provider sent) and their email, unless it is the name already. */
export async function readerIdentity(db: Db, p: Principal): Promise<{ name: string; email?: string }> {
  const rows = await db.query<{ name: string | null; email: string | null }>('select display_name as name, email from users where id = $1', [p.userId]);
  const email = rows[0]?.email?.trim();
  const name = rows[0]?.name?.trim() || p.subject;
  return { name, ...(email && email !== name ? { email } : {}) };
}

/** Under this a view picture is all but empty: a frame and no boxes. */
export const THUMB_FLOOR_BYTES = 4000;

/**
 * The picture a card shows: the simplest view that still has something in
 * it. A card is small, so the view with the least to draw reads best
 * there, and it is usually the overview; a view under the floor is passed
 * over while another exists.
 */
export async function thumbnailArtifact(db: Db, hash: string): Promise<ArtifactRow | undefined> {
  const rows = await db.query<ArtifactRow>(
    `select * from artifacts where version_hash = $1 and kind in ('view', 'svg') and view_id <> ''
      order by (bytes < $2), bytes, view_id limit 1`,
    [hash, THUMB_FLOOR_BYTES],
  );
  return rows[0];
}

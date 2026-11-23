/** Full-text search over documents, scoped to the reader's own library: an admin finds the rest in the admin console. */
import type { Db } from './db/db.ts';
import type { Principal } from './auth/principal.ts';
import { memberWorkspaces } from './authz.ts';

export interface SearchHit {
  readonly documentId: string;
  readonly documentSlug: string;
  readonly workspaceSlug: string;
  readonly name: string;
  readonly headline: string;
  readonly rank: number;
}

export async function searchDocuments(db: Db, p: Principal, query: string, limit = 20): Promise<SearchHit[]> {
  const ids = (await memberWorkspaces(db, p)).map((w) => w.id);
  if (!ids.length || !query.trim()) return [];
  const rows = await db.query<{ id: string; slug: string; wslug: string; name: string; headline: string; rank: number }>(
    `select d.id, d.slug, w.slug as wslug, d.name,
            ts_headline('english', coalesce(v.yaml, d.name), websearch_to_tsquery('english', $1), 'MaxFragments=1, MaxWords=12, MinWords=4') as headline,
            ts_rank(d.search, websearch_to_tsquery('english', $1)) as rank
       from documents d
       join workspaces w on w.id = d.workspace_id
       left join versions v on v.id = d.head_version_id
      where d.workspace_id = any($2::text[]) and d.search @@ websearch_to_tsquery('english', $1)
      order by rank desc, d.name
      limit $3`,
    [query, ids, Math.min(limit, 100)],
  );
  return rows.map((r) => ({ documentId: r.id, documentSlug: r.slug, workspaceSlug: r.wslug, name: r.name, headline: r.headline, rank: Number(r.rank) }));
}

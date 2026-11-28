/**
 * The rows a build reads (the accepted positions, the pages that cite
 * them) and the editions it writes. No access checks here: a standard is
 * built for the whole organization, and every member may read it.
 */
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { qualifiedRef } from '@vantage/model';
import { categoryName } from '../decisions/numbering.ts';
import { PositionSchema, type Category } from '../decisions/types.ts';
import { loadStored } from '../documents/model.ts';
import type { ImportMap } from '../documents/model.ts';
import type { CitingPage, OwnLine } from './build.ts';
import type { Change, Edition, EditionBody, EditionState, Manifest, ScopeKey } from './model.ts';

interface LineRow {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly category: number;
  readonly position: unknown;
  readonly prefix: string;
  readonly categories: Category[];
  readonly workspace: string;
  readonly scope: string | null;
}

/** Every accepted record with a position in a team workspace, as its scope's own line. */
export async function ownLines(db: Db, orgId: string): Promise<OwnLine[]> {
  const rows = await db.query<LineRow>(
    `select d.id, d.number, d.title, d.category, d.position, r.prefix, r.categories, w.slug as workspace, w.scope
       from decisions d join decision_registries r on r.id = d.registry_id join workspaces w on w.id = r.workspace_id
      where d.org_id = $1 and d.position is not null and d.status = 'accepted' and w.kind = 'team' and w.disabled_at is null`,
    [orgId],
  );
  return rows.map((r) => ({
    record: r.id,
    ref: qualifiedRef(r.prefix, r.number),
    title: r.title,
    area: categoryName(r.categories, r.category) ?? String(r.category),
    workspace: r.workspace,
    from: r.scope ?? '',
    position: PositionSchema.parse(r.position),
  }));
}

/** The team workspaces, by slug. */
export async function teamWorkspaces(db: Db, orgId: string): Promise<Set<string>> {
  return new Set((await db.query<{ slug: string }>("select slug from workspaces where org_id = $1 and kind = 'team' and disabled_at is null", [orgId])).map((r) => r.slug));
}

interface PageRow {
  readonly decision_id: string;
  readonly view: string;
  readonly workspace: string;
  readonly document: string;
  readonly version_id: string;
  readonly yaml: string;
  readonly imports: ImportMap;
}

/** The doc pages in team workspaces that cite any of `records`, by address, with the records each cites. */
export async function citingPages(db: Db, orgId: string, records: ReadonlyMap<string, string>): Promise<CitingPage[]> {
  if (!records.size) return [];
  const rows = await db.query<PageRow>(
    `select c.decision_id, c.place_id as view, w.slug as workspace, d.slug as document, v.id as version_id, v.yaml, v.imports
       from decision_citations c join documents d on d.id = c.document_id join workspaces w on w.id = d.workspace_id join versions v on v.id = c.version_id
      where c.org_id = $1 and c.place_kind = 'page' and c.decision_id = any($2::text[]) and w.kind = 'team' and w.disabled_at is null`,
    [orgId, [...records.keys()]],
  );
  const views = new Map<string, Map<string, { file?: string; title: string }>>();
  const viewOf = (r: PageRow): { file?: string; title: string } | undefined => {
    let m = views.get(r.version_id);
    if (!m) {
      m = new Map((loadStored(r.yaml, r.imports).model?.views ?? []).map((v) => [v.id, { ...(v.kind === 'doc' && v.file !== undefined ? { file: v.file } : {}), title: v.title || v.id }]));
      views.set(r.version_id, m);
    }
    return m.get(r.view);
  };
  const pages = new Map<string, { title: string; records: Map<string, string> }>();
  for (const r of rows) {
    const v = viewOf(r);
    const page = `${r.workspace}/${r.document}/${v?.file ?? `#views.${r.view}`}`;
    const p = pages.get(page) ?? { title: v?.title ?? r.view, records: new Map<string, string>() };
    p.records.set(r.decision_id, records.get(r.decision_id)!);
    pages.set(page, p);
  }
  return [...pages].map(([page, p]) => ({ page, title: p.title, records: p.records }));
}

/** Whether the organization has anything a build would read or keep: a position, or an edition. */
export async function hasStandards(db: Db, orgId: string): Promise<boolean> {
  const row = await maybe<{ any: boolean }>(db, 'select exists (select 1 from decisions where org_id = $1 and position is not null) or exists (select 1 from standard_editions where org_id = $1) as any', [orgId]);
  return row?.any ?? false;
}

interface EditionRow {
  readonly scope: string;
  readonly version: number;
  readonly state: EditionState;
  readonly hash: string;
  readonly body: EditionBody;
  readonly manifest: Manifest;
  readonly changes: Change[];
  readonly problems: string[];
  readonly built_at: Date;
  readonly published_at: Date | null;
  readonly published_by: string | null;
}

const fromRow = (r: EditionRow): Edition => ({ scope: r.scope, version: r.version, state: r.state, hash: r.hash, body: r.body, manifest: r.manifest, changes: r.changes, problems: r.problems, builtAt: r.built_at, publishedAt: r.published_at, publishedBy: r.published_by });

const COLUMNS = 'scope, version, state, hash, body, manifest, changes, problems, built_at, published_at, published_by';

/** Each scope's latest published edition and its next one (pending or refused), if any. */
export async function latestEditions(db: Db, orgId: string): Promise<{ published: Map<ScopeKey, Edition>; next: Map<ScopeKey, Edition> }> {
  const rows = await db.query<EditionRow>(
    `select distinct on (scope, state = 'published') ${COLUMNS} from standard_editions where org_id = $1 order by scope, state = 'published', version desc`,
    [orgId],
  );
  const published = new Map<ScopeKey, Edition>();
  const next = new Map<ScopeKey, Edition>();
  for (const r of rows) (r.state === 'published' ? published : next).set(r.scope, fromRow(r));
  return { published, next };
}

/** One edition by number, or the latest published when `version` is absent. */
export async function editionOf(db: Db, orgId: string, scope: ScopeKey, version?: number): Promise<Edition | undefined> {
  const row =
    version === undefined
      ? await maybe<EditionRow>(db, `select ${COLUMNS} from standard_editions where org_id = $1 and scope = $2 and state = 'published' order by version desc limit 1`, [orgId, scope])
      : await maybe<EditionRow>(db, `select ${COLUMNS} from standard_editions where org_id = $1 and scope = $2 and version = $3`, [orgId, scope, version]);
  return row ? fromRow(row) : undefined;
}

export interface NewEdition {
  readonly scope: ScopeKey;
  readonly version: number;
  readonly state: EditionState;
  readonly hash: string;
  readonly body: EditionBody;
  readonly manifest: Manifest;
  readonly changes: readonly Change[];
  readonly problems: readonly string[];
  readonly by: string;
}

/** Writes an edition. A published one is fixed; a next one replaces the scope's last next one. */
export async function writeEdition(db: Db, orgId: string, e: NewEdition): Promise<void> {
  await clearNext(db, orgId, e.scope);
  await db.query(
    `insert into standard_editions (org_id, scope, version, state, hash, body, manifest, changes, problems, published_at, published_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${e.state === 'published' ? 'now()' : 'null'}, $10)`,
    [orgId, e.scope, e.version, e.state, e.hash, JSON.stringify(e.body), JSON.stringify(e.manifest), JSON.stringify(e.changes), JSON.stringify(e.problems), e.state === 'published' ? e.by : null],
  );
}

export async function clearNext(db: Db, orgId: string, scope: ScopeKey): Promise<void> {
  await db.query("delete from standard_editions where org_id = $1 and scope = $2 and state <> 'published'", [orgId, scope]);
}

/** Publishes the scope's pending edition as it stands; answers its version, or undefined when none waits. */
export async function publishPending(db: Db, orgId: string, scope: ScopeKey, by: string): Promise<number | undefined> {
  const rows = await db.query<{ version: number }>("update standard_editions set state = 'published', published_at = now(), published_by = $3 where org_id = $1 and scope = $2 and state = 'pending' returning version", [orgId, scope, by]);
  return rows[0]?.version;
}

/** Holds the organization's builds to one at a time, until the transaction ends. */
export async function lockStandards(tx: Db, orgId: string): Promise<void> {
  await tx.query("select pg_advisory_xact_lock(hashtext('standards:' || $1))", [orgId]);
}

export interface EditionSummary {
  readonly version: number;
  readonly state: EditionState;
  readonly hash: string;
  readonly lines: number;
  readonly changes: number;
  readonly problems: readonly string[];
  readonly published_at: Date | null;
  readonly published_by: string | null;
}

/** A scope's editions, newest first. */
export async function editionsOf(db: Db, orgId: string, scope: ScopeKey, limit = 20): Promise<EditionSummary[]> {
  return db.query<EditionSummary>(
    `select version, state, hash, jsonb_array_length(body->'lines') as lines, jsonb_array_length(changes) as changes, problems, published_at, published_by
       from standard_editions where org_id = $1 and scope = $2 order by version desc limit $3`,
    [orgId, scope, limit],
  );
}

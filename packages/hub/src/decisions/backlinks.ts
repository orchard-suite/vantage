/**
 * Where a record is cited from, as a reader may see it: each document and
 * the boxes and pages in it, each other record and the part of it, and the
 * boxes and views the record governs. A source in a workspace or registry
 * the reader cannot open is counted, never named.
 */
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { linksOf, placedByIds, refOf, stubOf } from './repo.ts';
import { present, reach, recordUrl, requireDecision } from './read.ts';
import type { DecisionStub, Governs } from './types.ts';
import type { PlaceKind } from './citations.ts';

export interface CitingPlace {
  readonly kind: 'box' | 'page';
  /** The box id, or the id of the doc view the page belongs to. */
  readonly id: string;
  readonly citedAs: string;
  readonly url: string;
}

export interface CitingDocument {
  readonly workspace: string;
  readonly document: string;
  readonly documentName: string;
  /** The head version the index read. */
  readonly versionId: string;
  readonly url: string;
  readonly places: readonly CitingPlace[];
}

export interface CitingRecord extends DecisionStub {
  readonly url: string;
  /** body (the record's prose names it) and related (its Related list holds it). */
  readonly places: readonly ('related' | 'body')[];
  readonly citedAs: readonly string[];
}

export interface Backlinks {
  readonly ref: string;
  readonly documents: readonly CitingDocument[];
  readonly records: readonly CitingRecord[];
  readonly governs: readonly Governs[];
  /** Documents, records, and governed documents that cite or are governed by the record, in places the reader cannot open. */
  readonly hidden: number;
}

interface CitationRow {
  readonly document_id: string | null;
  readonly version_id: string | null;
  readonly source_decision_id: string | null;
  readonly place_kind: PlaceKind;
  readonly place_id: string;
  readonly cited_as: string;
}

export function documentUrl(workspace: string, document: string, view?: string): string {
  return `/w/${encodeURIComponent(workspace)}/${encodeURIComponent(document)}${view ? `#${encodeURIComponent(view)}` : ''}`;
}

/** Every place that cites the record, with what the reader may not open counted in `hidden`. */
export async function decisionCitations(ctx: AppContext, p: Principal, ref: string): Promise<Backlinks> {
  const { row } = await requireDecision(ctx, p, ref, 'viewer');
  const seen = await reach(ctx, p);
  const rows = await ctx.db.query<CitationRow>(
    'select document_id, version_id, source_decision_id, place_kind, place_id, cited_as from decision_citations where decision_id = $1 and (source_decision_id is null or source_decision_id <> $1) order by place_kind, place_id, cited_as',
    [row.id],
  );
  const links = await linksOf(ctx.db, [row.id]);
  const docIds = [...new Set([...rows.map((r) => r.document_id), ...links.map((l) => l.document_id)].filter((x): x is string => !!x))];
  const docs = new Map(
    (docIds.length ? await ctx.db.query<{ id: string; slug: string; name: string; workspace_id: string }>('select id, slug, name, workspace_id from documents where id = any($1::text[])', [docIds]) : []).map((d) => [d.id, d]),
  );
  const hiddenSources = new Set<string>();
  const documents = new Map<string, CitingDocument & { places: CitingPlace[] }>();
  for (const r of rows) {
    if (!r.document_id) continue;
    const d = docs.get(r.document_id);
    const ws = d ? seen.slugs.get(d.workspace_id) : undefined;
    if (!d || !ws) {
      hiddenSources.add(`document:${r.document_id}`);
      continue;
    }
    let entry = documents.get(d.id);
    if (!entry) {
      entry = { workspace: ws, document: d.slug, documentName: d.name, versionId: r.version_id ?? '', url: documentUrl(ws, d.slug), places: [] };
      documents.set(d.id, entry);
    }
    entry.places.push({ kind: r.place_kind as 'box' | 'page', id: r.place_id, citedAs: r.cited_as, url: documentUrl(ws, d.slug, r.place_kind === 'page' ? r.place_id : undefined) });
  }
  const sourceRows = await placedByIds(ctx.db, p.orgId, [...new Set(rows.map((r) => r.source_decision_id).filter((x): x is string => !!x))]);
  const open = new Set(seen.registries.map((g) => g.id));
  const records: CitingRecord[] = [];
  for (const src of sourceRows.sort((a, b) => a.prefix.localeCompare(b.prefix) || a.number - b.number)) {
    if (!open.has(src.registry_id)) {
      hiddenSources.add(`decision:${src.id}`);
      continue;
    }
    const mine = rows.filter((r) => r.source_decision_id === src.id);
    records.push({
      ...stubOf(src),
      url: recordUrl(seen.slugs.get(src.workspace_id) ?? '', refOf(src)),
      places: [...new Set(mine.map((r) => (r.place_kind === 'related' ? 'related' : 'body') as 'related' | 'body'))],
      citedAs: [...new Set(mine.filter((r) => r.place_kind === 'body').map((r) => r.cited_as))],
    });
  }
  const governs = (await present(ctx, p, [row], seen))[0]!.governs;
  for (const l of links) {
    const d = docs.get(l.document_id);
    if (!d || !seen.slugs.has(d.workspace_id)) hiddenSources.add(`document:${l.document_id}`);
  }
  const sorted = [...documents.values()].sort((a, b) => a.workspace.localeCompare(b.workspace) || a.documentName.localeCompare(b.documentName));
  return { ref: refOf(row), documents: sorted, records, governs, hidden: hiddenSources.size };
}

/**
 * The citation index: where each record is cited from. A document's head
 * version is read on every save (each box's `decisions:` and each page's
 * citations), and a record on every write (its body and its Related). A
 * row names its target by id, so a record that moves keeps every row; a
 * citation that names no record yet waits with no target until one takes
 * its number.
 */
import { citableRef, machineRef, parseDecisionRef, qualifiedRef, type Model } from '@vantage/model';
import { docPages, MapAssetSource } from '@vantage/render';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/db.ts';
import { readAttachments, type Attachment } from '../documents/assets.ts';
import { loadStored, type ImportMap } from '../documents/model.ts';
import { placedById, refOf, resolveRefs, type PlacedRow } from './repo.ts';

/** What the index needs from the hub: the database it writes and the blob store a page is read from. */
export type IndexContext = Pick<AppContext, 'db' | 'log' | 'blob'>;

export type PlaceKind = 'box' | 'page' | 'related' | 'body';

/** One citation as a source writes it: the box or page (a document), or the field (a record). */
export interface Cite {
  readonly kind: PlaceKind;
  readonly id: string;
  readonly text: string;
}

/** A citation the source writes as a number the record held before it moved, and the record's citation now. */
export interface MovedCitation {
  readonly cited: string;
  readonly ref: string;
}

/** Each box's `decisions:` and each page's citations, as written. */
export function documentCites(model: Model | undefined, pages: Readonly<Record<string, Uint8Array>>): Cite[] {
  if (!model) return [];
  const out: Cite[] = [];
  for (const [id, n] of model.nodes) for (const text of n.decisions ?? []) if (citableRef(text)) out.push({ kind: 'box', id, text });
  for (const [id, page] of docPages(model, new MapAssetSource({ ...pages }))) for (const text of page.decisions) if (citableRef(text)) out.push({ kind: 'page', id, text });
  return out;
}

/** A citation token in prose: a qualified or local number, or a machine id. */
export const CITATION_TOKEN = /(?<![A-Za-z0-9-])(adr:[0-9A-Za-z]{26}|[A-Z][A-Z0-9]{1,11}-\d{4})(?![0-9A-Za-z])/g;

type RecordText = Pick<PlacedRow, 'title' | 'context' | 'decision' | 'consequences' | 'alternatives'>;

/** The prose fields of a record by name, the ones a citation can sit in. */
export function recordFields(row: RecordText): [string, string][] {
  return [
    ['title', row.title],
    ['context', row.context],
    ['decision', row.decision],
    ['consequences', row.consequences],
    ['alternatives', row.alternatives.map((a) => `${a.option}\n${a.rejected}`).join('\n')],
  ];
}

/** Every citation token in a record's prose, by field. */
export function bodyCites(row: RecordText): Cite[] {
  const out: Cite[] = [];
  for (const [field, text] of recordFields(row)) for (const m of text.matchAll(CITATION_TOKEN)) out.push({ kind: 'body', id: field, text: m[1]! });
  return out;
}

/** The canonical text of a citation: PREFIX-NNNN or adr:<ULID>; ADR-NNNN only means something in `home`, a registry prefix. */
export function canonicalRef(text: string, home?: string): string | undefined {
  const r = parseDecisionRef(text);
  if (!r) return undefined;
  if (r.kind === 'machine') return machineRef(r.id);
  if (r.kind === 'local') return home ? qualifiedRef(home, r.number) : undefined;
  return qualifiedRef(r.prefix, r.number);
}

interface Row {
  readonly cite: Cite;
  readonly ref: string;
  readonly target: PlacedRow | undefined;
  readonly alias: boolean;
}

async function resolveAll(db: Db, orgId: string, cites: readonly Cite[], home?: string): Promise<Row[]> {
  const refs = cites.map((cite) => ({ cite, ref: canonicalRef(cite.text, home) })).filter((c): c is { cite: Cite; ref: string } => c.ref !== undefined);
  const found = await resolveRefs(db, orgId, refs.map((c) => c.ref));
  return refs.map(({ cite, ref }) => ({ cite, ref, target: found.get(ref)?.row, alias: found.get(ref)?.alias ?? false }));
}

const moved = (rows: readonly Row[]): MovedCitation[] => {
  const seen = new Map<string, string>();
  for (const r of rows) if (r.alias && r.target) seen.set(r.cite.text, refOf(r.target));
  return [...seen].map(([cited, ref]) => ({ cited, ref }));
};

async function insertRows(db: Db, orgId: string, source: { documentId: string; versionId: string } | { decisionId: string }, rows: readonly Row[]): Promise<void> {
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const key = `${r.cite.kind}|${r.cite.id}|${r.cite.text}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
  if (!unique.length) return;
  // Every row in one statement: a document that cites a record from fifty boxes is one round trip.
  await db.query(
    `insert into decision_citations (org_id, decision_id, cited_ref, cited_as, document_id, version_id, source_decision_id, place_kind, place_id)
       select $1, t.decision_id, t.cited_ref, t.cited_as, $2, $3, $4, t.place_kind, t.place_id
       from unnest($5::text[], $6::text[], $7::text[], $8::text[], $9::text[]) as t(decision_id, cited_ref, cited_as, place_kind, place_id)`,
    [
      orgId,
      'documentId' in source ? source.documentId : null,
      'documentId' in source ? source.versionId : null,
      'decisionId' in source ? source.decisionId : null,
      unique.map((r) => r.target?.id ?? null),
      unique.map((r) => r.ref),
      unique.map((r) => r.cite.text),
      unique.map((r) => r.cite.kind),
      unique.map((r) => r.cite.id),
    ],
  );
}

/** The Markdown pages of a version, read from the blob store. */
export async function pageBytes(ctx: Pick<AppContext, 'blob' | 'log'>, orgId: string, attachments: readonly Attachment[]): Promise<Record<string, Uint8Array>> {
  return readAttachments(ctx, orgId, attachments.filter((a) => /\.md$/i.test(a.path)));
}

/** Indexes a document's head version in place of what it held before; answers the citations that name a moved record by an old number. */
export async function indexDocument(db: Db, orgId: string, documentId: string, versionId: string, cites: readonly Cite[]): Promise<MovedCitation[]> {
  const rows = await resolveAll(db, orgId, cites);
  await db.query('delete from decision_citations where document_id = $1', [documentId]);
  await insertRows(db, orgId, { documentId, versionId }, rows);
  await db.query('update documents set cites_version_id = $2 where id = $1', [documentId, versionId]);
  return moved(rows);
}

/** Indexes one version of a document from its text: the YAML, its imports, and its pages. */
export async function indexVersion(ctx: IndexContext, db: Db, v: { orgId: string; documentId: string; versionId: string; yaml: string; imports: ImportMap; attachments: readonly Attachment[] }): Promise<MovedCitation[]> {
  const model = loadStored(v.yaml, v.imports).model;
  return indexDocument(db, v.orgId, v.documentId, v.versionId, documentCites(model, await pageBytes(ctx, v.orgId, v.attachments)));
}

/** Indexes a record's body and Related in place of what it held before. Related is kept by id, so it is indexed in the machine form. */
export async function indexRecord(db: Db, orgId: string, decisionId: string): Promise<void> {
  const row = await placedById(db, orgId, decisionId);
  if (!row) return;
  const prefixes = new Set((await db.query<{ prefix: string }>('select prefix from decision_registries where org_id = $1', [orgId])).map((r) => r.prefix));
  // A token in prose is a citation when it names a registry here; ISO-9001 in a sentence is not one.
  const body = bodyCites(row).filter((c) => {
    const r = parseDecisionRef(c.text);
    return r !== undefined && (r.kind !== 'qualified' || prefixes.has(r.prefix));
  });
  const related: Cite[] = row.related.map((id) => ({ kind: 'related', id: 'related', text: machineRef(id) }));
  const rows = (await resolveAll(db, orgId, [...body, ...related], row.prefix)).filter((r) => r.target?.id !== decisionId);
  await db.query('delete from decision_citations where source_decision_id = $1', [decisionId]);
  await insertRows(db, orgId, { decisionId }, rows);
  await db.query('update decisions set cites_indexed = true where id = $1', [decisionId]);
}

/** Points the citations that waited for a record's number at the record, now that it holds it. */
export async function resolvePending(db: Db, orgId: string, ref: string, decisionId: string): Promise<void> {
  await db.query('update decision_citations set decision_id = $3 where org_id = $1 and decision_id is null and cited_ref = $2', [orgId, ref, decisionId]);
}

/** The citations a document's index names a moved record by, with what the record is cited as now. */
export async function movedCitationsOf(db: Db, documentId: string): Promise<MovedCitation[]> {
  const rows = await db.query<{ cited_as: string; prefix: string; number: number }>(
    `select distinct c.cited_as, r.prefix, d.number from decision_citations c join decisions d on d.id = c.decision_id join decision_registries r on r.id = d.registry_id where c.document_id = $1 order by c.cited_as`,
    [documentId],
  );
  return rows.filter((r) => !r.cited_as.toLowerCase().startsWith('adr:') && r.cited_as !== refOf(r)).map((r) => ({ cited: r.cited_as, ref: refOf(r) }));
}

/**
 * Fills the index for what it has not read: each document whose head it has not indexed and
 * each record it has never indexed. Runs with migrations, so the documents and records from
 * before the index existed are cited from the first release that has it.
 */
export async function backfillCitations(ctx: IndexContext): Promise<{ documents: number; records: number }> {
  const records = await ctx.db.query<{ id: string; org_id: string }>('select id, org_id from decisions where not cites_indexed order by id');
  for (const r of records) await ctx.db.transaction((tx) => indexRecord(tx, r.org_id, r.id));
  const docs = await ctx.db.query<{ id: string; org_id: string; version_id: string; yaml: string; imports: ImportMap; attachments: Attachment[] }>(
    'select d.id, d.org_id, v.id as version_id, v.yaml, v.imports, v.attachments from documents d join versions v on v.id = d.head_version_id where d.cites_version_id is distinct from d.head_version_id order by d.id',
  );
  for (const d of docs) {
    try {
      await ctx.db.transaction((tx) => indexVersion(ctx, tx, { orgId: d.org_id, documentId: d.id, versionId: d.version_id, yaml: d.yaml, imports: d.imports, attachments: d.attachments }));
    } catch (err) {
      ctx.log.warn('citations.backfill.failed', { documentId: d.id, error: (err as Error).message });
    }
  }
  ctx.log.info('citations.backfill.end', { documents: docs.length, records: records.length });
  return { documents: docs.length, records: records.length };
}

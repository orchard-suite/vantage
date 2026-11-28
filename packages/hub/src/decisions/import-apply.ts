/**
 * Brings a repository's Markdown decision records into a registry. Each
 * record keeps its number, dates, status, decision makers, and supersede
 * links. A dry run reports what would happen and writes nothing. Running
 * it again skips what is already there, so a migration can be repeated.
 */
import { formatNumber, qualifiedRef } from '@vantage/model';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { audit } from '../audit.ts';
import { badRequest } from '../http.ts';
import { numberProblem } from './numbering.ts';
import { insertDecision, listPlaced, lockRegistry, placedById, refOf, resolveRef, takenNumbers, updateDecisionRow } from './repo.ts';
import { recordUrl, requireRegistry } from './read.ts';
import { fieldsOf, remember, whoOf } from './write.ts';
import { dayOf } from '../day.ts';
import { isRecordFile, parseRecord, type ImportFile, type ParsedRecord } from './import.ts';
import { ulid } from './ulid.ts';

export interface ImportedRecord {
  readonly path: string;
  readonly ref: string;
  readonly url: string;
  readonly title: string;
  readonly status: string;
}

export interface ImportReport {
  readonly registry: string;
  readonly dryRun: boolean;
  readonly imported: readonly ImportedRecord[];
  /** Files already in the registry from an earlier run, by the same number and title. */
  readonly existing: readonly ImportedRecord[];
  readonly skipped: readonly { readonly path: string; readonly reason: string }[];
  readonly notes: readonly { readonly path: string; readonly note: string }[];
}

export const MAX_IMPORT_FILES = 500;

export async function importDecisions(ctx: AppContext, p: Principal, prefix: string, files: readonly ImportFile[], opts: { dryRun?: boolean } = {}): Promise<ImportReport> {
  const { row: registry, workspace } = await requireRegistry(ctx, p, prefix, opts.dryRun ? 'viewer' : 'author');
  if (files.length > MAX_IMPORT_FILES) throw badRequest(`import at most ${MAX_IMPORT_FILES} files at a time`);
  const dryRun = opts.dryRun ?? false;
  const records = files.filter((f) => isRecordFile(f.path)).map((f) => parseRecord(f, registry.prefix));
  const skipped: { path: string; reason: string }[] = files.filter((f) => !isRecordFile(f.path)).map((f) => ({ path: f.path, reason: 'not a record (an index, a template, or not Markdown)' }));
  const notes = records.flatMap((r) => r.notes.map((note) => ({ path: r.path, note })));
  const present = await listPlaced(ctx.db, [registry.id]);
  const byNumber = new Map(present.map((x) => [x.number, x]));
  const taken = await takenNumbers(ctx.db, registry.id);
  const existing: ImportedRecord[] = [];
  const keep: ParsedRecord[] = [];
  const seen = new Set<number>();
  for (const r of records) {
    if (r.number === undefined) {
      skipped.push({ path: r.path, reason: 'no record number in its file name or title' });
      continue;
    }
    // A record that moved since an earlier run is found by the number it held, as an alias.
    const there = byNumber.get(r.number) ?? (taken.includes(r.number) ? (await resolveRef(ctx.db, p.orgId, qualifiedRef(registry.prefix, r.number)))?.row : undefined);
    if (there && there.title.trim().toLowerCase() === r.title.trim().toLowerCase()) {
      existing.push({ path: r.path, ref: refOf(there), url: recordUrl(workspace, refOf(there)), title: there.title, status: there.status });
      continue;
    }
    const problem = seen.has(r.number) ? `${formatNumber(r.number)} appears twice in this import` : numberProblem(registry.categories, r.number, taken);
    if (problem) {
      skipped.push({ path: r.path, reason: problem });
      continue;
    }
    seen.add(r.number);
    keep.push(r);
  }
  const planned = keep.map((r) => ({ path: r.path, ref: refOf({ prefix: registry.prefix, number: r.number! }), url: recordUrl(workspace, refOf({ prefix: registry.prefix, number: r.number! })), title: r.title, status: r.status }));
  const report = (imported: ImportedRecord[]): ImportReport => ({ registry: registry.prefix, dryRun, imported, existing, skipped, notes });
  if (dryRun || !keep.length) return report(dryRun ? planned : []);

  await ctx.db.transaction(async (tx) => {
    await lockRegistry(tx, registry.id);
    const ids = new Map<number, string>(present.map((x) => [x.number, x.id]));
    for (const r of keep) {
      const id = ulid();
      ids.set(r.number!, id);
      await insertDecision(tx, {
        id,
        org_id: p.orgId,
        registry_id: registry.id,
        number: r.number!,
        category: Math.floor(r.number! / 1000),
        title: r.title,
        status: r.status,
        decided_on: r.decidedOn ?? null,
        updated_on: r.updatedOn ?? r.decidedOn ?? dayOf(),
        deciders: r.deciders,
        context: r.context,
        decision: r.decision,
        consequences: r.consequences,
        alternatives: r.alternatives,
        related: [],
        position: null,
        supersedes_id: null,
        created_by: p.userId,
      });
    }
    // Links between records go in once every record has an id: a file may point at one that comes later.
    for (const r of keep) {
      const id = ids.get(r.number!)!;
      const row = (await placedById(tx, p.orgId, id))!;
      const find = (n: number, what: string): string | null => {
        const target = ids.get(n);
        if (!target) notes.push({ path: r.path, note: `${what} ${formatNumber(n)}, which is not in this registry; the link was left out` });
        return target ?? null;
      };
      const supersededBy = r.supersededBy.map((n) => find(n, 'superseded by')).find((x) => x) ?? null;
      const supersedes = r.supersedes.map((n) => find(n, 'supersedes')).find((x) => x) ?? null;
      if (r.status === 'superseded' && !supersededBy && !r.supersededBy.length) notes.push({ path: r.path, note: 'superseded, but the file does not say by which record' });
      const related = [...new Set(r.related.map((n) => find(n, 'related to')).filter((x): x is string => !!x))];
      // Either file may name the link; a link the other side already set is kept, whatever order the files came in.
      await updateDecisionRow(tx, id, { ...fieldsOf(row), superseded_by_id: supersededBy ?? row.superseded_by_id, supersedes_id: supersedes ?? row.supersedes_id, related });
      if (supersededBy) {
        const next = (await placedById(tx, p.orgId, supersededBy))!;
        if (!next.supersedes_id) await updateDecisionRow(tx, next.id, { ...fieldsOf(next), supersedes_id: id });
      }
      if (supersedes) {
        const prev = (await placedById(tx, p.orgId, supersedes))!;
        if (!prev.superseded_by_id) await updateDecisionRow(tx, prev.id, { ...fieldsOf(prev), superseded_by_id: id });
      }
    }
    for (const r of keep) await remember(ctx, tx, p, ids.get(r.number!)!, `imported from ${r.path}`, 'decision.import');
    await audit(tx, ctx.log, { orgId: p.orgId, who: whoOf(p), what: 'registry.import', surface: p.surface, target: `workspace:${registry.workspace_id}`, details: { prefix: registry.prefix, imported: keep.length, skipped: skipped.length } });
  });
  ctx.log.info('decision.imported', { registry: registry.prefix, imported: keep.length, skipped: skipped.length, existing: existing.length });
  return report(planned);
}

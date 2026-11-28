/**
 * Saving a document: one version per save, optimistic concurrency against
 * the expected parent, a three-way merge when the head moved, the check
 * that refuses a version with errors, a draw of the head (one per burst), a
 * search index update, the decision citations the head makes, and an audit
 * line. Each save logs one `save.phases` line with the milliseconds of
 * every phase, whatever its outcome.
 */
import { slug as slugOf } from '@vantage/model';
import type { Db } from '../db/db.ts';
import type { AppContext } from '../context.ts';
import { channelName, maybe } from '../db/db.ts';
import { randomId, sha256 } from '../crypto.ts';
import type { Logger } from '../log.ts';
import type { Surface } from '../audit.ts';
import { audit } from '../audit.ts';
import { badRequest } from '../http.ts';
import { loadStored, loadedSources, type ImportMap } from './model.ts';
import { mergeYaml, unifiedDiff } from './merge.ts';
import { versionById, type DocumentRow, type VersionRow } from './repo.ts';
import { enqueueDraw } from '../worker/jobs.ts';
import { DOC_CHANNEL_PREFIX } from '../worker/artifacts.ts';
import { keptAttachments, overlayAttachments, type Attachment } from './assets.ts';
import type { FileMerge } from './pages.ts';
import { indexDocument, movedCitationsOf, type MovedCitation } from '../decisions/citations.ts';
import { registerKind } from '../tracking/kinds.ts';
import { rebuildStandards } from '../standards/publish.ts';
import { checkDocument, refuseErrors } from './check.ts';


export interface SaveInput {
  readonly orgId: string;
  readonly workspaceId: string;
  /** Existing document id, or undefined to create one. */
  readonly documentId?: string | undefined;
  /** Name for a new document; ignored for an existing one unless `rename` is set. */
  readonly name?: string | undefined;
  /** Slug for a new document; defaults to the slug of the name. */
  readonly slug?: string | undefined;
  readonly yaml: string;
  readonly imports?: ImportMap | undefined;
  readonly pins?: Record<string, unknown> | undefined;
  /** Files new in this save, already stored; laid over the head's files by path. Files neither the YAML nor a page names are dropped. */
  readonly attachments?: readonly Attachment[] | undefined;
  /** Files new in this save, settled against the head inside the save: a page both sides changed is merged or comes back as a conflict. One the version would not keep (no doc view or page names it) refuses the save with 400. */
  readonly files?: FileMerge | undefined;
  readonly message?: string | undefined;
  /** The version the caller edited from; undefined skips the concurrency check. */
  readonly expectedVersionId?: string | undefined;
  readonly authorUserId: string | null;
  readonly who: string;
  readonly surface: Surface;
}

export type SaveResult =
  | { status: 'saved'; document: DocumentRow; version: VersionRow; merged: boolean; /** Decision citations that name a record by a number it held before it moved. */ moved: readonly MovedCitation[] }
  | { status: 'unchanged'; document: DocumentRow; version: VersionRow; moved: readonly MovedCitation[] }
  | { status: 'conflict'; document: DocumentRow; head: VersionRow; diff: string; preview: string; conflicts: number; /** The page in conflict; absent when it is the YAML. */ path?: string };

/** Saves one version, or refuses with 422 and every error when the version it would write has any; nothing is saved then. */
export async function saveDocument(ctx: AppContext, input: SaveInput): Promise<SaveResult> {
  const { db, log } = ctx;
  log.info('save.start', { workspaceId: input.workspaceId, documentId: input.documentId ?? null, surface: input.surface, expected: input.expectedVersionId ?? null });
  const phases = new Phases();
  let status: SaveResult['status'] | 'failed' = 'failed';
  try {
    const result = await saveInTransaction(ctx, input, phases);
    phases.lap('commit');
    status = result.status;
    log.info('save.end', { status: result.status, documentId: result.document.id });
    return result;
  } finally {
    log.info('save.phases', { documentId: input.documentId ?? null, surface: input.surface, status, ms: phases.total(), phases: phases.ms });
  }
}

/** Milliseconds spent in each named phase, measured from the end of the one before. */
class Phases {
  readonly ms: Record<string, number> = {};
  private readonly started = Date.now();
  private last = this.started;

  lap(name: string): void {
    const now = Date.now();
    this.ms[name] = (this.ms[name] ?? 0) + now - this.last;
    this.last = now;
  }

  total(): number {
    return Date.now() - this.started;
  }
}

async function saveInTransaction(ctx: AppContext, input: SaveInput, phases: Phases): Promise<SaveResult> {
  const { db, log } = ctx;
  return db.transaction(async (tx) => {
    phases.lap('begin');
    let doc = input.documentId ? await maybe<DocumentRow>(tx, 'select * from documents where id = $1 for update', [input.documentId]) : undefined;
    if (input.documentId && !doc) throw new Error(`document ${input.documentId} not found`);
    const head = doc?.head_version_id ? await versionById(tx, doc.head_version_id) : undefined;
    phases.lap('lock');
    let yaml = input.yaml;
    let merged = false;
    // The version the caller read, when the head has moved since.
    const base = head && input.expectedVersionId !== undefined && input.expectedVersionId !== head.id ? await versionById(tx, input.expectedVersionId) : undefined;
    if (doc && head && input.expectedVersionId !== undefined && input.expectedVersionId !== head.id) {
      if (!base || base.document_id !== doc.id) throw new Error(`expected version ${input.expectedVersionId} does not belong to this document`);
      const m = mergeYaml(base.yaml, head.yaml, input.yaml);
      if (!m.ok) {
        log.warn('save.conflict', { documentId: doc.id, head: head.id, expected: base.id, conflicts: m.conflicts });
        return { status: 'conflict', document: doc, head, diff: unifiedDiff(`version ${base.id}`, base.yaml, `version ${head.id}`, head.yaml), preview: m.preview, conflicts: m.conflicts } satisfies SaveResult;
      }
      yaml = m.text;
      merged = true;
      log.info('save.merged', { documentId: doc.id, head: head.id, expected: base.id, changed: m.changed });
    }
    const imports = input.imports ?? head?.imports ?? {};
    phases.lap('merge');
    const files = input.files ? await input.files({ base, head }) : { attachments: [...(input.attachments ?? [])] };
    phases.lap('files');
    if ('conflict' in files) {
      if (!doc || !head) throw new Error('a new document has no head to conflict with');
      return { status: 'conflict', document: doc, head, ...files.conflict } satisfies SaveResult;
    }
    const offered = overlayAttachments(head?.attachments ?? [], files.attachments);
    // The text as it would be stored, after any merge, checked and read once on a render thread: a version with errors is never written, whichever way it came. Its reads go through this transaction.
    const scope = { orgId: input.orgId, workspaceId: input.workspaceId, attachments: offered };
    const checked = await checkDocument({ ...ctx, db: tx }, scope, { yaml, imports, save: true }, (phase) => phases.lap(phase));
    const facts = checked.save!;
    const attachments = keptAttachments(offered, facts.files);
    // A file the caller brings that the version would not keep is a mistake to name, never one to drop in silence.
    const unnamed = input.files ? unnamedFiles(files.attachments, attachments) : [];
    if (unnamed.length) {
      log.info('save.refused.unnamed', { documentId: doc?.id ?? null, paths: unnamed });
      throw badRequest(`nothing was saved: no doc view or page names ${unnamed.join(', ')}. A page needs a doc view whose file is its path; a picture needs the YAML or a page that embeds it; an artifact needs an artifacts entry`, { paths: unnamed });
    }
    refuseErrors(ctx, scope, checked);
    if (!doc) {
      const name = input.name ?? facts.title ?? 'Untitled';
      const slug = await uniqueSlug(tx, input.workspaceId, slugOf(input.slug ?? name) || 'untitled');
      const id = randomId();
      await tx.query('insert into documents (id, org_id, workspace_id, name, slug, created_by) values ($1, $2, $3, $4, $5, $6)', [id, input.orgId, input.workspaceId, name, slug, input.authorUserId]);
      doc = (await maybe<DocumentRow>(tx, 'select * from documents where id = $1', [id]))!;
      log.info('save.document.created', { documentId: id, slug });
    }
    const hash = await sha256(JSON.stringify(attachments.length ? { yaml, imports, attachments: attachments.map((a) => [a.path, a.hash]) } : { yaml, imports }));
    if (head && head.hash === hash && JSON.stringify(input.pins ?? head.pins) === JSON.stringify(head.pins)) {
      log.info('save.unchanged', { documentId: doc.id, head: head.id });
      return { status: 'unchanged', document: doc, version: head, moved: await movedCitationsOf(tx, doc.id) } satisfies SaveResult;
    }
    const id = randomId();
    await tx.query('insert into versions (id, org_id, document_id, hash, yaml, imports, pins, attachments, author_user_id, surface, message, parent_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)', [
      id,
      input.orgId,
      doc.id,
      hash,
      yaml,
      JSON.stringify(imports),
      JSON.stringify(input.pins ?? head?.pins ?? {}),
      JSON.stringify(attachments),
      input.authorUserId,
      input.surface,
      input.message ?? '',
      head?.id ?? null,
    ]);
    phases.lap('version');
    const name = input.name && input.documentId === undefined ? input.name : facts.title ?? doc.name;
    const binds = facts.binds;
    await tx.query("update documents set head_version_id = $2, name = $3, search = to_tsvector('english', $4), bind_sources = $5, updated_at = now() where id = $1", [doc.id, id, name, `${name}${facts.searchAfterName}`, JSON.stringify(binds)]);
    phases.lap('head');
    const moved = await indexDocument(tx, input.orgId, doc.id, id, facts.cites);
    // A page that cites a line is one of its procedures: the editions that carry it follow the save.
    await rebuildStandards(ctx, tx, input.orgId, input.who);
    phases.lap('citations');
    // A kind block makes the document a kind the hub enforces; a save that would break one saves nothing.
    await registerKind(tx, { orgId: input.orgId, workspaceId: input.workspaceId, documentId: doc.id, versionId: id, doc: facts.kindDocument });
    phases.lap('kind');
    const jobId = await enqueueDraw(tx, { orgId: input.orgId, kind: 'render', documentId: doc.id, payload: { versionId: id } });
    // Open viewers hear of the save as it commits, and lay the new version out themselves while the hub draws it.
    await tx.notify(channelName(DOC_CHANNEL_PREFIX, doc.id), JSON.stringify({ versionId: id, saved: true }));
    await audit(tx, log, { orgId: input.orgId, who: input.who, what: 'document.save', surface: input.surface, target: `document:${doc.id}`, details: { versionId: id, merged, message: input.message ?? '', diagnostics: facts.diagnostics } });
    phases.lap('draw');
    const version = (await versionById(tx, id))!;
    log.info('save.version.created', { documentId: doc.id, versionId: id, parent: head?.id ?? null, merged, renderJob: jobId, binds, files: attachments.length, });
    return { status: 'saved', document: { ...doc, head_version_id: id, name }, version, merged, moved } satisfies SaveResult;
  });
}

/** The paths among the files a save brought that the version does not keep. */
function unnamedFiles(brought: readonly Attachment[], kept: readonly Attachment[]): string[] {
  const held = new Set(kept.map((a) => a.path));
  return brought.map((a) => a.path).filter((path) => !held.has(path)).sort();
}

/**
 * Recomputes every document's source list from its head version, so a
 * release that reads more of a document (an `observe` block, an imported
 * file) re-renders documents saved before it. Runs with migrations.
 */
export async function refreshBindSources(db: Db, log: Logger): Promise<number> {
  const rows = await db.query<{ id: string; bind_sources: string[]; yaml: string; imports: ImportMap }>('select d.id, d.bind_sources, v.yaml, v.imports from documents d join versions v on v.id = d.head_version_id');
  let changed = 0;
  for (const r of rows) {
    const binds = loadedSources(loadStored(r.yaml, r.imports));
    if (JSON.stringify(binds) === JSON.stringify(r.bind_sources ?? [])) continue;
    await db.query('update documents set bind_sources = $2 where id = $1', [r.id, JSON.stringify(binds)]);
    changed++;
    log.info('binds.refreshed', { documentId: r.id, from: r.bind_sources, to: binds });
  }
  log.info('binds.refresh.end', { documents: rows.length, changed });
  return changed;
}

async function uniqueSlug(tx: Db, workspaceId: string, base: string): Promise<string> {
  let s = base;
  for (let i = 2; await maybe(tx, 'select 1 as x from documents where workspace_id = $1 and slug = $2', [workspaceId, s]); i++) s = `${base}-${i}`;
  return s;
}

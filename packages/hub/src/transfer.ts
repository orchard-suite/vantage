/**
 * Exit and backup: a workspace exports as a zip of YAML plus its files
 * (pictures and icon files at the paths the YAML names) and artifacts, and
 * imports from the same zip or from a single .vantage.yaml. The YAML is
 * the truth; files sit beside it so the folder renders without the hub,
 * and artifacts ride along so it reads without rendering. A file whose
 * document has errors is refused like any save and named in the outcome
 * with its errors; the files beside it still import.
 */
import { unzipSync, zipSync } from 'fflate';
import type { AppContext } from './context.ts';
import { artifactsFor, headVersion, listDocuments, documentBySlug } from './documents/repo.ts';
import { saveDocument, type SaveResult } from './documents/save.ts';
import type { Principal } from './auth/principal.ts';
import type { Surface } from './audit.ts';
import { loadStored, type ImportMap } from './documents/model.ts';
import { readAttachments, storeAssets } from './documents/assets.ts';
import { storedBundle } from './documents/derived.ts';
import { documentFiles } from '@vantage/render';
import { HttpError } from './http.ts';
import type { Finding } from './render/tasks.ts';

export interface ExportOutcome {
  readonly zip: Uint8Array;
  readonly documents: number;
  readonly files: number;
}

export async function exportWorkspace(ctx: AppContext, workspaceId: string, opts: { documentSlug?: string | undefined } = {}): Promise<ExportOutcome> {
  const log = ctx.log.child({ task: 'export', workspaceId });
  log.info('export.start', { document: opts.documentSlug ?? null });
  const docs = opts.documentSlug ? [await documentBySlug(ctx.db, workspaceId, opts.documentSlug)].filter((d) => d !== undefined) : await listDocuments(ctx.db, workspaceId);
  const files: Record<string, Uint8Array> = {};
  const enc = new TextEncoder();
  for (const doc of docs) {
    const head = await headVersion(ctx.db, doc);
    if (!head) {
      log.debug('export.skip', { documentId: doc.id, reason: 'no versions' });
      continue;
    }
    files[`${doc.slug}/${doc.slug}.vantage.yaml`] = enc.encode(head.yaml);
    for (const [path, text] of Object.entries(head.imports)) files[`${doc.slug}/imports/${path}`] = enc.encode(text);
    if (Object.keys(head.pins).length) files[`${doc.slug}/pins.json`] = enc.encode(JSON.stringify(head.pins, null, 2));
    for (const [path, bytes] of Object.entries(await readAttachments(ctx, head.org_id, head.attachments))) files[`${doc.slug}/${path}`] = bytes;
    const bundle = await storedBundle(ctx, head);
    if (bundle) files[`${doc.slug}/artifacts/bundle.json`] = enc.encode(bundle.bundle);
    for (const a of await artifactsFor(ctx.db, head.hash)) {
      // The bundle carries every view's entry.
      if (a.kind === 'bundle' || a.kind === 'view') continue;
      const bytes = await ctx.blob.get(a.blob_key);
      if (!bytes) {
        log.warn('export.artifact.missing', { key: a.blob_key });
        continue;
      }
      const name = a.kind === 'html' ? 'index.html' : `${a.view_id}.${a.kind}`;
      files[`${doc.slug}/artifacts/${name}`] = bytes;
    }
  }
  const zip = zipSync(files, { level: 6 });
  log.info('export.end', { documents: docs.length, files: Object.keys(files).length, bytes: zip.byteLength });
  return { zip, documents: docs.length, files: Object.keys(files).length };
}

export interface ImportActor {
  readonly orgId: string;
  readonly userId: string | null;
  /** Who imports; a kind's base in another workspace must be one they can read. */
  readonly writer?: Principal | undefined;
  readonly who: string;
  readonly surface: Surface;
}

export type ImportResult = { file: string; status: SaveResult['status']; document: string } | { file: string; status: 'refused'; errors: readonly Finding[] };

export interface ImportOutcome {
  readonly results: ImportResult[];
}

/** Imports a zip produced by export, or any zip holding `*.vantage.yaml` files, or one YAML text. */
export async function importWorkspace(ctx: AppContext, actor: ImportActor, workspaceId: string, input: { zip?: Uint8Array; yaml?: string; name?: string }): Promise<ImportOutcome> {
  const log = ctx.log.child({ task: 'import', workspaceId });
  const dec = new TextDecoder();
  const results: ImportOutcome['results'] = [];
  const save = async (file: string, yaml: string, imports: ImportMap, name: string | undefined, entries: Readonly<Record<string, Uint8Array>> = {}): Promise<void> => {
    const slug = file.split('/').pop()!.replace(/\.vantage\.yaml$/, '');
    const existing = await documentBySlug(ctx.db, workspaceId, slug);
    // The files the document names, in its YAML or its pages, found beside it in the zip.
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
    const model = loadStored(yaml, imports).model;
    const found: Record<string, Uint8Array> = {};
    const beside = { read: (ref: string): Uint8Array | undefined => entries[`${dir}${ref}`] };
    for (const ref of model ? documentFiles(model, beside) : []) {
      const bytes = entries[`${dir}${ref}`];
      if (bytes) found[ref] = bytes;
      else log.warn('import.file.missing', { file, ref });
    }
    const attachments = await storeAssets(ctx, actor.orgId, found);
    let r: SaveResult;
    try {
      r = await saveDocument(ctx, { orgId: actor.orgId, workspaceId, documentId: existing?.id, name, slug, yaml, imports, attachments, message: `import ${file}`, authorUserId: actor.userId, writer: actor.writer, who: actor.who, surface: actor.surface });
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 422) throw err;
      const errors = (err.details?.['errors'] ?? []) as readonly Finding[];
      results.push({ file, status: 'refused', errors });
      log.info('import.document.refused', { file, errors: errors.length });
      return;
    }
    results.push({ file, status: r.status, document: r.document.slug });
    log.info('import.document', { file, status: r.status, documentId: r.document.id, existed: Boolean(existing) });
  };
  log.info('import.start', { kind: input.zip ? 'zip' : 'yaml' });
  if (input.yaml !== undefined) {
    await save(`${input.name ?? 'document'}.vantage.yaml`, input.yaml, {}, input.name);
  } else if (input.zip) {
    const entries = unzipSync(input.zip);
    const yamlFiles = Object.keys(entries).filter((k) => k.endsWith('.vantage.yaml') && !k.includes('/imports/'));
    for (const file of yamlFiles) {
      const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
      const imports: Record<string, string> = {};
      for (const [k, v] of Object.entries(entries)) {
        if (k.startsWith(`${dir}imports/`)) imports[k.slice(`${dir}imports/`.length)] = dec.decode(v);
      }
      await save(file, dec.decode(entries[file]!), imports, undefined, entries);
    }
    if (!yamlFiles.length) log.warn('import.empty', { entries: Object.keys(entries).length });
  }
  log.info('import.end', { documents: results.length });
  return { results };
}

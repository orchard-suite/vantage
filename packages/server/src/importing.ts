/**
 * Importing a foreign drawing: read the file, build the document, and when
 * an output directory is given write the YAML beside a copy of the original
 * so the reference picture travels with the model, and beside the pictures
 * the document names.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { hasDiagramBlocks, IMPORT_EXTENSIONS, importDiagram, matchIconId, type ImportReport, type ImportResult } from '@vantage/import';
import { defaultIcons } from './core.ts';

export interface ImportFileRequest {
  /** Path of the drawing or diagram source (see `IMPORT_EXTENSIONS`). */
  readonly file: string;
  /** Directory to write `<name>.vantage.yaml` and `<name>.original.<ext>` into; nothing is written without it. */
  readonly out?: string | undefined;
  /** Import one page (zero based); default every page. */
  readonly pageIndex?: number | undefined;
}

export interface ImportFileResult extends ImportResult {
  /** Absolute paths written, when `out` was given. */
  readonly written: { readonly document: string; readonly original: string; readonly assets: readonly string[] } | undefined;
}

export function importFile(req: ImportFileRequest): ImportFileResult {
  const bytes = new Uint8Array(readFileSync(req.file));
  const sourceDir = dirname(resolve(req.file));
  const readRelative = (p: string): string | undefined => {
    const target = resolve(sourceDir, p);
    return existsSync(target) ? readFileSync(target, 'utf8') : undefined;
  };
  const result = importDiagram(bytes, { filename: basename(req.file), pageIndex: req.pageIndex, readRelative, iconResolver: resolveForeignIcon });
  if (req.out === undefined) return { ...result, written: undefined };
  const dir = resolve(req.out);
  mkdirSync(dir, { recursive: true });
  const document = join(dir, `${result.document.title ?? 'imported'}.vantage.yaml`);
  const original = join(dir, result.report.originalName);
  writeFileSync(document, result.yaml);
  writeFileSync(original, bytes);
  const assets = Object.entries(result.assets).map(([path, data]) => {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    return target;
  });
  return { ...result, written: { document, original, assets } };
}

/** The files in a folder `importFile` reads, sorted; Markdown only when it holds a mermaid or plantuml block. */
export function importableFiles(dir: string): string[] {
  const ext = new RegExp(`\\.(${IMPORT_EXTENSIONS.join('|')})$`, 'i');
  return readdirSync(dir)
    .filter((f) => ext.test(f))
    .sort()
    .map((f) => join(dir, f))
    .filter((f) => !/\.(md|markdown)$/i.test(f) || hasDiagramBlocks(readFileSync(f, 'utf8')));
}

/** A foreign icon reference (`Azure/Web/App Services.svg`, `aws/lambda`) to one of the shipped icon ids. */
export function resolveForeignIcon(hint: string): string | undefined {
  return matchIconId(hint, defaultIcons().list());
}

export type { ImportReport, ImportResult };
export { formatReport } from '@vantage/import';

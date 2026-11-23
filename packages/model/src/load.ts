/** Loads a document from disk, following imports relative to the file. */
import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { parseDocumentText } from './parse.ts';
import { resolveModel, type ImportedDocument } from './resolve.ts';
import type { Model } from './model.ts';
import type { Diagnostic } from './diagnostics.ts';
import type { Document } from './schema.ts';

/** Rewrites each parsed document, the root and every import, before it resolves: how observed values are laid over a file. */
export type DocumentTransform = (doc: Document) => Document;

export interface LoadResult {
  readonly model?: Model;
  readonly diagnostics: readonly Diagnostic[];
}

function loadImports(file: string, text: string, seen: Set<string>, diagnostics: Diagnostic[], transform: DocumentTransform | undefined): { doc?: Document; imports: ImportedDocument[] } {
  const parsed = parseDocumentText(text, file);
  diagnostics.push(...parsed.diagnostics.items.map((d) => withLine(d, parsed.locate)));
  if (!parsed.document) return { imports: [] };
  const doc = transform ? transform(parsed.document) : parsed.document;
  const imports: ImportedDocument[] = [];
  for (const imp of doc.imports ?? []) {
    const target = resolvePath(dirname(file), imp.path);
    if (seen.has(target)) {
      diagnostics.push({ severity: 'error', code: 'import-cycle', message: `${file} imports ${target} which is already being loaded`, file });
      continue;
    }
    let childText: string;
    try {
      childText = readFileSync(target, 'utf8');
    } catch {
      diagnostics.push({ severity: 'error', code: 'import-missing', message: `cannot read import ${imp.path}`, file, hint: `Expected a file at ${target}` });
      continue;
    }
    const child = loadImports(target, childText, new Set([...seen, target]), diagnostics, transform);
    if (child.doc) imports.push({ prefix: imp.as, document: child.doc, imports: child.imports });
  }
  return { doc, imports };
}

function withLine(d: Diagnostic, locate: (p: string) => { line: number; column: number } | undefined): Diagnostic {
  if (d.line !== undefined || d.path === undefined) return d;
  const pos = locate(d.path);
  return pos ? { ...d, ...pos } : d;
}

export function loadModelFromText(text: string, file = 'inline.vantage.yaml', transform?: DocumentTransform): LoadResult {
  const diagnostics: Diagnostic[] = [];
  const parsed = parseDocumentText(text, file);
  diagnostics.push(...parsed.diagnostics.items);
  if (!parsed.document) return { diagnostics };
  const model = resolveModel(transform ? transform(parsed.document) : parsed.document, [], file);
  diagnostics.push(...model.diagnostics.map((d) => withLine(d, parsed.locate)));
  return { model: { ...model, diagnostics }, diagnostics };
}

export function loadModelFromFile(file: string, transform?: DocumentTransform): LoadResult {
  const abs = resolvePath(file);
  const diagnostics: Diagnostic[] = [];
  let text: string;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    return { diagnostics: [{ severity: 'error', code: 'file-missing', message: `cannot read ${abs}` }] };
  }
  const parsed = parseDocumentText(text, abs);
  const { doc, imports } = loadImports(abs, text, new Set([abs]), diagnostics, transform);
  if (!doc) return { diagnostics };
  const model = resolveModel(doc, imports, abs);
  diagnostics.push(...model.diagnostics.map((d) => withLine(d, parsed.locate)));
  return { model: { ...model, diagnostics }, diagnostics };
}

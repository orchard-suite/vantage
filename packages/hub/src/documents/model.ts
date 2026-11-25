/**
 * From stored YAML to a resolved model. Imports live in the version row as
 * a map from the path the document names to that file's text, so the hub
 * never touches a filesystem to resolve them.
 */
import { parseDocumentText, resolveModel, type Diagnostic, type Document, type ImportedDocument, type Model, type NodeOutput } from '@vantage/model';
import { buildBundle, type BundleOptions, type Resources } from '@vantage/render';
import { expandObserved, overlayObserved, type ItemFreshness, type ObservedModel } from '@vantage/connectors';
import { sanitizeBundle } from '../sanitize.ts';

export type ImportMap = Readonly<Record<string, string>>;

/** Rewrites a parsed document before it resolves; the overlay job fills bound nodes from the observed layer here. */
export type DocumentTransform = (doc: Document) => Document;

type Locate = ReturnType<typeof parseDocumentText>['locate'];

function parseImports(text: string, file: string, imports: ImportMap, seen: ReadonlySet<string>, diagnostics: Diagnostic[], transform: DocumentTransform | undefined): { doc?: Document; children: ImportedDocument[]; locate: Locate } {
  const parsed = parseDocumentText(text, file);
  const locate = parsed.locate;
  diagnostics.push(...parsed.diagnostics.items);
  if (!parsed.document) return { children: [], locate };
  const document = transform ? transform(parsed.document) : parsed.document;
  const children: ImportedDocument[] = [];
  for (const imp of document.imports ?? []) {
    const key = normalizeImportPath(file, imp.path);
    if (seen.has(key)) {
      diagnostics.push({ severity: 'error', code: 'import-cycle', message: `${file} imports ${key} which is already being loaded`, file });
      continue;
    }
    const childText = imports[key] ?? imports[imp.path];
    if (childText === undefined) {
      diagnostics.push({ severity: 'error', code: 'import-missing', message: `import ${imp.path} is not attached to this version`, file });
      continue;
    }
    const child = parseImports(childText, key, imports, new Set([...seen, key]), diagnostics, transform);
    if (child.doc) children.push({ prefix: imp.as, document: child.doc, imports: child.children });
  }
  return { doc: document, children, locate };
}

/** The line a diagnostic's path points at in the root text, when it names none yet. */
function withLine(d: Diagnostic, locate: Locate): Diagnostic {
  if (d.line !== undefined || d.path === undefined) return d;
  const pos = locate(d.path);
  return pos ? { ...d, line: pos.line, column: pos.column } : d;
}

/** Import paths resolve relative to the importing file, within the attached map. */
export function normalizeImportPath(from: string, path: string): string {
  const base = from.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (part === '..') base.pop();
    else if (part !== '.' && part !== '') base.push(part);
  }
  return base.join('/');
}

export interface Loaded {
  readonly model?: Model;
  readonly diagnostics: readonly Diagnostic[];
  /** The root document as parsed (after the transform), for drift against the observed layer. */
  readonly document?: Document;
  /** Every file it imports, as parsed, in load order. */
  readonly imported: readonly Document[];
}

export function loadStored(yaml: string, imports: ImportMap = {}, file = 'document.vantage.yaml', transform?: DocumentTransform): Loaded {
  const diagnostics: Diagnostic[] = [];
  const { doc, children, locate } = parseImports(yaml, file, imports, new Set([file]), diagnostics, transform);
  if (!doc) return { diagnostics, imported: [] };
  const model = resolveModel(doc, children, file);
  diagnostics.push(...model.diagnostics.map((d) => withLine(d, locate)));
  const imported: Document[] = [];
  const collect = (list: readonly ImportedDocument[]): void => {
    for (const c of list) {
      imported.push(c.document);
      collect(c.imports ?? []);
    }
  };
  collect(children);
  return { model: { ...model, diagnostics }, diagnostics, document: doc, imported };
}

/** The documents of stored text, root first then every import, parsed but not resolved: cheap enough to read their binds before a render. */
export function documentsOf(yaml: string, imports: ImportMap = {}, file = 'document.vantage.yaml'): Document[] {
  const { doc, children } = parseImports(yaml, file, imports, new Set([file]), [], undefined);
  if (!doc) return [];
  const out: Document[] = [doc];
  const collect = (list: readonly ImportedDocument[]): void => {
    for (const c of list) {
      out.push(c.document);
      collect(c.imports ?? []);
    }
  };
  collect(children);
  return out;
}

export interface Overlaid extends Loaded {
  /** The root document before the observed layer, for drift. */
  readonly declared?: Document;
  /** Every file after the observed layer, root first: what the picture is drawn from. */
  readonly drawn: readonly Document[];
}

/** Loads stored text with the observed layer applied: `observe` nodes filled, then bound nodes overlaid, in the root and every import. */
/** With `fresh`, open items last reported past the threshold are marked stale. */
export function loadOverlaid(version: { readonly yaml: string; readonly imports: ImportMap }, observed: ObservedModel, fresh?: ItemFreshness): Overlaid {
  let declared: Document | undefined;
  const drawn: Document[] = [];
  const loaded = loadStored(version.yaml, version.imports, 'document.vantage.yaml', (d) => {
    declared ??= d;
    const out = overlayObserved(expandObserved(d, observed), observed, fresh);
    drawn.push(out);
    return out;
  });
  return { ...loaded, ...(declared ? { declared } : {}), drawn };
}

/**
 * The source slugs a document draws from, sorted and unique: the part of a
 * `bind` key before the first colon, and the source of an `observe` block,
 * in the document and every file it imports. A change to any of them
 * re-renders it.
 */
export function boundSources(docs: readonly Document[]): string[] {
  const out = new Set<string>();
  const walk = (nodes: readonly NodeOutput[]): void => {
    for (const n of nodes) {
      const colon = n.bind?.indexOf(':') ?? -1;
      if (n.bind !== undefined && colon > 0) out.add(n.bind.slice(0, colon));
      if (n.observe) out.add(n.observe.source);
      if (n.children) walk(n.children);
    }
  };
  for (const d of docs) walk(d.nodes);
  return [...out].sort();
}

/** The sources a loaded document and every file it imports draw from. */
export function loadedSources(loaded: Loaded): string[] {
  return boundSources(loaded.document ? [loaded.document, ...loaded.imported] : []);
}

/** The viewer bundle for a model, sanitized, drawn from the version's resources. */
export function bundleFor(model: Model, opts: BundleOptions & Required<Resources>): Record<string, unknown> {
  return sanitizeBundle(buildBundle(model, opts));
}

/** The words search indexes: names, subtitles, facts, descriptions, questions, view titles. */
export function searchText(model: Model | undefined, name: string): string {
  const parts: string[] = [name];
  if (!model) return name;
  parts.push(model.title);
  if (model.description) parts.push(model.description);
  for (const n of model.nodes.values()) {
    parts.push(n.name);
    if (n.subtitle) parts.push(n.subtitle);
    if (n.description) parts.push(n.description);
    if (n.note) parts.push(n.note);
    for (const f of n.facts) parts.push(`${f.label} ${f.value}`);
    parts.push(...n.bullets);
  }
  for (const v of model.views) {
    parts.push(v.title);
    if (v.question) parts.push(v.question);
    if (v.notes) parts.push(v.notes);
  }
  return parts.join('\n');
}

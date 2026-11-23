/**
 * YAML text to a validated Document, with every problem mapped back to a
 * line and column so an agent can fix it without guessing.
 */
import { LineCounter, isMap, isSeq, parseDocument, type Node as YamlNode, type Pair } from 'yaml';
import { DocumentSchema, type Document } from './schema.ts';
import { DiagnosticBag } from './diagnostics.ts';
import { migrateDocument } from './migrate.ts';

export interface ParseResult {
  readonly document?: Document;
  readonly diagnostics: DiagnosticBag;
  /** Finds the line and column of a path such as `views[1].relations[0].to`. */
  readonly locate: (path: string) => { line: number; column: number } | undefined;
}

type PathPart = string | number;

function splitPath(path: string): PathPart[] {
  const parts: PathPart[] = [];
  for (const m of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    if (m[1] !== undefined) parts.push(m[1]);
    else if (m[2] !== undefined) parts.push(Number(m[2]));
  }
  return parts;
}

function walk(node: YamlNode | null | undefined, parts: PathPart[]): YamlNode | Pair | undefined {
  let current: YamlNode | null | undefined = node;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (isMap(current)) {
      const pair = current.items.find((p) => String((p.key as { value?: unknown })?.value ?? p.key) === String(part));
      if (!pair) return undefined;
      if (i === parts.length - 1) return pair;
      current = pair.value as YamlNode;
    } else if (isSeq(current) && typeof part === 'number') {
      current = current.items[part] as YamlNode | undefined;
      if (current === undefined) return undefined;
    } else {
      return undefined;
    }
  }
  return current ?? undefined;
}

/**
 * The last few parses, by file and text. One save reads the same text in
 * the save, its check, the worker's read of its binds, the plan, and every
 * draw range; parsing it once per process is most of what a small edit
 * costs. A result is never changed by its callers: a transform makes a new
 * document, and diagnostics are only read.
 */
const RECENT = 8;
const recent = new Map<string, ParseResult>();

export function parseDocumentText(text: string, file?: string): ParseResult {
  const key = `${file ?? ''}\0${text}`;
  const hit = recent.get(key);
  if (hit) {
    recent.delete(key);
    recent.set(key, hit);
    return hit;
  }
  const result = parseFresh(text, file);
  recent.set(key, result);
  if (recent.size > RECENT) recent.delete(recent.keys().next().value!);
  return result;
}

function parseFresh(text: string, file?: string): ParseResult {
  const diagnostics = new DiagnosticBag(file);
  const lineCounter = new LineCounter();
  const yamlDoc = parseDocument(text, { lineCounter, keepSourceTokens: false, strict: true, uniqueKeys: true });

  const locate = (path: string): { line: number; column: number } | undefined => {
    const target = walk(yamlDoc.contents, splitPath(path));
    if (!target) return undefined;
    const ranged: YamlNode | undefined = 'range' in target ? (target as YamlNode) : ((target as Pair).key as YamlNode | undefined);
    const range = ranged?.range;
    if (!range) return undefined;
    const pos = lineCounter.linePos(range[0]);
    return { line: pos.line, column: pos.col };
  };

  for (const err of yamlDoc.errors) {
    const pos = err.linePos?.[0];
    diagnostics.error('yaml-syntax', err.message.split('\n')[0] ?? err.message, {
      ...(pos ? { line: pos.line, column: pos.col } : {}),
    });
  }
  if (diagnostics.hasErrors) return { diagnostics, locate };

  const raw = yamlDoc.toJS({ maxAliasCount: 1000 }) as unknown;
  if (raw === null || raw === undefined) {
    diagnostics.error('empty-document', 'The document is empty', { hint: 'Start with a `nodes:` list and one view under `views:`' });
    return { diagnostics, locate };
  }
  const migrated = typeof raw === 'object' && !Array.isArray(raw) ? migrateDocument(raw as Record<string, unknown>) : undefined;
  if (migrated?.error) {
    diagnostics.error('language-version', migrated.error, { path: 'vantage', ...(locate('vantage') ?? {}) });
    return { diagnostics, locate };
  }
  for (const note of migrated?.applied ?? []) diagnostics.warn('migrated', `migrated: ${note}`, { path: 'vantage' });
  const result = DocumentSchema.safeParse(migrated?.raw ?? raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('').replace(/^\./, '');
      const where = locate(path);
      diagnostics.error('schema', issue.message, {
        path,
        ...(where ?? {}),
        hint: issue.code === 'unrecognized_keys' ? 'Remove the key or check the spelling against the schema' : undefined,
      } as Partial<import('./diagnostics.ts').Diagnostic>);
    }
    return { diagnostics, locate };
  }
  return { document: result.data, diagnostics, locate };
}

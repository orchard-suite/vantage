/**
 * Editing a document by path: a list of set, add, and remove operations
 * applied in order to one text through the yaml package's Document API,
 * then saved once through the same path as a whole-text save, so an edit
 * that leaves the document with errors is refused like any save. The edited
 * document is written back over the original text by a line merge, so the
 * lines an operation did not touch keep their exact formatting and the
 * version diff reads like a hand edit.
 */
import { isMap, isScalar, isSeq, parseDocument, type Document, type YAMLMap, type YAMLSeq } from 'yaml';
import { docRefs, slug } from '@vantage/model';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/db.ts';
import type { Logger } from '../log.ts';
import type { Principal } from '../auth/principal.ts';
import type { Surface } from '../audit.ts';
import { badRequest } from '../http.ts';
import { diff3Merge } from 'node-diff3';
import { diffArrays } from 'diff';
import { headVersion, versionById, type DocumentRow } from './repo.ts';
import { saveDocument, type SaveResult } from './save.ts';
import type { Attachment } from './assets.ts';
import { loadStored, type ImportMap } from './model.ts';

const Path = z.union([z.string().min(1).max(2000), z.array(z.union([z.string().min(1), z.number().int().min(0)])).min(1).max(100)]);

export const EditOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), path: Path, value: z.unknown() }),
  z.object({ op: z.literal('add'), path: Path, value: z.unknown() }),
  z.object({ op: z.literal('remove'), path: Path }),
]);

export type EditOperation = z.infer<typeof EditOperationSchema>;

/** How an operation's path finds what it changes, in the words agents are given. */
export const EDIT_PATH_RULES = 'A path is dot separated (nodes.api.subtitle, views.context.title); in a list an item is found by its id, a node also by the slug of its name and at any depth below, or by index (relations.0).';

export const EditOperationsSchema = z.array(EditOperationSchema).min(1).max(500);

/** Where a path ends: the collection that holds the target, the key or index in it, and the target when it exists. */
interface Located {
  readonly parent: YAMLMap | YAMLSeq;
  readonly key: string | number;
  readonly node: unknown;
}

/** Applies the operations in order and returns the new text; the first failing operation throws and nothing is returned. */
export function applyEdits(yaml: string, operations: readonly EditOperation[]): string {
  const doc = parseDocument(yaml);
  if (doc.errors.length) throw badRequest(`the document does not parse: ${doc.errors[0]!.message}`);
  operations.forEach((op, i) => {
    try {
      applyOne(doc, op);
    } catch (err) {
      throw badRequest(`operation ${i} (${op.op} ${pathText(op.path)}) failed: ${(err as Error).message}; nothing was saved`, { operation: i });
    }
  });
  return writeBack(yaml, doc);
}

/** The lines a path names in a text, counting from 1: a key with its value, or a list item. Undefined when nothing is there. */
export function pathLines(yaml: string, path: string): { from: number; to: number } | undefined {
  const doc = parseDocument(yaml);
  if (doc.errors.length) throw badRequest(`the document does not parse: ${doc.errors[0]!.message}`);
  let at: Located;
  try {
    at = locate(doc, segments(path));
  } catch {
    return undefined;
  }
  const node = at.node as { range?: [number, number, number] | null } | undefined;
  if (!node?.range) return undefined;
  const pair = isMap(at.parent) ? at.parent.items.find((i) => isScalar(i.key) && String(i.key.value) === String(at.key)) : undefined;
  const keyStart = pair && isScalar(pair.key) ? pair.key.range?.[0] : undefined;
  const start = keyStart ?? node.range[0];
  // A block value's range ends at the start of the line after it.
  const end = Math.max(start, node.range[1] - 1);
  const lineOf = (offset: number): number => yaml.slice(0, offset).split('\n').length;
  return { from: lineOf(start), to: lineOf(yaml[end] === '\n' ? end - 1 : end) };
}

/** A short message naming the operations, for a version saved without one. */
export function describeEdits(operations: readonly EditOperation[]): string {
  const parts = operations.map((op) => `${op.op} ${pathText(op.path)}`);
  return `edit: ${parts.slice(0, 5).join('; ')}${parts.length > 5 ? `; and ${parts.length - 5} more` : ''}`;
}

function applyOne(doc: Document, op: EditOperation): void {
  const at = locate(doc, segments(op.path));
  const { parent, key, node } = at;
  if (op.op === 'remove') {
    if (node === undefined) throw new Error(`nothing at ${String(key)}`);
    if (isMap(parent)) parent.delete(key);
    else parent.items.splice(key as number, 1);
    return;
  }
  if (op.value === undefined) throw new Error('value is required');
  if (op.op === 'set') {
    if (isSeq(parent) && node === undefined) throw new Error(`the list has no item ${String(key)}; use add to append one`);
    if (isScalar(node) && isPrimitive(op.value)) {
      // The same node keeps its comment and its quoting.
      node.value = op.value;
      return;
    }
    if (isMap(parent)) parent.set(key, doc.createNode(op.value));
    else parent.items[key as number] = likeSiblings(parent.items, doc.createNode(op.value));
    return;
  }
  if (isSeq(node)) {
    node.add(likeSiblings(node.items, doc.createNode(op.value)));
    return;
  }
  if (isMap(node)) {
    if (!isPlainObject(op.value)) throw new Error('adding to a map takes a map of keys to add');
    for (const k of Object.keys(op.value)) if (node.has(k)) throw new Error(`key ${k} is already there; use set to change it`);
    for (const [k, v] of Object.entries(op.value)) node.set(k, doc.createNode(v));
    return;
  }
  if (node !== undefined && !(isScalar(node) && node.value === null)) throw new Error(`${String(key)} holds a value, not a list or a map; use set to change it`);
  if (isSeq(parent)) throw new Error(`the list has no item ${String(key)}`);
  parent.set(key, doc.createNode([op.value]));
}

/** A new list item written the way the list's items are: one line each when they are. */
function likeSiblings<T>(items: readonly unknown[], created: T): T {
  if ((isMap(created) || isSeq(created)) && items.some((i) => (isMap(i) || isSeq(i)) && i.flow)) created.flow = true;
  return created;
}

/** Walks the path; the last segment may name a key that does not exist yet. */
function locate(doc: Document, path: readonly (string | number)[]): Located {
  let current: unknown = doc.contents;
  let trail = '';
  for (let i = 0; i < path.length; i++) {
    const seg = path[i]!;
    const last = i === path.length - 1;
    const here = trail || 'the document';
    if (isMap(current)) {
      const key = String(seg);
      const node = current.get(key, true);
      if (last) return { parent: current, key, node };
      if (node === undefined) throw new Error(`${here} has no key ${key}`);
      current = node;
    } else if (isSeq(current)) {
      const found = findItem(current, seg);
      if (!found) throw new Error(`${here} has no item ${String(seg)} (an item is found by its id, a node also by the slug of its name, or by its index)`);
      if (last) return { parent: found.seq, key: found.index, node: found.seq.items[found.index] };
      current = found.seq.items[found.index];
    } else {
      throw new Error(`${here} is a value, not a map or a list, so it has no ${String(seg)}`);
    }
    trail = trail ? `${trail}.${String(seg)}` : String(seg);
  }
  throw new Error('the path is empty');
}

/**
 * An item of a list: by its `id`, or by the slug of its `name` when it has
 * no id (how a node's id defaults), then by index. A node id not in the
 * list itself is looked for in the `children` below it, at any depth.
 */
function findItem(seq: YAMLSeq, seg: string | number): { seq: YAMLSeq; index: number } | undefined {
  const want = String(seg);
  const direct = seq.items.findIndex((item) => itemId(item) === want);
  if (direct >= 0) return { seq, index: direct };
  if (typeof seg === 'number' || /^\d+$/.test(want)) {
    const index = Number(want);
    return index < seq.items.length ? { seq, index } : undefined;
  }
  const deep: { seq: YAMLSeq; index: number }[] = [];
  const walk = (s: YAMLSeq): void => {
    s.items.forEach((item, index) => {
      if (s !== seq && itemId(item) === want) deep.push({ seq: s, index });
      const children = isMap(item) ? item.get('children', true) : undefined;
      if (isSeq(children)) walk(children);
    });
  };
  walk(seq);
  if (deep.length > 1) throw new Error(`${deep.length} items below have the id ${want}; give the full path`);
  return deep[0];
}

function itemId(item: unknown): string | undefined {
  if (!isMap(item)) return undefined;
  const id = item.get('id');
  if (id !== undefined && id !== null) return String(id);
  const name = item.get('name');
  return typeof name === 'string' ? slug(name) : undefined;
}

/**
 * The edited document laid over the original text. Both the original and
 * the edited document are written out the same way, and the change between
 * them is merged onto the original text, so lines elsewhere stay as the
 * author wrote them. A line the edit changed is written the writer's way. When the result reads back different from the
 * edited document, the edited document is written whole.
 */
function writeBack(original: string, edited: Document): string {
  const opts = { lineWidth: 0, flowCollectionPadding: false } as const;
  const ours = edited.toString(opts);
  const base = parseDocument(original).toString(opts);
  if (ours === base) return original;
  const out: string[] = [];
  for (const region of diff3Merge(lines(ours), lines(base), lines(original))) {
    if (region.ok) out.push(...region.ok);
    else if (region.conflict) out.push(...resolve(region.conflict));
  }
  const merged = out.join('\n') + '\n';
  const back = parseDocument(merged);
  if (back.errors.length || JSON.stringify(back.toJSON()) !== JSON.stringify(edited.toJSON())) return ours;
  return merged;
}

/**
 * A region where the edit and the writer's reformatting both touch lines.
 * When the reformatting kept the line count, every line the edit left in
 * place keeps the author's text and the lines it added or changed stand;
 * otherwise the edited lines stand.
 */
function resolve(c: { a: string[]; o: string[]; b: string[] }): string[] {
  if (c.o.length !== c.b.length) return c.a;
  const out: string[] = [];
  let j = 0;
  for (const part of diffArrays(c.o, c.a)) {
    if (part.removed) j += part.count ?? part.value.length;
    else if (part.added) out.push(...part.value);
    else for (let k = 0; k < part.value.length; k++) out.push(c.b[j++]!);
  }
  return out;
}

/** The page files the doc views of a text read that the attachments do not hold. */
function missingPages(yaml: string, imports: ImportMap, attachments: readonly Attachment[]): string[] {
  const model = loadStored(yaml, imports).model;
  const held = new Set(attachments.map((a) => a.path));
  return model ? docRefs(model).filter((path) => !held.has(path)) : [];
}

function lines(text: string): string[] {
  const ls = text.split('\n');
  if (ls[ls.length - 1] === '') ls.pop();
  return ls;
}

function segments(path: string | readonly (string | number)[]): (string | number)[] {
  if (typeof path !== 'string') return [...path];
  const parts = path.split('.');
  if (parts.some((p) => p === '')) throw new Error('the path has an empty segment');
  return parts;
}

function pathText(path: string | readonly (string | number)[]): string {
  return typeof path === 'string' ? path : path.map(String).join('.');
}

function isPrimitive(v: unknown): v is string | number | boolean | null {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface EditInput {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly document: DocumentRow;
  readonly operations: readonly EditOperation[];
  readonly message?: string | undefined;
  /** The version the operations were written against; defaults to the head. */
  readonly expectedVersionId?: string | undefined;
  readonly authorUserId: string | null;
  /** Who saves; a kind's base in another workspace must be one they can read. */
  readonly writer?: Principal | undefined;
  readonly who: string;
  readonly surface: Surface;
}

/** Applies the operations to the version they were written against and saves the result as one version. */
export async function editDocument(ctx: AppContext, input: EditInput): Promise<SaveResult> {
  const { db, log } = ctx;
  const doc = input.document;
  const base = input.expectedVersionId ? await versionById(db, input.expectedVersionId) : await headVersion(db, doc);
  if (!base) throw badRequest(input.expectedVersionId ? `version ${input.expectedVersionId} not found` : `document ${doc.slug} has no version to edit; save one first`);
  if (base.document_id !== doc.id) throw badRequest(`version ${base.id} does not belong to this document`);
  log.info('edit.start', { documentId: doc.id, base: base.id, operations: input.operations.length, surface: input.surface });
  let yaml: string;
  try {
    yaml = applyEdits(base.yaml, input.operations);
  } catch (err) {
    log.warn('edit.rejected', { documentId: doc.id, base: base.id, error: (err as Error).message });
    throw err;
  }
  const head = doc.head_version_id === base.id ? base : ((await headVersion(db, doc)) ?? base);
  const unattached = missingPages(yaml, head.imports, head.attachments).filter((path) => !missingPages(base.yaml, base.imports, base.attachments).includes(path));
  if (unattached.length) {
    log.warn('edit.rejected', { documentId: doc.id, base: base.id, pages: unattached });
    throw badRequest(`nothing was saved: a doc view reads ${unattached.join(', ')}, which the document does not carry. Edits bring no files: add the view and its page together in one save (vantage_write with both, or PUT the document, with pages), or give the view its text`, { paths: unattached });
  }
  return saveDocument(ctx, {
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    documentId: doc.id,
    yaml,
    message: input.message ?? describeEdits(input.operations),
    expectedVersionId: base.id,
    authorUserId: input.authorUserId,
    writer: input.writer,
    who: input.who,
    surface: input.surface,
  });
}

/**
 * Steering edits: one typed action becomes one small change to the YAML
 * text. The document API of the yaml package edits the one view or node
 * map, and only that map's block is written back into the original text,
 * so the rest of the file stays byte for byte and the version diff reads
 * like a hand edit.
 */
import { isMap, isSeq, parseDocument, stringify, YAMLMap, YAMLSeq, type Document } from 'yaml';
import { slug } from '@vantage/model';
import { z } from 'zod';
import { badRequest } from '../http.ts';

export const GESTURES = ['auto', 'flow', 'grid', 'row', 'column', 'mirror', 'ring', 'outline', 'matrix'] as const;
export const DIRECTIONS = ['right', 'down', 'left', 'up'] as const;

const Id = z.string().min(1).max(200);
const Text = z.string().min(1).max(5000);

export const SteerActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('order'), view: Id, node: Id, order: z.array(Id).min(1) }),
  z.object({ kind: z.literal('collapse'), view: Id, node: Id, on: z.boolean() }),
  z.object({ kind: z.literal('expand'), view: Id, node: Id, on: z.boolean() }),
  z.object({ kind: z.literal('hide'), view: Id, node: Id }),
  z.object({ kind: z.literal('arrange'), view: Id, node: Id, as: z.enum(GESTURES).optional(), direction: z.enum(DIRECTIONS).optional() }),
  z.object({ kind: z.literal('note'), view: Id, text: Text, at: Id.optional() }),
  z.object({ kind: z.literal('question'), view: Id, text: z.string().max(5000) }),
  z.object({ kind: z.literal('bind'), node: Id, bind: z.string().max(500) }),
]);

export type SteerAction = z.infer<typeof SteerActionSchema>;

export interface Steered {
  readonly yaml: string;
  readonly message: string;
}

/** Applies one action to the YAML text and names the change for the version message. */
export function applySteer(yaml: string, action: SteerAction): Steered {
  const doc = parseDocument(yaml, { keepSourceTokens: true });
  if (doc.errors.length) throw badRequest('document does not parse', { errors: doc.errors.map((e) => e.message) });
  const target = action.kind === 'bind' ? findNode(doc, action.node) : findView(doc, action.view);
  const range = target.range;
  if (!range) throw badRequest('the target has no source range');
  const message = `steer: ${edit(doc, target, action)}`;
  return { yaml: splice(yaml, range[0], range[1], target), message };
}

/** The text with one map's block replaced by its re-stringified form, indented to the column where it started. */
function splice(text: string, start: number, end: number, node: YAMLMap): string {
  const column = start - text.lastIndexOf('\n', start - 1) - 1;
  const pad = ' '.repeat(column);
  const block = stringify(node, { lineWidth: 0 })
    .split('\n')
    .map((line, i) => (i === 0 || line === '' ? line : pad + line))
    .join('\n');
  const tail = text.slice(end);
  return text.slice(0, start) + (tail.startsWith('\n') || tail === '' ? block.replace(/\n$/, '') : block) + tail;
}

function edit(doc: Document, target: YAMLMap, action: SteerAction): string {
  if (action.kind === 'bind') {
    if (action.bind.trim()) target.set('bind', action.bind.trim());
    else target.delete('bind');
    return `${action.bind.trim() ? 'bind' : 'unbind'} ${action.node}`;
  }
  const view = target;
  switch (action.kind) {
    case 'order': {
      arrangement(doc, view, action.node).set('order', doc.createNode(action.order, { flow: true }));
      return `reorder ${action.node}`;
    }
    case 'collapse':
    case 'expand': {
      const other = action.kind === 'collapse' ? 'expand' : 'collapse';
      if (action.on) {
        listAdd(doc, view, action.kind, action.node);
        listRemove(view, other, action.node);
      } else listRemove(view, action.kind, action.node);
      return `${action.on ? action.kind : action.kind === 'collapse' ? 'open' : 'close'} ${action.node}`;
    }
    case 'hide': {
      listAdd(doc, view, 'hide', action.node);
      return `hide ${action.node}`;
    }
    case 'arrange': {
      const a = arrangement(doc, view, action.node);
      const said: string[] = [];
      if (action.as !== undefined) {
        a.set('as', action.as);
        said.push(`as ${action.as}`);
      }
      if (action.direction !== undefined) {
        a.set('direction', action.direction);
        said.push(`direction ${action.direction}`);
      }
      if (!said.length) throw badRequest('arrange needs as or direction');
      return `arrange ${action.node} ${said.join(', ')}`;
    }
    case 'note': {
      const seq = sequence(doc, view, 'annotations');
      seq.add(doc.createNode({ text: action.text, ...(action.at !== undefined ? { at: action.at } : {}) }, { flow: true }));
      return action.at !== undefined ? `note on ${action.at}` : `note under ${action.view}`;
    }
    case 'question': {
      if (action.text.trim()) view.set('question', action.text.trim());
      else view.delete('question');
      return `question for ${action.view}`;
    }
  }
}

function scalar(v: unknown): string | undefined {
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && 'value' in v) return scalar((v as { value: unknown }).value);
  return undefined;
}

function findView(doc: Document, id: string): YAMLMap {
  const views = doc.get('views');
  if (!isSeq(views)) throw badRequest('document has no views');
  const hit = views.items.find((v) => isMap(v) && scalar(v.get('id', true)) === id);
  if (!hit || !isMap(hit)) throw badRequest(`view ${id} not found`);
  return hit;
}

function findNode(doc: Document, id: string): YAMLMap {
  const walk = (seq: unknown): YAMLMap | undefined => {
    if (!isSeq(seq)) return undefined;
    for (const item of seq.items) {
      if (!isMap(item)) continue;
      const own = scalar(item.get('id', true)) ?? slug(scalar(item.get('name', true)) ?? '');
      if (own === id) return item;
      const deeper = walk(item.get('children'));
      if (deeper) return deeper;
    }
    return undefined;
  };
  const node = walk(doc.get('nodes'));
  if (!node) throw badRequest(`node ${id} not found in this document`);
  return node;
}

/** The sequence under `key` on the view, created when missing. */
function sequence(doc: Document, view: YAMLMap, key: string): YAMLSeq {
  const existing = view.get(key);
  if (isSeq(existing)) return existing;
  const seq = doc.createNode([]) as YAMLSeq;
  view.set(key, seq);
  return seq;
}

function listAdd(doc: Document, view: YAMLMap, key: string, id: string): void {
  const seq = sequence(doc, view, key);
  if (seq.items.some((i) => scalar(i) === id)) return;
  if (seq.items.length === 0) seq.flow = true;
  seq.add(id);
}

function listRemove(view: YAMLMap, key: string, id: string): void {
  const seq = view.get(key);
  if (!isSeq(seq)) return;
  const i = seq.items.findIndex((x) => scalar(x) === id);
  if (i >= 0) seq.items.splice(i, 1);
  if (seq.items.length === 0) view.delete(key);
}

/** The `arrange` entry for a container, created when missing. */
function arrangement(doc: Document, view: YAMLMap, node: string): YAMLMap {
  const seq = sequence(doc, view, 'arrange');
  const hit = seq.items.find((a) => isMap(a) && scalar(a.get('node', true)) === node);
  if (hit && isMap(hit)) return hit;
  const entry = doc.createNode({ node }) as YAMLMap;
  seq.add(entry);
  return entry;
}

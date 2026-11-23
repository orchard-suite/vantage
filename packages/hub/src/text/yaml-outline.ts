/**
 * A document's YAML as an outline: its top-level keys with their lines,
 * its views one per line, and its boxes as a tree of ids. It gives an
 * agent the names and line numbers to read one part or patch one line
 * without reading the file.
 */
import { isMap, isScalar, isSeq, parseDocument, type YAMLMap, type YAMLSeq } from 'yaml';
import { slug } from '@vantage/model';

const n = (x: number): string => x.toLocaleString('en-US');

/** A function from an offset in `text` to its line, counting from 1. */
function liner(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

type Ranged = { range?: [number, number, number] | null | undefined };

const str = (map: YAMLMap, key: string): string | undefined => {
  const v = map.get(key);
  return v === undefined || v === null ? undefined : String(v);
};

const idOf = (item: YAMLMap): string => str(item, 'id') ?? slug(str(item, 'name') ?? '');

function descendants(seq: YAMLSeq): number {
  let count = 0;
  for (const item of seq.items) {
    count += 1;
    const kids = isMap(item) ? item.get('children', true) : undefined;
    if (isSeq(kids)) count += descendants(kids);
  }
  return count;
}

/** The outline's lines. `room` is how many characters the boxes may take; past it the tree stops and says how much is left. */
export function yamlOutline(yaml: string, room: number): string[] {
  const doc = parseDocument(yaml);
  const top = doc.contents;
  if (doc.errors.length || !isMap(top)) return [`the YAML does not parse: ${doc.errors[0]?.message ?? 'it is not a map'}`];
  const line = liner(yaml);
  const span = (node: Ranged, start?: number): string => {
    if (!node.range) return '';
    const from = line(start ?? node.range[0]);
    const to = line(Math.max(node.range[0], node.range[1] - 1));
    return `L${from}-${to}`;
  };
  const out: string[] = [];
  const title = str(top, 'title');
  if (title) out.push(`title: ${title}`);
  const keys = top.items.map((pair) => {
    const key = isScalar(pair.key) ? String(pair.key.value) : '?';
    const value = pair.value as Ranged | null;
    const start = isScalar(pair.key) ? pair.key.range?.[0] : undefined;
    const size = isSeq(pair.value) ? ` ${pair.value.items.length}` : '';
    return `${key}${size} ${value ? span(value, start) : ''}`.trim();
  });
  out.push(`keys: ${keys.join(', ')}`);

  const views = top.get('views', true);
  if (isSeq(views)) {
    out.push('', `views (${views.items.length}); read one with #views.<id>:`);
    for (const v of views.items) {
      if (!isMap(v)) continue;
      const file = str(v, 'file');
      out.push(`  ${idOf(v)}  ${str(v, 'kind') ?? 'relation'}  ${str(v, 'title') ?? ''}  ${span(v as Ranged)}${file ? `  page ${file}` : ''}`);
    }
  }

  const nodes = top.get('nodes', true);
  if (isSeq(nodes)) {
    out.push('', `boxes (${n(descendants(nodes))}); read one with #nodes.<id>:`);
    let used = 0;
    let cut = 0;
    const walk = (seq: YAMLSeq, depth: number): void => {
      const leaves: string[] = [];
      const flush = (): void => {
        if (!leaves.length) return;
        const text = `${'  '.repeat(depth)}${leaves.join(', ')}`;
        leaves.length = 0;
        if (used + text.length > room) {
          cut += 1;
          return;
        }
        used += text.length;
        out.push(text);
      };
      for (const item of seq.items) {
        if (!isMap(item)) continue;
        const kids = item.get('children', true);
        if (!isSeq(kids) || !kids.items.length) {
          leaves.push(idOf(item));
          continue;
        }
        flush();
        const text = `${'  '.repeat(depth)}${idOf(item)} (${str(item, 'type') ?? 'group'}, ${n(descendants(kids))} below) ${span(item as Ranged)}`;
        if (used + text.length > room) {
          cut += 1;
          continue;
        }
        used += text.length;
        out.push(text);
        walk(kids, depth + 1);
      }
      flush();
    };
    walk(nodes, 1);
    if (cut) out.push(`  ${n(cut)} more group${cut === 1 ? '' : 's'} left out; vantage_find a box by name, or read #nodes.<group id>`);
  }
  const relations = top.get('relations', true);
  if (isSeq(relations)) out.push('', `relations: ${n(relations.items.length)}`);
  return out;
}

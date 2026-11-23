/**
 * A small XML walker. Enough for mxGraph and Visio OOXML: elements,
 * attributes, text, CDATA, comments, processing instructions, and the five
 * predefined entities plus numeric references. Mixed content keeps its
 * order, which Visio text runs need.
 */

export interface XmlElement {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly XmlChild[];
}

export type XmlChild = XmlElement | string;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body.startsWith('#x')) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? m;
  });
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of src.matchAll(/([^\s=\/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1]!] = decodeEntities(m[2] ?? m[3] ?? '');
  return attrs;
}

interface Open {
  readonly name: string;
  readonly attrs: Record<string, string>;
  readonly children: XmlChild[];
}

/** Parses a document and returns its root element. Throws on a malformed tag. */
export function parseXml(text: string): XmlElement {
  const stack: Open[] = [{ name: '#document', attrs: {}, children: [] }];
  let i = 0;
  const n = text.length;
  const top = (): Open => stack[stack.length - 1]!;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      pushText(top(), text.slice(i));
      break;
    }
    if (lt > i) pushText(top(), text.slice(i, lt));
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      top().children.push(text.slice(lt + 9, end < 0 ? n : end));
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (text.startsWith('<?', lt) || text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const end = closeOf(text, lt);
    if (end < 0) throw new Error(`xml: unterminated tag at ${lt}`);
    const body = text.slice(lt + 1, end);
    i = end + 1;
    if (body.startsWith('/')) {
      const name = body.slice(1).trim();
      if (stack.length < 2 || top().name !== name) throw new Error(`xml: unexpected </${name}>`);
      const done = stack.pop()!;
      top().children.push({ name: done.name, attrs: done.attrs, children: done.children });
      continue;
    }
    const selfClosing = body.endsWith('/');
    const inner = selfClosing ? body.slice(0, -1) : body;
    const space = inner.search(/\s/);
    const name = space < 0 ? inner : inner.slice(0, space);
    const attrs = space < 0 ? {} : parseAttrs(inner.slice(space));
    if (selfClosing) top().children.push({ name, attrs, children: [] });
    else stack.push({ name, attrs, children: [] });
  }
  if (stack.length !== 1) throw new Error(`xml: unclosed <${top().name}>`);
  const root = stack[0]!.children.find((c): c is XmlElement => typeof c !== 'string');
  if (!root) throw new Error('xml: no root element');
  return root;
}

/** Index of the `>` that closes the tag opening at `lt`, skipping quoted attribute values. */
function closeOf(text: string, lt: number): number {
  let quote: string | undefined;
  for (let j = lt + 1; j < text.length; j++) {
    const c = text[j]!;
    if (quote) {
      if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return j;
  }
  return -1;
}

function pushText(parent: Open, raw: string): void {
  if (raw.length === 0) return;
  parent.children.push(decodeEntities(raw));
}

export function childElements(el: XmlElement, name?: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => typeof c !== 'string' && (name === undefined || c.name === name));
}

export function firstChild(el: XmlElement, name: string): XmlElement | undefined {
  return childElements(el, name)[0];
}

/** Every element below `el` with the given name, depth first. */
export function descendants(el: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (e: XmlElement): void => {
    for (const c of childElements(e)) {
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

/** Concatenated text of an element and everything below it, in document order. */
export function textOf(el: XmlElement): string {
  return el.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
}

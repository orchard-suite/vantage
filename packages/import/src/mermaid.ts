/**
 * Mermaid to the text diagram shapes. Flowcharts become relation diagrams
 * (subgraphs are containers), sequence diagrams become sequences, C4 and
 * erDiagram become relation diagrams. Every other kind is skipped with a
 * warning that names it. Styling lines are counted and dropped.
 */
import { parseMermaidC4, parseMermaidEr } from './mermaid-structure.ts';
import { parseMermaidSequence } from './mermaid-sequence.ts';
import { edgeLabel, labelNode, ParseNotes, unquote, type FlowDirection, type RelationDiagram, type TextDiagram, type TextEdge, type TextNode } from './text-diagram.ts';
import type { Head } from '@vantage/model';

export interface MermaidParse {
  readonly diagram: TextDiagram | undefined;
  readonly notes: ParseNotes;
  /** The diagram kind from the header, such as flowchart or sequenceDiagram. */
  readonly kind: string;
}

const UNSUPPORTED = new Set(['classDiagram', 'classDiagram-v2', 'stateDiagram', 'stateDiagram-v2', 'gantt', 'pie', 'journey', 'mindmap', 'gitGraph', 'timeline', 'quadrantChart', 'requirementDiagram', 'sankey', 'sankey-beta', 'xychart', 'xychart-beta', 'block', 'block-beta', 'packet', 'packet-beta', 'kanban', 'architecture', 'architecture-beta', 'zenuml', 'radar-beta', 'treemap', 'treemap-beta']);

/** The source's lines with front matter, directives, and comments removed; the front matter title kept. */
export function mermaidLines(text: string): { lines: string[]; title: string | undefined } {
  let body = text.replace(/\r\n?/g, '\n');
  let title: string | undefined;
  const front = /^\s*---\n([\s\S]*?)\n---\s*\n/.exec(body);
  if (front) {
    title = /^title:\s*(.+)$/m.exec(front[1]!)?.[1]?.trim();
    body = body.slice(front[0].length);
  }
  body = body.replace(/%%\{[\s\S]*?\}%%/g, '');
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('%%'));
  return { lines, title: title === undefined ? undefined : unquote(title) };
}

export function parseMermaid(text: string): MermaidParse {
  const notes = new ParseNotes();
  const { lines, title } = mermaidLines(text);
  const header = lines[0] ?? '';
  const kind = header.split(/\s+/)[0]!.replace(/;$/, '');
  const rest = lines.slice(1);
  const titled = <T extends TextDiagram>(d: T): T => {
    if (title !== undefined) d.title = title;
    return d;
  };
  if (kind === 'flowchart' || kind === 'graph' || kind === 'flowchart-elk') return { diagram: titled(parseFlowchart(header, rest, notes)), notes, kind };
  if (kind === 'sequenceDiagram') return { diagram: titled(parseMermaidSequence(rest, notes)), notes, kind };
  if (/^C4(Context|Container|Component|Dynamic|Deployment)$/.test(kind)) return { diagram: titled(parseMermaidC4(rest, notes)), notes, kind };
  if (kind === 'erDiagram') return { diagram: titled(parseMermaidEr(rest, notes)), notes, kind };
  if (!kind) notes.warn('empty mermaid block; nothing imported');
  else if (UNSUPPORTED.has(kind)) notes.warn(`mermaid ${kind} is not imported; Vantage reads flowchart, sequenceDiagram, C4, and erDiagram`);
  else notes.warn(`unknown mermaid diagram "${kind}"; nothing imported`);
  return { diagram: undefined, notes, kind };
}

function headerDirection(token: string | undefined): 'right' | 'down' {
  return token === 'LR' || token === 'RL' ? 'right' : 'down';
}

const DIRECTIONS: Readonly<Record<string, FlowDirection>> = { LR: 'right', RL: 'left', TB: 'down', TD: 'down', BT: 'up' };
const IGNORED = /^(classDef|class|style|linkStyle|click|accTitle|accDescr)\b/;

/** Splits on `;` outside quotes and brackets. */
function statements(line: string): string[] {
  const out: string[] = [];
  let depth = 0, quoted = false, cur = '';
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && '[({'.includes(ch)) depth++;
    else if (!quoted && '])}'.includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === ';' && !quoted && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

interface ShapeHint {
  readonly type?: string;
  readonly shape?: NonNullable<TextNode['shape']>;
}

/** Bracket openers, longest first, with their closers and what they suggest. */
const BRACKETS: readonly { open: string; close: RegExp; hint: ShapeHint }[] = [
  { open: '(((', close: /\)\)\)/y, hint: { shape: 'circle' } },
  { open: '([', close: /\]\)/y, hint: { shape: 'pill' } },
  { open: '[[', close: /\]\]/y, hint: {} },
  { open: '[(', close: /\)\]/y, hint: { type: 'database' } },
  { open: '((', close: /\)\)/y, hint: { shape: 'circle' } },
  { open: '{{', close: /\}\}/y, hint: { shape: 'hexagon' } },
  { open: '[/', close: /[/\\]\]/y, hint: { shape: 'parallelogram' } },
  { open: '[\\', close: /[/\\]\]/y, hint: { shape: 'parallelogram' } },
  { open: '>', close: /\]/y, hint: {} },
  { open: '[', close: /\]/y, hint: {} },
  { open: '(', close: /\)/y, hint: {} },
  { open: '{', close: /\}/y, hint: { shape: 'diamond' } },
];

/** The `@{ shape: ... }` names that say what a box is. */
const NEW_SHAPES: Readonly<Record<string, ShapeHint>> = {
  cyl: { type: 'database' }, cylinder: { type: 'database' }, database: { type: 'database' }, db: { type: 'database' }, das: { type: 'storage' }, 'lin-cyl': { type: 'storage' },
  circle: { shape: 'circle' }, circ: { shape: 'circle' }, diam: { shape: 'diamond' }, diamond: { shape: 'diamond' }, decision: { shape: 'diamond' },
  hex: { shape: 'hexagon' }, hexagon: { shape: 'hexagon' }, prepare: { shape: 'hexagon' }, stadium: { shape: 'pill' }, pill: { shape: 'pill' }, terminal: { shape: 'pill' },
  doc: { shape: 'document' }, document: { shape: 'document' }, 'lean-r': { shape: 'parallelogram' }, 'lean-l': { shape: 'parallelogram' }, 'in-out': { shape: 'parallelogram' },
};

const ID = /[\p{L}\p{N}_]+(?:[-.][\p{L}\p{N}_]+)*/uy;
const TEXT_LINK = /([<ox]?)(--|==|-\.)(?![->.=]|[ox]\s)\s*(\S.*?)\s*(-{2,}|\.+-|={2,})(>|[ox](?![\p{L}\p{N}_]))?/uy;
const LINK = /([<ox]?)(-{2,}|-\.+-|={2,}|~{3,})(>|[ox](?![\p{L}\p{N}_]))?\s*(?:\|([^|]*)\|)?/uy;

interface Link {
  readonly label: string | undefined;
  readonly dotted: boolean;
  readonly invisible: boolean;
  readonly start: string;
  readonly end: string;
}

const HEAD: Readonly<Record<string, Head>> = { '<': 'filled', '>': 'filled', o: 'circle', x: 'none', '': 'none' };

function edgeOf(from: string, to: string, link: Link): TextEdge {
  const a = HEAD[link.start] ?? 'none', b = HEAD[link.end] ?? 'none';
  const both = a === 'filled' && b === 'filled';
  const heads = both || (a === 'none' && b === 'filled') ? undefined : { ...(a !== 'none' ? { from: a } : {}), ...(b !== 'filled' ? { to: b } : {}) };
  return { from, to, ...(link.label !== undefined ? { label: link.label } : {}), ...(link.dotted ? { kind: 'async' as const } : {}), ...(both ? { both: true } : {}), ...(heads ? { heads } : {}) };
}

class Scanner {
  pos = 0;
  constructor(readonly s: string) {}
  ws(): void {
    while (this.pos < this.s.length && /\s/.test(this.s[this.pos]!)) this.pos++;
  }
  eof(): boolean {
    this.ws();
    return this.pos >= this.s.length;
  }
  match(re: RegExp): RegExpExecArray | null {
    re.lastIndex = this.pos;
    const m = re.exec(this.s);
    if (m) this.pos = re.lastIndex;
    return m;
  }
  startsWith(t: string): boolean {
    return this.s.startsWith(t, this.pos);
  }
}

function parseFlowchart(header: string, lines: readonly string[], notes: ParseNotes): RelationDiagram {
  const direction = headerDirection(header.split(/\s+/)[1]?.replace(/;$/, ''));
  const entries = new Map<string, TextNode>();
  const parent = new Map<string, string | undefined>();
  const subgraphs = new Set<string>();
  const order: string[] = [];
  const stack: string[] = [];
  const edges: TextEdge[] = [];
  const arrange: { key: string; direction: FlowDirection }[] = [];

  const mention = (key: string, label: string | undefined, hint: ShapeHint): void => {
    let node = entries.get(key);
    if (!node) {
      node = labelNode(key, label);
      entries.set(key, node);
      parent.set(key, stack[stack.length - 1]);
      order.push(key);
    } else {
      if (label !== undefined && node.name === key) Object.assign(node, { ...labelNode(key, label), children: node.children });
      if (!subgraphs.has(key) && parent.get(key) === undefined && stack.length) parent.set(key, stack[stack.length - 1]);
    }
    if (hint.type !== undefined) node.type = hint.type;
    if (hint.shape !== undefined) node.shape = hint.shape;
  };

  const readNode = (sc: Scanner): string | undefined => {
    sc.ws();
    const id = sc.match(ID);
    if (!id) return undefined;
    const key = id[0];
    let label: string | undefined;
    let hint: ShapeHint = {};
    if (sc.startsWith('@{')) {
      const end = sc.s.indexOf('}', sc.pos);
      const body = sc.s.slice(sc.pos + 2, end < 0 ? undefined : end);
      sc.pos = end < 0 ? sc.s.length : end + 1;
      const shape = /\bshape:\s*([\w-]+)/.exec(body)?.[1];
      label = /\blabel:\s*("[^"]*"|[^,]+)/.exec(body)?.[1];
      hint = (shape !== undefined ? NEW_SHAPES[shape] : undefined) ?? {};
    } else {
      for (const b of BRACKETS) {
        if (!sc.startsWith(b.open)) continue;
        sc.pos += b.open.length;
        const quoted = /\s*"([^"]*)"\s*/y;
        const q = sc.match(quoted);
        let text: string;
        if (q) text = q[1]!;
        else {
          const start = sc.pos;
          let i = start;
          while (i < sc.s.length) {
            b.close.lastIndex = i;
            if (b.close.test(sc.s)) break;
            i++;
          }
          text = sc.s.slice(start, i);
          sc.pos = i;
        }
        b.close.lastIndex = sc.pos;
        const close = b.close.exec(sc.s);
        if (close) sc.pos = b.close.lastIndex;
        label = text;
        hint = b.hint;
        break;
      }
    }
    if (sc.match(/:::[\w-]+/y)) notes.ignore('class shorthands');
    mention(key, label, hint);
    return key;
  };

  const readGroup = (sc: Scanner): string[] | undefined => {
    const first = readNode(sc);
    if (first === undefined) return undefined;
    const group = [first];
    for (;;) {
      const save = sc.pos;
      sc.ws();
      if (!sc.startsWith('&')) {
        sc.pos = save;
        break;
      }
      sc.pos++;
      const next = readNode(sc);
      if (next === undefined) break;
      group.push(next);
    }
    return group;
  };

  const readLink = (sc: Scanner): Link | undefined => {
    sc.ws();
    const t = sc.match(TEXT_LINK);
    if (t) return { label: edgeLabel(t[3]), dotted: t[2] === '-.', invisible: false, start: t[1] ?? '', end: t[5] ?? '' };
    const p = sc.match(LINK);
    if (!p) return undefined;
    return { label: edgeLabel(p[4]), dotted: p[2]!.includes('.'), invisible: p[2]!.startsWith('~'), start: p[1] ?? '', end: p[3] ?? '' };
  };

  const chain = (stmt: string): void => {
    const sc = new Scanner(stmt);
    let group = readGroup(sc);
    if (!group) {
      notes.unparsed(stmt);
      return;
    }
    for (;;) {
      const link = readLink(sc);
      if (!link) break;
      const next = readGroup(sc);
      if (!next) {
        notes.unparsed(stmt);
        return;
      }
      if (link.invisible) notes.ignore('invisible links');
      else for (const a of group) for (const b of next) edges.push(edgeOf(a, b, link));
      group = next;
    }
    if (!sc.eof()) notes.unparsed(stmt);
  };

  for (const line of lines) {
    for (const stmt of statements(line)) {
      const sub = /^subgraph\b\s*(.*)$/.exec(stmt);
      if (sub) {
        const rest = sub[1]!.trim();
        const m = /^([^\s[]+)\s*\[(.*)\]$/.exec(rest);
        const key = m ? m[1]! : /^"/.test(rest) ? unquote(rest) : rest || `subgraph-${subgraphs.size + 1}`;
        const title = m ? m[2]! : rest || key;
        subgraphs.add(key);
        mention(key, title, {});
        parent.set(key, stack[stack.length - 1]);
        stack.push(key);
        continue;
      }
      if (stmt === 'end') {
        if (!stack.pop()) notes.warn('end with no open subgraph; skipped');
        continue;
      }
      const dir = /^direction\s+(\w+)$/.exec(stmt);
      if (dir) {
        const d = DIRECTIONS[dir[1]!];
        const top = stack[stack.length - 1];
        if (d && top !== undefined) arrange.push({ key: top, direction: d });
        continue;
      }
      const ignored = IGNORED.exec(stmt);
      if (ignored) {
        notes.ignore(`${ignored[1]} lines`);
        continue;
      }
      chain(stmt);
    }
  }
  if (stack.length) notes.warn(`${stack.length} subgraph${stack.length === 1 ? '' : 's'} never closed with end`);

  const roots: TextNode[] = [];
  for (const key of order) {
    const node = entries.get(key)!;
    const p = parent.get(key);
    if (p !== undefined && p !== key) entries.get(p)!.children.push(node);
    else roots.push(node);
  }
  return { kind: 'relation', title: undefined, direction, nodes: roots, edges, arrange };
}

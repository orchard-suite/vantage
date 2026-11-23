/**
 * Mermaid C4 diagrams and erDiagram to relation diagrams. C4 elements keep
 * their technology as the subtitle and their description; boundaries and
 * deployment nodes are containers. ER entities keep their attributes as
 * facts, and cardinality becomes crow's feet on the arrow ends.
 */
import type { Head } from '@vantage/model';
import { edgeLabel, labelNode, ParseNotes, unquote, type FlowDirection, type RelationDiagram, type TextEdge, type TextNode } from './text-diagram.ts';

/** Splits call arguments on commas outside quotes; named `$key=value` arguments are dropped. */
function args(s: string): string[] {
  const out: string[] = [];
  let quoted = false, cur = '';
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((a) => a.trim()).filter((a) => !a.startsWith('$')).map(unquote);
}

/** C4 element macro to the type it is, and whether its third argument is a technology. */
const ELEMENTS: Readonly<Record<string, { type: string; techn: boolean }>> = {
  Person: { type: 'actor', techn: false }, Person_Ext: { type: 'actor', techn: false },
  System: { type: 'system', techn: false }, System_Ext: { type: 'external', techn: false },
  SystemDb: { type: 'database', techn: false }, SystemDb_Ext: { type: 'database', techn: false },
  SystemQueue: { type: 'queue', techn: false }, SystemQueue_Ext: { type: 'queue', techn: false },
  Container: { type: 'service', techn: true }, Container_Ext: { type: 'external', techn: true },
  ContainerDb: { type: 'database', techn: true }, ContainerDb_Ext: { type: 'database', techn: true },
  ContainerQueue: { type: 'queue', techn: true }, ContainerQueue_Ext: { type: 'queue', techn: true },
  Component: { type: 'component', techn: true }, Component_Ext: { type: 'external', techn: true },
  ComponentDb: { type: 'database', techn: true }, ComponentDb_Ext: { type: 'database', techn: true },
  ComponentQueue: { type: 'queue', techn: true }, ComponentQueue_Ext: { type: 'queue', techn: true },
};
const BOUNDARIES = /^(Boundary|Enterprise_Boundary|System_Boundary|Container_Boundary|Deployment_Node|Node|Node_L|Node_R)$/;
const RELATION = /^(Bi)?Rel(Index)?(_Back|_Neighbor|_[UDLR]|_Up|_Down|_Left|_Right)?$/;
const STYLE = /^(UpdateElementStyle|UpdateRelStyle|UpdateLayoutConfig|UpdateBoundaryStyle|AddElementTag|AddRelTag|AddBoundaryTag|SHOW_LEGEND|LAYOUT_\w+)$/;

export function parseMermaidC4(lines: readonly string[], notes: ParseNotes): RelationDiagram {
  const roots: TextNode[] = [];
  const stack: TextNode[] = [];
  const edges: TextEdge[] = [];
  let title: string | undefined;
  const add = (node: TextNode): void => {
    const top = stack[stack.length - 1];
    if (top) top.children.push(node);
    else roots.push(node);
  };
  for (const line of lines) {
    if (line === '}') {
      if (!stack.pop()) notes.warn('} with no open boundary; skipped');
      continue;
    }
    const t = /^title\s+(.+)$/.exec(line);
    if (t) {
      title = t[1]!.trim();
      continue;
    }
    const call = /^(\w+)\s*\((.*)\)\s*(\{)?\s*$/.exec(line);
    if (!call) {
      notes.unparsed(line);
      continue;
    }
    const [, macro = '', body = '', open] = call;
    const a = args(body);
    const element = ELEMENTS[macro];
    if (element) {
      const [key = '', label, third, fourth] = a;
      const node = labelNode(key, label ?? key);
      node.type = element.type;
      const techn = element.techn ? third : undefined;
      const description = element.techn ? fourth : third;
      if (techn) node.subtitle = techn;
      if (description) node.description = description;
      add(node);
      if (open) stack.push(node);
      continue;
    }
    if (BOUNDARIES.test(macro)) {
      const [key = '', label, kind, description] = a;
      const node = labelNode(key, label ?? key);
      if (macro.includes('Node') && kind) node.subtitle = kind;
      if (description) node.description = description;
      add(node);
      if (open) stack.push(node);
      continue;
    }
    const rel = RELATION.exec(macro);
    if (rel) {
      const rest = rel[2] ? a.slice(1) : a;
      const [from = '', to = '', label, techn] = rest;
      const back = rel[3] === '_Back';
      edges.push({ from: back ? to : from, to: back ? from : to, ...(edgeLabel(label) !== undefined ? { label: edgeLabel(label) } : {}), ...(techn ? { description: techn } : {}), ...(rel[1] ? { both: true } : {}) });
      continue;
    }
    if (STYLE.test(macro)) {
      notes.ignore('style and layout macros');
      continue;
    }
    notes.unparsed(line);
  }
  if (stack.length) notes.warn(`${stack.length} boundar${stack.length === 1 ? 'y' : 'ies'} never closed with }`);
  return { kind: 'relation', title, direction: 'down', nodes: roots, edges, arrange: [] };
}

const CARDINALITY: Readonly<Record<string, Head>> = { '|o': 'zero-or-one', 'o|': 'zero-or-one', '||': 'one', '}o': 'many', 'o{': 'many', '}|': 'one-or-many', '|{': 'one-or-many' };
const ER_RELATION = /^("[^"]+"|[\w-]+)\s*(\|o|\|\||\}o|\}\|)(--|\.\.)(o\||\|\||o\{|\|\{)\s*("[^"]+"|[\w-]+)\s*:\s*(.+)$/;
const ENTITY = /^("[^"]+"|[\w-]+)\s*(?:\[\s*("[^"]*"|[^\]]*)\s*\])?\s*(\{)?\s*(\})?$/;
const DIRECTIONS: Readonly<Record<string, 'right' | 'down'>> = { LR: 'right', RL: 'right', TB: 'down', TD: 'down', BT: 'down' };

export function parseMermaidEr(lines: readonly string[], notes: ParseNotes): RelationDiagram {
  const entities = new Map<string, TextNode>();
  const edges: TextEdge[] = [];
  let direction: 'right' | 'down' = 'down';
  let open: TextNode | undefined;
  const entity = (raw: string, alias?: string): TextNode => {
    const key = unquote(raw);
    let node = entities.get(key);
    if (!node) {
      node = labelNode(key, alias ?? key);
      node.shape = 'box';
      entities.set(key, node);
    } else if (alias !== undefined) node.name = unquote(alias);
    return node;
  };
  for (const line of lines) {
    if (open) {
      if (line === '}') {
        open = undefined;
        continue;
      }
      const attr = /^([\w()[\],-]+)\s+([\w-]+)((?:\s+(?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*)?)\s*(?:"([^"]*)")?$/.exec(line);
      if (attr) open.facts = [...(open.facts ?? []), `${attr[2]}: ${attr[1]}${attr[3] ? ` ${attr[3].trim().replace(/\s*,\s*/g, ',')}` : ''}`];
      else notes.unparsed(line);
      continue;
    }
    const dir = /^direction\s+(\w+)$/.exec(line);
    if (dir) {
      direction = DIRECTIONS[dir[1]!] ?? direction;
      continue;
    }
    if (/^(title|accTitle|accDescr)\b/.test(line)) continue;
    if (/^(style|classDef|class)\b/.test(line)) {
      notes.ignore('style lines');
      continue;
    }
    const rel = ER_RELATION.exec(line);
    if (rel) {
      const from = entity(rel[1]!), to = entity(rel[5]!);
      edges.push({ from: from.key, to: to.key, ...(edgeLabel(rel[6]) !== undefined ? { label: edgeLabel(rel[6]) } : {}), heads: { from: CARDINALITY[rel[2]!]!, to: CARDINALITY[rel[4]!]! } });
      continue;
    }
    const ent = ENTITY.exec(line);
    if (ent) {
      const node = entity(ent[1]!, ent[2] !== undefined ? unquote(ent[2]) : undefined);
      if (ent[3] && !ent[4]) open = node;
      continue;
    }
    notes.unparsed(line);
  }
  if (open) notes.warn(`entity ${open.name} never closed with }`);
  const arrange: { key: string; direction: FlowDirection }[] = [];
  return { kind: 'relation', title: undefined, direction, nodes: [...entities.values()], edges, arrange };
}

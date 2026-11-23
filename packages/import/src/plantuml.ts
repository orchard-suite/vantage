/**
 * PlantUML to the text diagram shapes. Each `@startuml ... @enduml` is one
 * diagram. Component and deployment diagrams become relation diagrams
 * (`{ ... }` nesting is containment), sequence diagrams become sequences.
 * Class, use case, state, activity, and the non-UML kinds are skipped
 * with a warning that names them.
 */
import { parsePlantumlSequence } from './plantuml-sequence.ts';
import { declName, readArrow, strip } from './plantuml-syntax.ts';
import { labelNode, ParseNotes, unquote, type RelationDiagram, type TextDiagram, type TextEdge, type TextNode } from './text-diagram.ts';

export interface PlantumlParse {
  readonly diagram: TextDiagram | undefined;
  readonly notes: ParseNotes;
  readonly kind: string;
}

/** Each diagram in the source: its start tag's name, and its lines without comments. */
export function plantumlSections(text: string): { tag: string; name: string | undefined; lines: string[] }[] {
  const clean = text.replace(/\r\n?/g, '\n').replace(/\/'[\s\S]*?'\//g, '');
  const sections: { tag: string; name: string | undefined; lines: string[] }[] = [];
  let current: { tag: string; name: string | undefined; lines: string[] } | undefined;
  const loose: string[] = [];
  for (const raw of clean.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith("'")) continue;
    const start = /^@start(\w+)\s*(.*)$/.exec(line);
    if (start) {
      current = { tag: start[1]!.toLowerCase(), name: start[2]!.trim() ? unquote(start[2]!.trim()) : undefined, lines: [] };
      sections.push(current);
      continue;
    }
    if (/^@end\w+/.test(line)) {
      current = undefined;
      continue;
    }
    (current?.lines ?? loose).push(line);
  }
  // A Markdown block may leave out @startuml; the whole block is then one diagram.
  if (!sections.length && loose.length) sections.push({ tag: 'uml', name: undefined, lines: loose });
  return sections;
}

const COMPONENT_HINTS = /^(component|node|cloud|rectangle|package|frame|folder|interface|artifact|storage|file|card|agent|stack|hexagon|left to right direction|top to bottom direction)\b|^\[[^\]]+\]|^\(\)|\{$/;
const SEQUENCE_HINTS = /^(participant|boundary|control|entity|collections|activate|deactivate|autonumber|return|alt|loop|opt|par|group|critical|break|ref over|box|newpage|hide footbox)\b|^==.*==$|^\.\.\.|^\|\|\||^[rh]?note\s+over\b/i;
const OTHER_KINDS: readonly [RegExp, string][] = [
  [/^(class|abstract|enum|annotation|interface\s+\w+\s*\{)\b/, 'class diagram'],
  [/^(usecase\b|\([^)]+\))/, 'use case diagram'],
  [/^(state\b|\[\*\])/, 'state diagram'],
  [/^(start$|stop$|:.*;$|if\s*\(|repeat\b|fork\b)/, 'activity diagram'],
  [/^(object|map|json)\b/, 'object diagram'],
];

export function parsePlantuml(text: string): PlantumlParse[] {
  return plantumlSections(text).map((s) => {
    const notes = new ParseNotes();
    if (s.tag !== 'uml') {
      notes.warn(`PlantUML @start${s.tag} is not imported; Vantage reads component, deployment, and sequence diagrams`);
      return { diagram: undefined, notes, kind: s.tag };
    }
    const lines = stripBlocks(s.lines, notes);
    const component = lines.some((l) => COMPONENT_HINTS.test(l));
    const sequence = lines.some((l) => SEQUENCE_HINTS.test(l));
    const other = OTHER_KINDS.find(([re]) => lines.some((l) => re.test(l)))?.[1];
    let diagram: TextDiagram | undefined;
    let kind: string;
    if (component) {
      kind = 'component';
      diagram = parseComponent(lines, notes);
    } else if (sequence || other === undefined) {
      kind = 'sequence';
      diagram = parsePlantumlSequence(lines, notes);
    } else {
      kind = other;
      notes.warn(`PlantUML ${other} is not imported; Vantage reads component, deployment, and sequence diagrams`);
    }
    if (diagram && diagram.title === undefined && s.name !== undefined) diagram.title = s.name;
    return { diagram, notes, kind };
  });
}

/** Removes multi-line blocks that carry no structure: skinparam, legend, header, footer, and style blocks. */
function stripBlocks(lines: readonly string[], notes: ParseNotes): string[] {
  const out: string[] = [];
  let skipping: RegExp | undefined;
  let depth = 0;
  for (const line of lines) {
    if (skipping) {
      if (line.endsWith('{')) depth++;
      if (skipping.test(line) && --depth <= 0) skipping = undefined;
      continue;
    }
    if (/^skinparam\b.*\{$/.test(line) || /^<style>/.test(line)) {
      notes.ignore('skinparam lines');
      skipping = line.startsWith('<style>') ? /^<\/style>/ : /^\}$/;
      depth = 1;
      continue;
    }
    if (/^(legend|header|footer)\b/.test(line) && !/^(header|footer)\s+\S/.test(line)) {
      notes.ignore(`${line.split(/\s/)[0]} blocks`);
      skipping = /^end(legend|header|footer)$/;
      depth = 1;
      continue;
    }
    if (/^(skinparam|hide|show|scale|!|sprite|caption|header|footer|allowmixing|set\s+separator)\b/.test(line) || line.startsWith('!')) {
      notes.ignore(`${line.startsWith('!') ? (line.split(/\s/)[0] ?? '!') : line.split(/\s/)[0]} lines`);
      continue;
    }
    out.push(line);
  }
  return out;
}

const ELEMENT = /^(component|node|database|queue|actor|cloud|rectangle|package|frame|folder|interface|artifact|storage|file|card|agent|stack|hexagon|person|boundary|control|entity|collections|label)\s+(.+?)\s*(\{)?$/;
const TYPES: Readonly<Record<string, string>> = {
  component: 'component', node: 'host', database: 'database', queue: 'queue', actor: 'actor', person: 'actor', cloud: 'cloud',
  package: 'package', interface: 'interface', artifact: 'file', file: 'file', storage: 'storage', stack: 'queue',
};
const GROUPING = new Set(['rectangle', 'frame', 'folder', 'package', 'card', 'agent', 'hexagon', 'label']);

function parseComponent(lines: readonly string[], notes: ParseNotes): RelationDiagram {
  const roots: TextNode[] = [];
  const stack: (TextNode | undefined)[] = [];
  const nodes = new Map<string, TextNode>();
  const edges: TextEdge[] = [];
  let title: string | undefined;
  let direction: 'right' | 'down' = 'down';
  const add = (node: TextNode): void => {
    const top = [...stack].reverse().find((s) => s !== undefined);
    if (top) top.children.push(node);
    else roots.push(node);
  };
  const declare = (key: string, label: string, keyword: string, stereotype: string | undefined): TextNode => {
    let node = nodes.get(key);
    if (!node) {
      node = labelNode(key, label);
      nodes.set(key, node);
      add(node);
    }
    const type = TYPES[keyword];
    if (type !== undefined) node.type = type;
    if (stereotype !== undefined && node.subtitle === undefined) node.subtitle = stereotype;
    return node;
  };
  /** An endpoint as written to a key: an alias, or a name already declared, or a new box. */
  const endpoint = (raw: string): string => {
    const t = raw.trim();
    const name = strip(t.startsWith('()') ? t.slice(2) : t);
    const known = nodes.get(name) ?? [...nodes.values()].find((n) => n.name === name);
    if (known) return known.key;
    const keyword = t.startsWith('()') ? 'interface' : t.startsWith('[') ? 'component' : t.startsWith(':') ? 'actor' : '';
    return declare(name, name, keyword, undefined).key;
  };
  let notesOpen = false;
  for (const line of lines) {
    if (notesOpen) {
      if (/^end\s?note$/i.test(line)) notesOpen = false;
      continue;
    }
    if (/^note\b/i.test(line)) {
      notes.ignore('notes');
      if (!line.includes(':')) notesOpen = true;
      continue;
    }
    if (line === '}') {
      if (!stack.length) notes.warn('} with nothing open; skipped');
      stack.pop();
      continue;
    }
    const t = /^title\s+(.+)$/.exec(line);
    if (t) {
      title = t[1]!.trim();
      continue;
    }
    if (line === 'left to right direction') {
      direction = 'right';
      continue;
    }
    if (line === 'top to bottom direction') {
      direction = 'down';
      continue;
    }
    if (/^together\s*\{$/.test(line)) {
      stack.push(undefined);
      continue;
    }
    const el = ELEMENT.exec(line);
    if (el && !readArrow(line)) {
      const { key, label, stereotype } = declName(el[2]!);
      const node = declare(key, label, el[1]!, stereotype);
      if (el[3]) {
        if (GROUPING.has(el[1]!) && node.type === undefined) node.type = 'group';
        stack.push(node);
      }
      continue;
    }
    const shorthand = /^(\[[^\]]+\]|\(\)\s*.+?|:[^:]+:)(?:\s+as\s+(\S+))?$/.exec(line);
    if (shorthand && !readArrow(line)) {
      const raw = shorthand[1]!;
      const keyword = raw.startsWith('[') ? 'component' : raw.startsWith('()') ? 'interface' : 'actor';
      const label = strip(raw.startsWith('()') ? raw.slice(2) : raw);
      declare(shorthand[2] !== undefined ? strip(shorthand[2]) : label, label, keyword, undefined);
      continue;
    }
    const arrow = readArrow(line);
    if (arrow) {
      if (/hidden/.test(arrow.body)) {
        notes.ignore('hidden arrows');
        continue;
      }
      const from = endpoint(arrow.from), to = endpoint(arrow.to);
      const back = arrow.start.startsWith('<') && !arrow.end.startsWith('>');
      const both = arrow.start.startsWith('<') && arrow.end.startsWith('>');
      const dotted = arrow.body.includes('.') || /dashed|dotted/.test(arrow.body);
      const headless = !arrow.start && !arrow.end;
      edges.push({ from: back ? to : from, to: back ? from : to, ...(arrow.label !== undefined ? { label: arrow.label } : {}), ...(dotted ? { kind: 'async' as const } : {}), ...(both ? { both: true } : {}), ...(headless ? { heads: { to: 'none' as const } } : {}) });
      continue;
    }
    notes.unparsed(line);
  }
  if (stack.length) notes.warn(`${stack.length} block${stack.length === 1 ? '' : 's'} never closed with }`);
  return { kind: 'relation', title, direction, nodes: roots, edges, arrange: [] };
}

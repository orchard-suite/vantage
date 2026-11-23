/**
 * Text diagram formats (Mermaid, PlantUML) to a Vantage document. Each
 * parser turns its source into the small shapes below: relation diagrams
 * (a tree of boxes and the arrows between them) and sequence diagrams
 * (participants and steps). One builder turns those into nodes and views,
 * so every text format names, merges, and reports the same way. Text
 * formats have no geometry: no pins, the engine lays every view out.
 */
import type { DocumentInput, Head, NodeInput, RelationInput, SequenceStepInput } from '@vantage/model';
import { IdPool, type PageReport, type RelationViewInput } from './build.ts';
import { htmlToLines, partsOf } from './text.ts';

/** A box as a text format declares it. `key` is the source's own id, unique within one diagram. */
export interface TextNode {
  readonly key: string;
  name: string;
  type?: string | undefined;
  shape?: NonNullable<NodeInput['shape']> | undefined;
  subtitle?: string | undefined;
  description?: string | undefined;
  facts?: string[] | undefined;
  readonly children: TextNode[];
}

export interface TextEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string | undefined;
  readonly description?: string | undefined;
  readonly kind?: 'async' | undefined;
  readonly both?: boolean | undefined;
  readonly heads?: { from?: Head; to?: Head } | undefined;
}

export type FlowDirection = 'right' | 'down' | 'left' | 'up';

export interface RelationDiagram {
  readonly kind: 'relation';
  title: string | undefined;
  readonly direction: 'right' | 'down' | undefined;
  readonly nodes: TextNode[];
  readonly edges: TextEdge[];
  /** Containers that set their own flow direction. */
  readonly arrange: readonly { readonly key: string; readonly direction: FlowDirection }[];
}

export interface SequenceDiagram {
  readonly kind: 'sequence';
  title: string | undefined;
  /** Declared and used participants, left to right. */
  readonly participants: TextNode[];
  /** Steps whose from, to, over, and destroy are participant keys. */
  readonly steps: SequenceStepInput[];
}

export type TextDiagram = RelationDiagram | SequenceDiagram;

/** What a parser could not carry: warnings, and lines it skipped on purpose, counted by what they were. */
export class ParseNotes {
  readonly warnings: string[] = [];
  private readonly ignored = new Map<string, number>();
  private readonly unknown: string[] = [];

  warn(message: string): void {
    this.warnings.push(message);
  }

  ignore(what: string): void {
    this.ignored.set(what, (this.ignored.get(what) ?? 0) + 1);
  }

  unparsed(line: string): void {
    this.unknown.push(line);
  }

  /** Every note as report lines, with a prefix that says where they came from. */
  lines(prefix: string): string[] {
    const out = [...this.warnings];
    if (this.ignored.size) out.push(`ignored ${[...this.ignored].map(([w, n]) => `${n} ${w}`).join(', ')}: Vantage draws these its own way or has no place for them; set type or color on a node for styling`);
    for (const l of this.unknown.slice(0, 10)) out.push(`line not understood, skipped: ${l}`);
    if (this.unknown.length > 10) out.push(`${this.unknown.length - 10} more lines not understood`);
    return out.map((l) => `${prefix}${l}`);
  }
}

/** A label as written (quotes, `<br>`, entities, markdown bold) to name and parts. */
export function labelNode(key: string, raw: string | undefined): TextNode {
  const text = unquote(raw ?? key).replace(/\\n/g, '<br>').replace(/\*\*|__|`/g, '');
  const lines = htmlToLines(text);
  const parts = partsOf(lines.length ? lines : [key]);
  return {
    key,
    name: parts.name,
    ...(parts.subtitle !== undefined ? { subtitle: parts.subtitle } : {}),
    ...(parts.description !== undefined || parts.bullets.length ? { description: [parts.description, ...parts.bullets].filter(Boolean).join('\n') } : {}),
    ...(parts.facts.length ? { facts: [...parts.facts] } : {}),
    children: [],
  };
}

export function unquote(s: string): string {
  const t = s.trim();
  return t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) ? t.slice(1, -1) : t;
}

/** A label for an arrow: one line, no quotes or tags. */
export function edgeLabel(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const t = htmlToLines(unquote(raw).replace(/\\n/g, '<br>')).join(' ').trim();
  return t || undefined;
}

type Frame = { op: 'alt' | 'opt' | 'loop' | 'par'; branches: { cond: string; steps: SequenceStepInput[] }[] } | { op: 'transparent'; steps: SequenceStepInput[] };

/** Builds sequence steps from a stream of statements, with fragments that nest. Shared by every text format. */
export class SequenceBuilder {
  private readonly root: SequenceStepInput[] = [];
  private readonly stack: Frame[] = [];
  private readonly byKey = new Map<string, TextNode>();
  private readonly order: TextNode[] = [];
  private readonly creating = new Set<string>();
  private messages = 0;

  constructor(private readonly notes: ParseNotes) {}

  /** Declares a participant, or names and types one already used. */
  participant(key: string, label: string | undefined, type?: string): string {
    const existing = this.byKey.get(key);
    if (existing) {
      if (label !== undefined) Object.assign(existing, { ...labelNode(key, label), children: existing.children });
      if (type !== undefined) existing.type = type;
      return key;
    }
    const node: TextNode = { ...labelNode(key, label), ...(type !== undefined ? { type } : {}) };
    this.byKey.set(key, node);
    this.order.push(node);
    return key;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /** The next message to this participant creates it. */
  create(key: string): void {
    this.participant(key, undefined);
    this.creating.add(key);
  }

  message(from: string, to: string, label: string | undefined, kind: 'sync' | 'async' | 'reply'): void {
    this.participant(from, undefined);
    this.participant(to, undefined);
    const created = this.creating.delete(to);
    this.messages++;
    this.current().push({ from, to, ...(label !== undefined ? { label } : {}), ...(kind !== 'sync' ? { kind } : {}), ...(created ? { create: true } : {}) });
  }

  note(over: string[], text: string): void {
    for (const o of over) this.participant(o, undefined);
    this.current().push({ note: text, over });
  }

  destroy(key: string): void {
    this.participant(key, undefined);
    this.current().push({ destroy: key });
  }

  open(op: 'alt' | 'opt' | 'loop' | 'par', cond: string): void {
    this.stack.push({ op, branches: [{ cond, steps: [] }] });
  }

  /** A block that groups nothing Vantage draws (a colored rect, a participant box); its steps stay. */
  openTransparent(): void {
    this.stack.push({ op: 'transparent', steps: [] });
  }

  /** `else` in an alt, `and` in a par. */
  branch(cond: string, keyword: string): void {
    const top = this.stack[this.stack.length - 1];
    if (!top || top.op === 'transparent' || (top.op !== 'alt' && top.op !== 'par')) {
      this.notes.warn(`${keyword} outside an alt or par block; its steps stay in place`);
      return;
    }
    top.branches.push({ cond, steps: [] });
  }

  /** Closes the innermost block; false when none is open. */
  close(): boolean {
    const top = this.stack.pop();
    if (!top) return false;
    const into = this.current();
    if (top.op === 'transparent') {
      into.push(...top.steps);
      return true;
    }
    if (top.op === 'par' && top.branches.length > 1) {
      this.notes.warn(`par ${top.branches[0]!.cond}: ${top.branches.length} branches drawn one after another in one par block`);
      into.push({ par: top.branches[0]!.cond, steps: top.branches.flatMap((b) => b.steps) });
      return true;
    }
    if (top.op === 'alt') {
      into.push(altOf(top.branches));
      return true;
    }
    const b = top.branches[0]!;
    into.push({ [top.op]: b.cond, steps: b.steps });
    return true;
  }

  finish(): { participants: TextNode[]; steps: SequenceStepInput[]; messages: number } {
    if (this.stack.length) this.notes.warn(`${this.stack.length} block${this.stack.length === 1 ? '' : 's'} never closed with end; closed at the end`);
    while (this.stack.length) this.close();
    return { participants: this.order, steps: dropEmptyFragments(this.root), messages: this.messages };
  }

  private current(): SequenceStepInput[] {
    const top = this.stack[this.stack.length - 1];
    if (!top) return this.root;
    return top.op === 'transparent' ? top.steps : top.branches[top.branches.length - 1]!.steps;
  }
}

/** `alt A / else B / else` to an alt whose else holds a nested alt for every labelled branch after the first. */
function altOf(branches: readonly { cond: string; steps: SequenceStepInput[] }[]): SequenceStepInput {
  const [first, ...rest] = branches;
  const step: SequenceStepInput = { alt: first!.cond, steps: first!.steps };
  if (!rest.length) return step;
  const last = rest[rest.length - 1]!;
  const tail = rest.length === 1 && !last.cond ? last.steps : [altOf(rest)];
  return { ...step, else: tail };
}

/** A fragment with no steps is invalid; keep its condition as a note instead of failing. */
function dropEmptyFragments(steps: SequenceStepInput[]): SequenceStepInput[] {
  return steps.flatMap((s): SequenceStepInput[] => {
    const inner = s.steps ? dropEmptyFragments(s.steps) : undefined;
    const elses = s.else ? dropEmptyFragments(s.else) : undefined;
    const fragment = s.alt ?? s.opt ?? s.loop ?? s.par;
    if (fragment !== undefined && !inner?.length && !elses?.length) return [];
    return [{ ...s, ...(inner ? { steps: inner } : {}), ...(elses ? (elses.length ? { else: elses } : { else: undefined }) : {}) }].map(stripUndefined);
  });
}

function stripUndefined(s: SequenceStepInput): SequenceStepInput {
  return Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as SequenceStepInput;
}

type ViewInput = NonNullable<DocumentInput['views']>[number];

export interface TextBuild {
  readonly nodes: NodeInput[];
  readonly views: ViewInput[];
  readonly pages: PageReport[];
  readonly hints: string[];
  /** One line per box that several diagrams drew and that became one node. */
  readonly merged: string[];
  readonly counts: { shapes: number; edges: number; nodes: number; containers: number; relations: number };
}

/**
 * Diagrams to nodes and views. Within a diagram every key is its own node;
 * across diagrams a box with the same name under the same parent names is
 * one node shown in several views.
 */
export function buildTextDiagrams(diagrams: readonly TextDiagram[]): TextBuild {
  const ids = new IdPool(), viewIds = new IdPool();
  const roots: NodeInput[] = [];
  const byPath = new Map<string, { node: NodeInput; diagram: number }>();
  const merged: string[] = [];
  const hints: string[] = [];
  const views: ViewInput[] = [];
  const pages: PageReport[] = [];
  let shapes = 0, edges = 0, relations = 0;

  const place = (t: TextNode, parent: NodeInput | undefined, parentPath: string, diagram: number, keys: Map<string, string>): void => {
    const path = `${parentPath}\u0000${t.name.toLowerCase()}`;
    const seen = byPath.get(path);
    let node: NodeInput;
    if (seen && seen.diagram !== diagram) {
      node = seen.node;
      merged.push(`${t.name} (${node.id}) is drawn by more than one diagram; kept once`);
    } else {
      node = {
        id: ids.take(t.name, 'node'),
        name: t.name,
        ...(t.type !== undefined ? { type: t.type } : {}),
        ...(t.shape !== undefined ? { shape: t.shape } : {}),
        ...(t.subtitle !== undefined ? { subtitle: t.subtitle } : {}),
        ...(t.description !== undefined ? { description: t.description } : {}),
        ...(t.facts?.length ? { facts: t.facts } : {}),
      };
      if (!seen) byPath.set(path, { node, diagram });
      if (parent) parent.children = [...(parent.children ?? []), node];
      else roots.push(node);
    }
    keys.set(t.key, node.id!);
    shapes++;
    for (const c of t.children) place(c, node, path, diagram, keys);
  };

  diagrams.forEach((d, i) => {
    const title = d.title ?? `Diagram ${i + 1}`;
    const keys = new Map<string, string>();
    const where = diagrams.length > 1 ? `${title}: ` : '';
    if (d.kind === 'relation') {
      for (const n of d.nodes) place(n, undefined, '', i, keys);
      const rels: RelationInput[] = [];
      const touched = new Set<string>();
      for (const e of d.edges) {
        const from = keys.get(e.from), to = keys.get(e.to);
        if (from === undefined || to === undefined) continue;
        touched.add(from).add(to);
        if (e.label === undefined) hints.push(`${where}relation ${from} -> ${to} has no label; give it a verb`);
        rels.push({ from, to, ...(e.label !== undefined ? { label: e.label } : {}), ...(e.description !== undefined ? { description: e.description } : {}), ...(e.kind ? { kind: e.kind } : {}), ...(e.both ? { both: true } : {}), ...(e.heads ? { heads: e.heads } : {}) });
      }
      // Boxes no arrow reaches, inside or below them, would not be drawn; name them.
      const alone: string[] = [];
      const reached = (t: TextNode): boolean => {
        const below = t.children.map(reached).some(Boolean);
        const hit = below || touched.has(keys.get(t.key)!);
        if (!hit) alone.push(keys.get(t.key)!);
        return hit;
      };
      d.nodes.forEach(reached);
      const arrange = d.arrange.flatMap((a) => {
        const node = keys.get(a.key);
        return node !== undefined ? [{ node, as: 'flow' as const, direction: a.direction }] : [];
      });
      const view: RelationViewInput = {
        id: viewIds.take(title, 'view'),
        title,
        kind: 'relation',
        ...(d.direction ? { direction: d.direction } : {}),
        ...(rels.length ? { relations: rels } : {}),
        ...(alone.length ? { include: { nodes: [...new Set(alone)] } } : {}),
        ...(arrange.length ? { arrange } : {}),
      };
      views.push(view);
      edges += d.edges.length;
      relations += rels.length;
      pages.push(page(title, i, keys.size, rels.length, containersOf(d.nodes)));
      return;
    }
    for (const p of d.participants) place(p, undefined, '', i, keys);
    const id = (k: string): string => keys.get(k) ?? k;
    const remap = (steps: SequenceStepInput[]): SequenceStepInput[] =>
      steps.map((s) => {
        if (s.from !== undefined && s.to !== undefined && s.label === undefined) hints.push(`${where}message ${id(s.from)} -> ${id(s.to)} has no label; give it a verb`);
        return {
          ...s,
          ...(s.from !== undefined ? { from: id(s.from) } : {}),
          ...(s.to !== undefined ? { to: id(s.to) } : {}),
          ...(s.over !== undefined ? { over: (Array.isArray(s.over) ? s.over : [s.over]).map(id) } : {}),
          ...(s.destroy !== undefined ? { destroy: id(s.destroy) } : {}),
          ...(s.steps ? { steps: remap(s.steps) } : {}),
          ...(s.else ? { else: remap(s.else) } : {}),
        };
      });
    const steps = remap(d.steps);
    const count = countMessages(steps);
    views.push({ id: viewIds.take(title, 'view'), title, kind: 'sequence', participants: d.participants.map((p) => id(p.key)), steps });
    edges += count;
    pages.push(page(title, i, keys.size, count, 0));
  });

  return { nodes: roots, views, pages, hints, merged, counts: { shapes, edges, nodes: countAll(roots), containers: countContainers(roots), relations } };
}

function countMessages(steps: readonly SequenceStepInput[]): number {
  return steps.reduce((n, s) => n + (s.from !== undefined && s.to !== undefined ? 1 : 0) + countMessages(s.steps ?? []) + countMessages(s.else ?? []), 0);
}

function countAll(nodes: readonly NodeInput[]): number {
  return nodes.reduce((n, x) => n + 1 + countAll(x.children ?? []), 0);
}

function countContainers(nodes: readonly NodeInput[]): number {
  return nodes.reduce((n, x) => n + (x.children?.length ? 1 : 0) + countContainers(x.children ?? []), 0);
}

function containersOf(nodes: readonly TextNode[]): number {
  return nodes.reduce((n, x) => n + (x.children.length ? 1 : 0) + containersOf(x.children), 0);
}

function page(name: string, index: number, nodes: number, relations: number, containers: number): PageReport {
  return { name, index, shapes: nodes, edges: relations, nodes, containers, relations, dropped: [], hints: [], unmappedStyles: [], warnings: [] };
}

/**
 * Sequence view layout. Participants across the top in author order, then
 * first use. Column spacing is solved from the labels that must fit between
 * lifelines, so no label is ever clipped. Nested steps become activations
 * and reply arrows; alt, opt, loop and par become framed fragments.
 */
import type { Model, ResolvedSequenceView, SequenceStep } from '@vantage/model';
import { textWidth, wrapText } from './text/measure.ts';
import { DEFAULT_STYLE, type LayoutStyle, RULES } from './style.ts';
import type { Extra, Layout, LayoutBox, TextBlock } from './types.ts';
import { measureQuality } from './metrics.ts';
import { syntheticNode } from './synthetic.ts';

const SQ = RULES.sequence;

interface Row {
  kind: 'message' | 'fragment-open' | 'fragment-else' | 'fragment-close' | 'note' | 'activation-end' | 'destroy';
  participant?: string;
  /** The message creates its target: the arrow ends at the participant box, not the lifeline. */
  create?: boolean;
  y: number;
  height: number;
  step?: SequenceStep;
  from?: string;
  to?: string;
  label?: string;
  style?: 'sync' | 'async' | 'reply';
  depthFrom?: number;
  depthTo?: number;
  op?: string;
  condition?: string;
  fragmentId?: string;
  over?: string[];
}

const ROW = RULES.sequence.row;
const HEADER_H = RULES.sequence.header;
const FRAG_HEAD = RULES.sequence.fragmentHead;

export function layoutSequenceView(model: Model, view: ResolvedSequenceView, style: LayoutStyle = DEFAULT_STYLE): Layout {
  const order: string[] = [...(view.participants ?? [])];
  const seen = new Set(order);
  const use = (id: string | undefined): void => {
    if (id !== undefined && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  };
  const walkUse = (steps: readonly SequenceStep[]): void => {
    for (const s of steps) {
      use(s.from);
      use(s.to);
      for (const o of s.over ?? []) use(o);
      if (s.steps) walkUse(s.steps);
      if (s.else) walkUse(s.else);
    }
  };
  walkUse(view.steps);
  const index = new Map(order.map((id, i) => [id, i]));

  // Rows, in order, with activation depth per participant.
  const rows: Row[] = [];
  const depth = new Map<string, number>(order.map((id) => [id, 0]));
  const activations: { id: string; start: number; end?: number; depth: number }[] = [];
  /** Participants created by a message sit at that row instead of the top; destroyed ones end with a cross. */
  const createdAt = new Map<string, number>();
  const destroyedAt = new Map<string, number>();
  let fragN = 0;
  let y = HEADER_H + SQ.headerGap;
  const emit = (r: Omit<Row, 'y'>): void => {
    rows.push({ ...r, y });
    y += r.height;
  };
  const walk = (steps: readonly SequenceStep[]): void => {
    for (const s of steps) {
      const op = s.alt !== undefined ? 'alt' : s.opt !== undefined ? 'opt' : s.loop !== undefined ? 'loop' : s.par !== undefined ? 'par' : undefined;
      if (op) {
        const id = `frag-${fragN++}`;
        emit({ kind: 'fragment-open', height: FRAG_HEAD + SQ.fragmentOpenPad, op, condition: (s.alt ?? s.opt ?? s.loop ?? s.par) as string, fragmentId: id });
        walk(s.steps ?? []);
        if (s.else) {
          emit({ kind: 'fragment-else', height: SQ.elseRow, fragmentId: id, condition: 'else' });
          walk(s.else);
        }
        emit({ kind: 'fragment-close', height: SQ.closeRow, fragmentId: id });
        continue;
      }
      if (s.note !== undefined) {
        const w = wrapText(s.note, style.labelSize, 'regular', SQ.noteWrap, 4);
        emit({ kind: 'note', height: w.height + SQ.notePad, label: s.note, over: s.over ?? (s.from !== undefined ? [s.from] : [order[0]!]) });
        continue;
      }
      if (s.destroy !== undefined) {
        emit({ kind: 'destroy', height: SQ.destroyRow, participant: s.destroy });
        destroyedAt.set(s.destroy, y - SQ.destroyRow / 2);
        if (s.from === undefined || s.to === undefined) continue;
      }
      if (s.from === undefined || s.to === undefined) continue;
      const lbl = s.label ?? '';
      const wrapped = wrapText(lbl, style.labelSize, 'regular', SQ.labelWrap, 2);
      const self = s.from === s.to;
      const h = Math.max(ROW, wrapped.height + SQ.messagePad) + (self ? SQ.selfExtra : 0);
      const kindStyle = s.kind === 'reply' ? 'reply' : s.kind === 'async' ? 'async' : 'sync';
      const created = s.create === true;
      emit({ kind: 'message', height: created ? Math.max(h, HEADER_H + SQ.createdExtra) : h, step: s, from: s.from, to: s.to, label: lbl, style: kindStyle, depthFrom: depth.get(s.from)!, depthTo: depth.get(s.to)!, ...(created ? { create: true } : {}) });
      if (created) createdAt.set(s.to, rows[rows.length - 1]!.y + rows[rows.length - 1]!.height / 2);
      const activate = !created && (kindStyle === 'sync' || (kindStyle === 'async' && (s.steps?.length ?? 0) > 0));
      if (activate) {
        const d = depth.get(s.to)! + 1;
        depth.set(s.to, d);
        activations.push({ id: s.to, start: rows[rows.length - 1]!.y + h / 2, depth: d });
        walk(s.steps ?? []);
        if (s.reply !== undefined) {
          const rw = wrapText(s.reply, style.labelSize, 'regular', SQ.labelWrap, 2);
          emit({ kind: 'message', height: Math.max(ROW, rw.height + SQ.messagePad), from: s.to, to: s.from, label: s.reply, style: 'reply', depthFrom: d, depthTo: depth.get(s.from)! });
        }
        const act = activations.filter((a) => a.id === s.to && a.end === undefined).pop()!;
        act.end = y - SQ.activationTail;
        depth.set(s.to, d - 1);
      } else if (s.steps) {
        walk(s.steps);
      }
    }
  };
  walk(view.steps);
  const bottom = y + SQ.tail;

  // Column positions: solve minimum gaps from labels that must fit between lifelines.
  const headW = order.map((id) => {
    const n = model.nodes.get(id);
    const name = n?.name ?? id;
    const sub = n?.subtitle;
    return Math.max(SQ.headMinWidth, textWidth(name, style.nameSize, 'semibold') + SQ.headPad, sub ? textWidth(sub, style.subtitleSize, 'regular') + SQ.headPad : 0);
  });
  const minGap: number[] = order.map((_, i) => (i === 0 ? 0 : (headW[i - 1]! + headW[i]!) / 2 + SQ.headGap));
  const need: { a: number; b: number; w: number }[] = [];
  for (const r of rows) {
    if (r.kind === 'message' && r.from !== r.to && r.label) {
      const a = index.get(r.from!)!, b = index.get(r.to!)!;
      need.push({ a: Math.min(a, b), b: Math.max(a, b), w: wrapText(r.label, style.labelSize, 'regular', SQ.labelWrap, 2).width + SQ.labelRoom });
    }
  }
  const x: number[] = [];
  let acc = style.canvasPad + headW[0]! / 2;
  for (let i = 0; i < order.length; i++) {
    if (i > 0) acc += minGap[i]!;
    x.push(acc);
  }
  for (let round = 0; round < 4; round++) {
    for (const n of need) {
      const span = x[n.b]! - x[n.a]!;
      if (span < n.w) {
        const extra = (n.w - span) / (n.b - n.a);
        for (let i = n.a + 1; i < order.length; i++) x[i] = x[i]! + extra * Math.min(i - n.a, n.b - n.a);
      }
    }
  }

  const boxes: LayoutBox[] = order.map((id, i) => {
    const n = model.nodes.get(id);
    const name = n?.name ?? id;
    const w = headW[i]!;
    const nameBlock: TextBlock = { lines: [name], size: style.nameSize, weight: 'semibold', x: w / 2, y: n?.subtitle ? SQ.nameTop : SQ.nameAloneTop, lineHeight: style.nameSize * 1.25, anchor: 'middle' };
    const sub: TextBlock | undefined = n?.subtitle ? { lines: [n.subtitle], size: style.subtitleSize, weight: 'regular', x: w / 2, y: SQ.subtitleTop, lineHeight: style.subtitleSize * 1.25, anchor: 'middle' } : undefined;
    const node = n ?? syntheticNode(id, name, { typeName: 'node', color: 'slate' });
    const top = createdAt.has(id) ? createdAt.get(id)! - HEADER_H / 2 : style.canvasPad;
    return { id, kind: 'leaf', depth: 0, node, shape: n?.role === 'actor' ? 'person' : 'rounded', frame: 'box', iconOnly: false, x: x[i]! - w / 2, y: top, w, h: HEADER_H, name: nameBlock, ...(sub ? { subtitle: sub } : {}) };
  });

  const extras: Extra[] = [];
  for (const [i, id] of order.entries()) {
    const y0 = (createdAt.has(id) ? createdAt.get(id)! - HEADER_H / 2 : style.canvasPad) + HEADER_H;
    const y1 = destroyedAt.get(id) ?? bottom;
    extras.push({ kind: 'lifeline', id, x: x[i]!, y0, y1 });
    if (destroyedAt.has(id)) {
      const cx = x[i]!, cy = y1;
      extras.push({ kind: 'line', id: `destroy-${id}-a`, from: { x: cx - SQ.cross, y: cy - SQ.cross }, to: { x: cx + SQ.cross, y: cy + SQ.cross }, style: 'leader' });
      extras.push({ kind: 'line', id: `destroy-${id}-b`, from: { x: cx - SQ.cross, y: cy + SQ.cross }, to: { x: cx + SQ.cross, y: cy - SQ.cross }, style: 'leader' });
    }
  }
  const fragStack: { id: string; y: number; op: string; condition: string; dividers: number[]; lo: number; hi: number }[] = [];
  const participantsBetween = (lo: number, hi: number): [number, number] => [x[lo]! - headW[lo]! / 2 - SQ.fragmentReach, x[hi]! + headW[hi]! / 2 + SQ.fragmentReach];
  const activationOffset = (d: number): number => (d - 1) * SQ.activationStep;
  for (const r of rows) {
    switch (r.kind) {
      case 'fragment-open':
        fragStack.push({ id: r.fragmentId!, y: r.y, op: r.op!, condition: r.condition!, dividers: [], lo: order.length - 1, hi: 0 });
        break;
      case 'fragment-else':
        fragStack[fragStack.length - 1]!.dividers.push(r.y);
        break;
      case 'fragment-close': {
        const f = fragStack.pop()!;
        const lo = Math.min(f.lo, order.length - 1), hi = Math.max(f.hi, 0);
        const [x0, x1] = participantsBetween(Math.min(lo, hi), Math.max(lo, hi));
        const inset = fragStack.length * SQ.fragmentInset;
        extras.push({ kind: 'fragment', id: f.id, rect: { x: x0 - SQ.fragmentOverhang + inset, y: f.y, w: x1 - x0 + SQ.fragmentOverhang * 2 - inset * 2, h: r.y + r.height - f.y }, op: f.op, condition: f.condition, dividers: f.dividers });
        for (const outer of fragStack) {
          outer.lo = Math.min(outer.lo, lo);
          outer.hi = Math.max(outer.hi, hi);
        }
        break;
      }
      case 'note': {
        const ids = r.over!;
        const lo = Math.min(...ids.map((o) => index.get(o)!)), hi = Math.max(...ids.map((o) => index.get(o)!));
        const w = wrapText(r.label!, style.labelSize, 'regular', SQ.noteWrap, 4);
        // Over several participants the note spans them; over one it sits beside the lifeline, clear of activations.
        const single = lo === hi;
        const cx = (x[lo]! + x[hi]!) / 2;
        const rw = single ? w.width + SQ.noteRoom : Math.max(w.width + SQ.noteRoom, x[hi]! - x[lo]! + SQ.noteSpan);
        const nx = single ? x[lo]! + SQ.noteBeside : cx - rw / 2;
        extras.push({ kind: 'note', id: `note-${r.y}`, rect: { x: nx, y: r.y + SQ.noteInset, w: rw, h: r.height - SQ.noteInset * 2 }, text: { lines: w.lines, size: style.labelSize, weight: 'regular', x: SQ.noteTextX, y: SQ.noteTextY, lineHeight: w.lineHeight, anchor: 'start' } });
        for (const f of fragStack) {
          f.lo = Math.min(f.lo, lo);
          f.hi = Math.max(f.hi, hi);
        }
        break;
      }
      case 'message': {
        const a = index.get(r.from!)!, b = index.get(r.to!)!;
        for (const f of fragStack) {
          f.lo = Math.min(f.lo, a, b);
          f.hi = Math.max(f.hi, a, b);
        }
        const w = wrapText(r.label ?? '', style.labelSize, 'regular', SQ.labelWrap, 2);
        const yc = r.y + r.height / 2;
        const self = a === b;
        const dir = b > a ? 1 : -1;
        const fx = x[a]! + (self ? activationOffset(r.depthFrom!) + SQ.activationWidth / 2 : dir * (r.depthFrom! > 0 ? SQ.activationWidth / 2 + activationOffset(r.depthFrom!) : 0));
        const tx = r.create ? x[b]! - dir * (headW[b]! / 2) : x[b]! - (self ? -activationOffset(r.depthTo! + 1) - SQ.activationWidth / 2 : dir * (r.depthTo! > 0 ? SQ.activationWidth / 2 + activationOffset(r.depthTo!) : 0));
        const label: TextBlock = self
          ? { lines: w.lines, size: style.labelSize, weight: 'regular', x: fx + SQ.selfLabelX, y: r.y + SQ.selfLabelY, lineHeight: w.lineHeight, anchor: 'start' }
          : { lines: w.lines, size: style.labelSize, weight: 'regular', x: (fx + tx) / 2, y: yc - w.height - SQ.labelLift, lineHeight: w.lineHeight, anchor: 'middle' };
        extras.push({ kind: 'message', id: `msg-${r.y}`, from: { x: fx, y: self ? r.y + SQ.selfTop : yc }, to: { x: tx, y: self ? r.y + r.height - SQ.selfBottom : yc }, label, style: r.style!, selfCall: self });
        break;
      }
      case 'activation-end':
        break;
    }
  }
  for (const [i, a] of activations.entries()) {
    const xi = x[index.get(a.id)!]! + activationOffset(a.depth);
    extras.push({ kind: 'activation', id: `act-${i}`, rect: { x: xi - SQ.activationWidth / 2, y: a.start, w: SQ.activationWidth, h: (a.end ?? bottom) - a.start }, depth: a.depth });
  }
  const width = Math.ceil(Math.max(...boxes.map((b) => b.x + b.w), ...extras.map((e) => ('rect' in e ? e.rect.x + e.rect.w : 0))) + style.canvasPad);
  const height = Math.ceil(bottom + style.canvasPad);
  const metrics = measureQuality(boxes, [], width, height);
  return { viewId: view.id, title: view.title, width, height, boxes, edges: [], extras, metrics: { ...metrics, notes: metrics.notes.filter((n) => !n.startsWith('no relations')) } };
}

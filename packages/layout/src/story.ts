/**
 * The story pass over a laid-out relation view: sticky notes pinned to
 * boxes, frames around highlighted sets, numbered badges along path
 * arrows, prose and the narrative under the picture, and a legend. Runs
 * after boxes are placed; notes run before routing so arrows avoid them.
 */
import type { Model, ResolvedRelationView, RelationKind } from '@vantage/model';
import type { Point, Rect } from './geometry.ts';
import { rectsOverlap, segmentCrossesRect, union, inflate } from './geometry.ts';
import type { LayoutStyle } from './style.ts';
import type { Extra, LayoutBox, LayoutEdge, LegendItem, TextBlock } from './types.ts';
import { textWidth, wrapText } from './text/measure.ts';
import { RULES } from './style.ts';

const NT = RULES.notes, B = RULES.badges, O = RULES.overlay, P = RULES.prose, LGD = RULES.legend;

export interface NoteRequest {
  readonly id: string;
  readonly text: string;
  readonly at: string;
  readonly side?: 'top' | 'right' | 'bottom' | 'left' | undefined;
  readonly kind: 'note' | 'callout';
}

/** Every note a view wants: the nodes' own notes plus the view's pinned annotations. */
export function collectNotes(model: Model, view: ResolvedRelationView, boxes: readonly LayoutBox[]): NoteRequest[] {
  const out: NoteRequest[] = [];
  for (const b of boxes) if (b.node.note !== undefined) out.push({ id: `note-${b.id}`, text: b.node.note, at: b.id, kind: 'note' });
  view.annotations.forEach((a, i) => {
    if (a.at === undefined || a.kind === 'heading' || !model.nodes.has(a.at)) return;
    out.push({ id: `ann-${i}`, text: a.text, at: a.at, side: a.side, kind: a.kind ?? 'note' });
  });
  return out;
}

const SIDES = ['right', 'bottom', 'left', 'top'] as const;

/**
 * Places each note beside its box on the least busy side, off the direct path of every arrow.
 * Returns the drawings and the rects arrows must avoid.
 */
export function placeNotes(notes: readonly NoteRequest[], boxes: readonly LayoutBox[], style: LayoutStyle, arrows: readonly (readonly Point[])[] = []): { extras: Extra[]; obstacles: Rect[] } {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const leaves = boxes.filter((b) => b.kind !== 'container');
  const containers = boxes.filter((b) => b.kind === 'container');
  const placed: Rect[] = [];
  const extras: Extra[] = [];
  const ancestors = (id: string): Set<string> => {
    const out = new Set<string>();
    let cur = byId.get(id)?.parentId;
    while (cur !== undefined) {
      out.add(cur);
      cur = byId.get(cur)?.parentId;
    }
    return out;
  };
  for (const n of notes) {
    const target = byId.get(n.at);
    if (!target) continue;
    const wrapped = wrapText(n.text, style.factSize, 'regular', style.noteWidth, 8);
    const pad = n.kind === 'note' ? NT.pad : NT.captionPad;
    const w = Math.ceil(wrapped.width + pad * 2), h = Math.ceil(wrapped.height + pad * 2);
    const gap = n.kind === 'note' ? NT.gap : NT.captionGap;
    const up = ancestors(n.at);
    const order = n.side ? [n.side, ...SIDES.filter((s) => s !== n.side)] : SIDES;
    let best: Rect | undefined, bestScore = Infinity;
    order.forEach((side, pref) => {
      for (const t of [0.5, 0.25, 0.75, 0, 1]) {
        const r = candidate(target, side, t, w, h, gap);
        let score = pref * 10 + Math.abs(t - 0.5) * 6;
        for (const l of leaves) if (l.id !== target.id && rectsOverlap(r, l, NT.clearance)) score += 100;
        for (const c of containers) {
          if (!up.has(c.id) && c.id !== target.id && rectsOverlap(r, c, 0)) score += 30;
          // Inside an ancestor, the title bar is still off limits.
          if (up.has(c.id) && rectsOverlap(r, { x: c.x, y: c.y, w: c.w, h: style.containerHeader }, 0)) score += 40;
        }
        for (const p of placed) if (rectsOverlap(r, p, NT.clearance)) score += 80;
        // A note on an arrow's direct path makes the arrow detour around it; another side is better.
        const clear = inflate(r, style.edgeMargin);
        for (const a of arrows) if (a.some((q, i) => i > 0 && segmentCrossesRect(a[i - 1]!, q, clear))) score += 60;
        if (r.x < 0 || r.y < 0) score += 15;
        if (score < bestScore) {
          bestScore = score;
          best = r;
        }
      }
    });
    const rect = best!;
    placed.push(rect);
    const text: TextBlock = { lines: wrapped.lines, size: style.factSize, weight: 'regular', x: pad, y: pad - 2, lineHeight: wrapped.lineHeight, anchor: 'start' };
    if (n.kind === 'note') extras.push({ kind: 'note', id: n.id, rect, text });
    else {
      extras.push({ kind: 'line', id: `${n.id}-leader`, from: nearest(rect, target), to: nearest(target, rect), style: 'leader' });
      extras.push({ kind: 'text', id: n.id, role: 'caption', text: { ...text, x: rect.x + pad, y: rect.y + pad - 2 } });
    }
  }
  return { extras, obstacles: placed };
}

function candidate(b: Rect, side: (typeof SIDES)[number], t: number, w: number, h: number, gap: number): Rect {
  switch (side) {
    case 'right':
      return { x: b.x + b.w + gap, y: b.y + (b.h - h) * t, w, h };
    case 'left':
      return { x: b.x - gap - w, y: b.y + (b.h - h) * t, w, h };
    case 'bottom':
      return { x: b.x + (b.w - w) * t, y: b.y + b.h + gap, w, h };
    case 'top':
      return { x: b.x + (b.w - w) * t, y: b.y - gap - h, w, h };
  }
}

/** The point on rect a's edge closest to rect b. */
function nearest(a: Rect, b: Rect): Point {
  const cx = Math.max(a.x, Math.min(b.x + b.w / 2, a.x + a.w));
  const cy = Math.max(a.y, Math.min(b.y + b.h / 2, a.y + a.h));
  return { x: cx, y: cy };
}

/** Frames around highlighted sets, drawn under the leaves. */
export function highlightExtras(view: ResolvedRelationView, boxes: readonly LayoutBox[], style: LayoutStyle): Extra[] {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  return view.highlights.flatMap((h, i) => {
    const members = h.nodes.map((id) => byId.get(id)).filter((b): b is LayoutBox => b !== undefined);
    if (!members.length) return [];
    const rect = inflate(union(members), O.setPad);
    const label: TextBlock | undefined = h.label ? { lines: [h.label], size: style.subtitleSize, weight: 'medium', x: rect.x + O.setPad, y: rect.y - style.subtitleSize - O.setLabelRise, lineHeight: style.subtitleSize * 1.25, anchor: 'start' } : undefined;
    return [{ kind: 'highlight', id: `hl-${i}`, rect, ...(label ? { label } : {}), color: h.color ?? 'red', style: h.style ?? 'frame' }];
  });
}

/** Marks path steps on their arrows: colors the edge and drops a numbered badge along it. */
export function applyPaths(view: ResolvedRelationView, edges: LayoutEdge[], style: LayoutStyle, boxes: readonly LayoutBox[] = []): Extra[] {
  const extras: Extra[] = [];
  const perEdge = new Map<string, number>();
  const borders = boxes.filter((b) => b.frame !== 'none').flatMap((b) => {
    const tl = { x: b.x, y: b.y }, tr = { x: b.x + b.w, y: b.y }, bl = { x: b.x, y: b.y + b.h }, br = { x: b.x + b.w, y: b.y + b.h };
    return [{ a: tl, b: tr }, { a: tr, b: br }, { a: bl, b: br }, { a: tl, b: bl }];
  });
  // Badges keep off every label and off each other.
  const taken: Rect[] = edges.flatMap((e) => (e.label ? [e.label] : []));
  for (const p of view.paths) {
    for (const s of p.steps) {
      const i = findEdge(edges, s.from, s.to, s.label);
      if (i < 0) continue;
      const e = edges[i]!;
      edges[i] = { ...e, color: e.color ?? p.color, pathIds: [...(e.pathIds ?? []), p.id] };
      const n = perEdge.get(e.id) ?? 0;
      perEdge.set(e.id, n + 1);
      // Other lines and every drawn border: a badge on either numbers the wrong thing.
      const crossing = [...edges.filter((o) => o.id !== e.id).flatMap((o) => o.points.slice(1).map((q, k) => ({ a: o.points[k]!, b: q }))), ...borders];
      // A step's number sits beside its own label, on the same run, so badge and words read as one; else spread along the line.
      const besideLabel = n === 0 && e.label ? labelFractions(e.points, e.label, style.badgeRadius) : [];
      const at = alongEdge(e.points, [0.28, 0.5, 0.72, 0.15, 0.85][n % 5]!, taken, style.badgeRadius, crossing, besideLabel);
      taken.push({ x: at.x - style.badgeRadius, y: at.y - style.badgeRadius, w: style.badgeRadius * 2, h: style.badgeRadius * 2 });
      extras.push({ kind: 'badge', id: `badge-${p.id}-${s.badge}`, at, text: s.badge, color: p.color });
    }
  }
  return extras;
}

function findEdge(edges: readonly LayoutEdge[], from: string, to: string, label: string | undefined): number {
  const key = `${from}>${to}`;
  const hits = edges.map((e, i) => ({ e, i })).filter(({ e }) => (e.from === from && e.to === to) || e.members.includes(key) || (e.relation.from === from && e.relation.to === to));
  if (!hits.length) return -1;
  if (label !== undefined) {
    const exact = hits.find(({ e }) => e.relation.label === label || e.label?.text.includes(label));
    if (exact) return exact.i;
  }
  return hits[0]!.i;
}

/** The fractions along a polyline just before and just after the point nearest a label: where a badge sits beside it. */
function labelFractions(points: readonly Point[], label: Rect, r: number): number[] {
  const cx = label.x + label.w / 2, cy = label.y + label.h / 2;
  let walked = 0, total = 0, at = 0, best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) total += Math.abs(points[i + 1]!.x - points[i]!.x) + Math.abs(points[i + 1]!.y - points[i]!.y);
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!;
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const k = len ? Math.max(0, Math.min(1, a.x === b.x ? (cy - a.y) / (b.y - a.y) : (cx - a.x) / (b.x - a.x))) : 0;
    const px = a.x + (b.x - a.x) * k, py = a.y + (b.y - a.y) * k;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best) { best = d; at = walked + len * k; }
    walked += len;
  }
  if (!total) return [];
  // Just past either end of the label first, then further along the same run, never past its corners.
  const reach = (label.w > label.h ? label.w : label.h) / 2 + r + B.labelClear;
  let start = 0, end = total, walked2 = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const len = Math.abs(points[i + 1]!.x - points[i]!.x) + Math.abs(points[i + 1]!.y - points[i]!.y);
    if (at >= walked2 && at <= walked2 + len) { start = walked2; end = walked2 + len; break; }
    walked2 += len;
  }
  const out: number[] = [];
  for (let k = 0; k < 6; k++) for (const d of [-(reach + k * B.step), reach + k * B.step]) if (at + d > start + r && at + d < end - r) out.push((at + d) / total);
  return out.filter((f) => f > 0.02 && f < 0.98);
}

/** The point a fraction along a polyline, slid along it off any label or badge it would cover and off other lines, so a badge numbers one line only. Preferred fractions are tried first. */
function alongEdge(points: readonly Point[], t: number, avoid: readonly Rect[], r: number, lines: readonly { a: Point; b: Point }[] = [], preferred: readonly number[] = []): Point {
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const l = Math.abs(points[i + 1]!.x - points[i]!.x) + Math.abs(points[i + 1]!.y - points[i]!.y);
    lens.push(l);
    total += l;
  }
  const at = (f: number): Point => {
    let d = f * total;
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i]! || i === lens.length - 1) {
        const a = points[i]!, b = points[i + 1]!;
        const k = lens[i]! ? d / lens[i]! : 0;
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
      d -= lens[i]!;
    }
    return points[0]!;
  };
  for (const f of [...preferred, t, t - 0.08, t + 0.08, t - 0.16, t + 0.16, t - 0.24, t + 0.24, t - 0.32, t + 0.32]) {
    const p = at(Math.max(0.04, Math.min(0.96, f)));
    const disc = { x: p.x - r - B.discPad, y: p.y - r - B.discPad, w: 2 * r + B.discPad * 2, h: 2 * r + B.discPad * 2 };
    if (!avoid.some((a) => rectsOverlap(disc, a, B.clearance)) && !lines.some((l) => segmentCrossesRect(l.a, l.b, disc))) return p;
  }
  // No spot clear of other lines: settle for one clear of labels and badges.
  for (const f of [t, t - 0.08, t + 0.08, t - 0.16, t + 0.16, t - 0.24, t + 0.24, t - 0.32, t + 0.32]) {
    const p = at(Math.max(0.08, Math.min(0.92, f)));
    if (!avoid.some((a) => rectsOverlap({ x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r }, a, 2))) return p;
  }
  return at(t);
}

export interface Footer {
  readonly extras: Extra[];
  readonly height: number;
  /** How wide the canvas must be to hold it: prose has a floor and a legend column a width, either of which a narrow picture may not reach. */
  readonly width: number;
}

/** Prose annotations, then the path narrative, then the legend, stacked under the picture. */
export function footer(view: ResolvedRelationView, edges: readonly LayoutEdge[], width: number, top: number, style: LayoutStyle): Footer {
  const extras: Extra[] = [];
  const x = style.canvasPad;
  const maxW = Math.max(P.minWidth, Math.min(style.proseWidth, width - style.canvasPad * 2));
  let y = top;
  let right = 0;
  const para = (text: string, role: 'heading' | 'prose', id: string, color?: string): void => {
    const size = role === 'heading' ? style.headingSize : style.proseSize;
    const w = wrapText(text, size, role === 'heading' ? 'semibold' : 'regular', maxW, 40, 1.45);
    y += role === 'heading' ? P.headingTop : P.paragraphGap;
    extras.push({ kind: 'text', id, role, text: { lines: w.lines, size, weight: role === 'heading' ? 'semibold' : 'regular', x, y, lineHeight: w.lineHeight, anchor: 'start' }, ...(color ? { color } : {}) });
    right = Math.max(right, x + w.width);
    y += w.height;
  };
  view.annotations.forEach((a, i) => {
    if (a.at !== undefined && a.kind !== 'heading') return;
    para(a.text, a.kind === 'heading' ? 'heading' : 'prose', `prose-${i}`);
  });
  if (view.narrative) {
    for (const p of view.paths) {
      if (p.title) para(p.title, 'heading', `narr-${p.id}`, p.color);
      else y += P.pathGap;
      for (const s of p.steps) {
        if (s.text === undefined) continue;
        y += P.paragraphGap;
        const w = wrapText(s.text, style.proseSize, 'regular', maxW - P.badgeColumn, 6, 1.45);
        extras.push({ kind: 'badge', id: `narr-${p.id}-${s.badge}`, at: { x: x + style.badgeRadius, y: y + style.proseSize * 0.62 }, text: s.badge, color: p.color });
        extras.push({ kind: 'text', id: `narr-${p.id}-${s.badge}-text`, role: 'prose', text: { lines: w.lines, size: style.proseSize, weight: 'regular', x: x + P.badgeColumn, y, lineHeight: w.lineHeight, anchor: 'start' } });
        right = Math.max(right, x + P.badgeColumn + w.width);
        y += w.height;
      }
    }
  }
  const auto = view.legend === 'auto' && lineLooks(edges) > 1;
  if (view.legend === true || auto) {
    // A legend the engine adds explains the line styles only; paths and highlights already name themselves.
    const items = auto ? kindItems(edges) : legendItems(view, edges);
    if (items.length) {
      // Columns as wide as the longest entry (swatch, gap, text, and room), as many as fit across the picture.
      const colW = Math.max(LGD.minColumn, ...items.map((it) => LGD.swatch + textWidth(it.label, style.legendTextSize, 'regular') + LGD.room));
      const cols = Math.max(1, Math.min(LGD.maxColumns, items.length, Math.floor((width - 2 * x - LGD.inset) / colW)));
      const rows = Math.ceil(items.length / cols);
      const rect: Rect = { x, y: y + LGD.top, w: cols * colW + LGD.inset, h: rows * LGD.row + LGD.inset };
      extras.push({ kind: 'legend', id: 'legend', rect, items, cols });
      right = Math.max(right, rect.x + rect.w);
      y = rect.y + rect.h;
    }
  }
  return { extras, height: y > top ? y - top + style.canvasPad : 0, width: right > 0 ? right + style.canvasPad : 0 };
}

const KIND_LABEL: Record<RelationKind, string> = { sync: 'Synchronous call', async: 'Asynchronous message', data: 'Data flow', deploy: 'Deploys to', auth: 'Authenticates with', observe: 'Observes', manage: 'Manages' };
/** Kinds drawn with the same solid line look alike; every dashed kind has a pattern of its own. */
const LOOK: Record<RelationKind, string> = { sync: 'solid', data: 'solid', async: 'async', deploy: 'deploy', auth: 'auth', observe: 'observe', manage: 'manage' };

/** How many line patterns the view draws. */
export function lineLooks(edges: readonly LayoutEdge[]): number {
  return new Set(edges.map((e) => LOOK[e.kind])).size;
}

/** One legend row per line pattern; kinds drawn alike share a row and name each other. */
function kindItems(edges: readonly LayoutEdge[]): LegendItem[] {
  const byLook = new Map<string, RelationKind[]>();
  for (const k of new Set(edges.map((e) => e.kind))) byLook.set(LOOK[k], [...(byLook.get(LOOK[k]) ?? []), k]);
  return [...byLook.values()].map((ks) => ({ label: ks.map((k, i) => (i ? KIND_LABEL[k].toLowerCase() : KIND_LABEL[k])).join(' or '), swatch: 'arrow', color: 'edge', edgeKind: ks[0]! }));
}

function legendItems(view: ResolvedRelationView, edges: readonly LayoutEdge[]): LegendItem[] {
  const items: LegendItem[] = kindItems(edges);
  for (const p of view.paths) items.push({ label: p.title ?? p.id, swatch: 'arrow', color: p.color });
  view.highlights.forEach((h) => { if (h.label) items.push({ label: h.label, swatch: 'box', color: h.color ?? 'red' }); });
  return items;
}

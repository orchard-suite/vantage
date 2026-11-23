/**
 * Visual diff of two layouts of the same view: what appeared, vanished,
 * moved, or changed its label. Drawn as the new layout with highlights and
 * a narrative, so a version history reads like a story instead of a YAML
 * diff.
 */
import type { Extra, Layout, TextBlock } from './types.ts';
import { DEFAULT_STYLE, type LayoutStyle } from './style.ts';
import { wrapText } from './text/measure.ts';
import { inflate } from './geometry.ts';

export interface LayoutChange {
  readonly kind: 'appeared' | 'vanished' | 'moved' | 'relabelled' | 'edge-appeared' | 'edge-vanished';
  readonly id: string;
  readonly text: string;
}

export interface LayoutDiff {
  readonly layout: Layout;
  readonly changes: readonly LayoutChange[];
}

const COLOR: Record<LayoutChange['kind'], string> = { appeared: 'emerald', vanished: 'red', moved: 'amber', relabelled: 'violet', 'edge-appeared': 'emerald', 'edge-vanished': 'red' };

export function diffLayouts(before: Layout, after: Layout, style: LayoutStyle = DEFAULT_STYLE): LayoutDiff {
  const oldBoxes = new Map(before.boxes.map((b) => [b.id, b]));
  const newBoxes = new Map(after.boxes.map((b) => [b.id, b]));
  const changes: LayoutChange[] = [];
  const extras: Extra[] = [];
  const name = (id: string): string => newBoxes.get(id)?.node.name ?? oldBoxes.get(id)?.node.name ?? id;
  for (const b of after.boxes) {
    const o = oldBoxes.get(b.id);
    if (!o) {
      changes.push({ kind: 'appeared', id: b.id, text: `${b.node.name} appeared` });
      extras.push({ kind: 'highlight', id: `diff-${b.id}`, rect: inflate(b, 6), color: COLOR.appeared, style: 'frame' });
      continue;
    }
    if (o.node.name !== b.node.name) {
      changes.push({ kind: 'relabelled', id: b.id, text: `${o.node.name} is now ${b.node.name}` });
      extras.push({ kind: 'highlight', id: `diff-${b.id}`, rect: inflate(b, 6), color: COLOR.relabelled, style: 'frame' });
    } else if (JSON.stringify(o.node.subtitle ?? '') !== JSON.stringify(b.node.subtitle ?? '')) {
      const sub = b.node.subtitle;
      changes.push({ kind: 'relabelled', id: b.id, text: typeof sub === 'string' && sub ? `${b.node.name} now reads ${sub}` : sub ? `${b.node.name} has a new subtitle` : `${b.node.name} lost its subtitle` });
      extras.push({ kind: 'highlight', id: `diff-${b.id}`, rect: inflate(b, 6), color: COLOR.relabelled, style: 'frame' });
    } else if (Math.abs(o.x - b.x) + Math.abs(o.y - b.y) > 24 && b.kind !== 'container') {
      changes.push({ kind: 'moved', id: b.id, text: `${b.node.name} moved` });
      extras.push({ kind: 'highlight', id: `diff-${b.id}`, rect: inflate(b, 6), color: COLOR.moved, style: 'tint' });
    }
  }
  // Vanished boxes are drawn as ghosts where they were, when that spot is still on the canvas.
  const ghosts: Layout['boxes'][number][] = [];
  for (const o of before.boxes) {
    if (newBoxes.has(o.id)) continue;
    changes.push({ kind: 'vanished', id: o.id, text: `${o.node.name} vanished` });
    if (o.x + o.w <= after.width && o.y + o.h <= after.height) {
      ghosts.push({ ...o, node: { ...o.node, style: { ...o.node.style, frame: 'dashed' } }, frame: 'dashed' });
      extras.push({ kind: 'highlight', id: `diff-${o.id}`, rect: inflate(o, 6), color: COLOR.vanished, style: 'frame' });
    }
  }
  const edgeKey = (e: Layout['edges'][number]): string => `${e.from}>${e.to}:${e.label?.text ?? ''}`;
  const oldEdges = new Set(before.edges.map(edgeKey));
  const newEdges = new Set(after.edges.map(edgeKey));
  const edges = after.edges.map((e) => (oldEdges.has(edgeKey(e)) ? e : { ...e, color: COLOR['edge-appeared'] }));
  for (const e of after.edges) if (!oldEdges.has(edgeKey(e))) changes.push({ kind: 'edge-appeared', id: e.id, text: `${name(e.from)} now ${e.label?.text ?? 'connects to'} ${name(e.to)}` });
  for (const e of before.edges) if (!newEdges.has(edgeKey(e))) changes.push({ kind: 'edge-vanished', id: e.id, text: `${name(e.from)} no longer ${e.label?.text ?? 'connects to'} ${name(e.to)}` });

  // Narrative under the picture.
  let y = after.height;
  const x = style.canvasPad;
  const maxW = Math.max(240, Math.min(style.proseWidth, after.width - style.canvasPad * 2));
  if (changes.length) {
    y += 14;
    extras.push({ kind: 'text', id: 'diff-heading', role: 'heading', text: { lines: [`${changes.length} change${changes.length === 1 ? '' : 's'}`], size: style.headingSize, weight: 'semibold', x, y, lineHeight: style.headingSize * 1.3, anchor: 'start' } });
    y += style.headingSize * 1.3 + 4;
    for (const c of changes) {
      const w = wrapText(c.text, style.proseSize, 'regular', maxW - 28, 3, 1.45);
      y += 6;
      extras.push({ kind: 'badge', id: `diff-badge-${c.id}`, at: { x: x + style.badgeRadius, y: y + style.proseSize * 0.62 }, text: c.kind === 'appeared' || c.kind === 'edge-appeared' ? '+' : c.kind === 'vanished' || c.kind === 'edge-vanished' ? '-' : '~', color: COLOR[c.kind] });
      const t: TextBlock = { lines: w.lines, size: style.proseSize, weight: 'regular', x: x + 28, y, lineHeight: w.lineHeight, anchor: 'start' };
      extras.push({ kind: 'text', id: `diff-text-${c.id}`, role: 'prose', text: t });
      y += w.height;
    }
    y += style.canvasPad;
  } else {
    y += 14;
    extras.push({ kind: 'text', id: 'diff-heading', role: 'prose', text: { lines: ['No changes'], size: style.proseSize, weight: 'regular', x, y, lineHeight: style.proseSize * 1.45, anchor: 'start' } });
    y += style.proseSize * 1.45 + style.canvasPad;
  }
  return {
    changes,
    layout: { ...after, height: Math.ceil(y), boxes: [...after.boxes, ...ghosts], edges, extras: [...(after.extras ?? []), ...extras] },
  };
}

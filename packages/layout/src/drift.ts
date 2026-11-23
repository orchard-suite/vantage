/**
 * The drift view: a laid-out view with every disagreement between what the
 * document declares and what connectors observe drawn on it. Declared but
 * never observed is framed red; a fact that disagrees is framed amber with
 * both values; things observed inside a bound container that the document
 * never mentions are listed on a sticky beside it. A narrative under the
 * picture says each disagreement as a sentence.
 */
import type { Extra, Layout, TextBlock } from './types.ts';
import { DEFAULT_STYLE, type LayoutStyle } from './style.ts';
import { wrapText } from './text/measure.ts';
import { inflate } from './geometry.ts';

export type DriftInput =
  | { readonly kind: 'declared-not-observed'; readonly nodeId: string; readonly bind: string; readonly missingSince?: string }
  | { readonly kind: 'observed-not-declared'; readonly containerId: string; readonly key: string; readonly name: string; readonly type: string }
  | { readonly kind: 'fact-mismatch'; readonly nodeId: string; readonly label: string; readonly declared: string; readonly observed: string };

export interface DriftLayout {
  readonly layout: Layout;
  readonly sentences: readonly string[];
  readonly counts: { readonly missing: number; readonly undeclared: number; readonly mismatched: number };
}

export function driftLayout(base: Layout, items: readonly DriftInput[], style: LayoutStyle = DEFAULT_STYLE): DriftLayout {
  const boxes = new Map(base.boxes.map((b) => [b.id, b]));
  const extras: Extra[] = [];
  const sentences: string[] = [];
  const name = (id: string): string => boxes.get(id)?.node.name ?? id;
  let missing = 0, undeclared = 0, mismatched = 0;
  const undeclaredBy = new Map<string, DriftInput[]>();
  for (const it of items) {
    if (it.kind === 'declared-not-observed') {
      missing++;
      const b = boxes.get(it.nodeId);
      sentences.push(`${name(it.nodeId)} is declared but ${it.missingSince ? `has not been observed since ${it.missingSince.slice(0, 10)}` : 'no source observes it'}.`);
      if (b) {
        extras.push({ kind: 'highlight', id: `drift-${it.nodeId}`, rect: inflate(b, 6), color: 'red', style: 'frame', label: { lines: ['not observed'], size: style.subtitleSize, weight: 'medium', x: b.x, y: b.y - style.subtitleSize - 10, lineHeight: style.subtitleSize * 1.25, anchor: 'start' } });
      }
    } else if (it.kind === 'fact-mismatch') {
      mismatched++;
      const b = boxes.get(it.nodeId);
      sentences.push(`${name(it.nodeId)}: ${it.label} is declared as ${it.declared} but observed as ${it.observed}.`);
      if (b) {
        extras.push({ kind: 'highlight', id: `drift-${it.nodeId}-${it.label}`, rect: inflate(b, 6), color: 'amber', style: 'frame' });
        const text = `${it.label}: ${it.declared} → ${it.observed}`.replace(' → ', ' observed ');
        const w = wrapText(text, style.factSize, 'regular', style.noteWidth, 4);
        const rect = { x: b.x + b.w + 10, y: b.y, w: Math.ceil(w.width + 20), h: Math.ceil(w.height + 20) };
        extras.push({ kind: 'note', id: `drift-note-${it.nodeId}-${it.label}`, rect, text: { lines: w.lines, size: style.factSize, weight: 'regular', x: 10, y: 8, lineHeight: w.lineHeight, anchor: 'start' } });
      }
    } else {
      undeclared++;
      undeclaredBy.set(it.containerId, [...(undeclaredBy.get(it.containerId) ?? []), it]);
      sentences.push(`${it.name} (${it.type}) is observed inside ${name(it.containerId)} but the document does not declare it.`);
    }
  }
  for (const [containerId, list] of undeclaredBy) {
    const b = boxes.get(containerId);
    if (!b) continue;
    const lines = [`${list.length} observed, not declared:`, ...list.slice(0, 6).map((u) => (u.kind === 'observed-not-declared' ? `• ${u.name}` : '')), ...(list.length > 6 ? [`• and ${list.length - 6} more`] : [])];
    const w = Math.ceil(Math.max(...lines.map((l) => l.length)) * style.factSize * 0.55 + 20);
    const h = Math.ceil(lines.length * style.factSize * 1.3 + 16);
    const rect = { x: b.x + b.w + 12, y: b.y + (b.inner?.y ?? 0) - b.y, w: Math.min(w, style.noteWidth + 40), h };
    extras.push({ kind: 'highlight', id: `drift-container-${containerId}`, rect: inflate(b, 4), color: 'violet', style: 'frame' });
    extras.push({ kind: 'note', id: `drift-undeclared-${containerId}`, rect, text: { lines, size: style.factSize, weight: 'regular', x: 10, y: 6, lineHeight: style.factSize * 1.3, anchor: 'start' } });
  }
  // Grow the canvas for notes hanging off the right edge, then write the narrative.
  const right = Math.max(base.width, ...extras.flatMap((e) => (e.kind === 'note' ? [e.rect.x + e.rect.w + style.canvasPad] : [])));
  let y = base.height;
  const x = style.canvasPad;
  const maxW = Math.max(240, Math.min(style.proseWidth, right - style.canvasPad * 2));
  y += 14;
  const heading = sentences.length ? `${sentences.length} disagreement${sentences.length === 1 ? '' : 's'} between the document and what was observed` : 'The document agrees with everything observed';
  extras.push({ kind: 'text', id: 'drift-heading', role: 'heading', text: { lines: wrapText(heading, style.headingSize, 'semibold', maxW, 2, 1.3).lines, size: style.headingSize, weight: 'semibold', x, y, lineHeight: style.headingSize * 1.3, anchor: 'start' } });
  y += style.headingSize * 1.3 * (heading.length > 60 ? 2 : 1) + 6;
  for (const [i, s] of sentences.entries()) {
    const w = wrapText(s, style.proseSize, 'regular', maxW - 28, 4, 1.45);
    y += 6;
    const color = s.includes('not declare') ? 'violet' : s.includes('observed as') ? 'amber' : 'red';
    extras.push({ kind: 'badge', id: `drift-b-${i}`, at: { x: x + style.badgeRadius, y: y + style.proseSize * 0.62 }, text: '!', color });
    const t: TextBlock = { lines: w.lines, size: style.proseSize, weight: 'regular', x: x + 28, y, lineHeight: w.lineHeight, anchor: 'start' };
    extras.push({ kind: 'text', id: `drift-t-${i}`, role: 'prose', text: t });
    y += w.height;
  }
  y += style.canvasPad;
  return {
    sentences,
    counts: { missing, undeclared, mismatched },
    layout: { ...base, width: Math.ceil(right), height: Math.ceil(y), extras: [...(base.extras ?? []), ...extras] },
  };
}

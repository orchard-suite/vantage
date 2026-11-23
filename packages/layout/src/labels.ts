/**
 * Edge label placement. A label sits beside the longest segment of its
 * edge, centred, and slides along it, or moves to another segment, when it
 * would cover a box or another label, cross another edge, sit as near
 * another edge as its own (so a reader cannot tell which line it names),
 * or crowd its own arrowhead. Labels are measured, so they are never clipped.
 */
import type { Point, Rect } from './geometry.ts';
import { rectsOverlap, segmentCrossesRect } from './geometry.ts';
import { rectToLine } from './legibility.ts';
import { wrapText } from './text/measure.ts';
import type { EdgeLabel } from './types.ts';
import { RULES } from './style.ts';

export interface LabelOptions {
  readonly size: number;
  readonly pad: number;
  readonly maxWidth: number;
}

const NEAR = RULES.labelNear;
const HEAD = RULES.labelHead;

export interface Segment {
  readonly a: Point;
  readonly b: Point;
}

/** Wraps at the narrowest width that keeps the same number of lines, so a second line is never one orphaned word. */
function balancedWrap(text: string, size: number, maxWidth: number): ReturnType<typeof wrapText> {
  const first = wrapText(text, size, 'regular', maxWidth, 3);
  if (first.lines.length < 2) return first;
  let best = first;
  for (let w = maxWidth - 6; w >= 48; w -= 6) {
    const next = wrapText(text, size, 'regular', w, 3);
    if (next.lines.length !== first.lines.length || next.lines.some((l) => l.endsWith('…'))) break;
    best = next;
  }
  return best;
}

export function placeLabel(text: string, points: readonly Point[], obstacles: readonly Rect[], placed: readonly Rect[], opts: LabelOptions, otherEdges: readonly Segment[] = [], soft: readonly Rect[] = []): EdgeLabel {
  const wrapped = balancedWrap(text, opts.size, opts.maxWidth);
  const w = wrapped.width + opts.pad * 2;
  const h = wrapped.height + opts.pad * 2;
  const segments: { a: Point; b: Point; len: number; i: number }[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!;
    segments.push({ a, b, len: Math.abs(a.x - b.x) + Math.abs(a.y - b.y), i });
  }
  segments.sort((p, q) => q.len - p.len);
  let best: Rect | undefined;
  let bestScore = Infinity;
  const end = points[points.length - 1]!;
  for (const s of segments.slice(0, 6)) {
    const horizontal = s.a.y === s.b.y;
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.12, 0.88, 0.05, 0.95]) {
      const cx = s.a.x + (s.b.x - s.a.x) * t;
      const cy = s.a.y + (s.b.y - s.a.y) * t;
      // Snug against the line first; a little farther off when snug would crowd a neighbour.
      const candidates: Rect[] = horizontal
        ? [{ x: cx - w / 2, y: cy - h - 2, w, h }, { x: cx - w / 2, y: cy + 3, w, h }, { x: cx - w / 2, y: cy - h - 8, w, h }, { x: cx - w / 2, y: cy + 9, w, h }]
        : [{ x: cx + 6, y: cy - h / 2, w, h }, { x: cx - w - 6, y: cy - h / 2, w, h }, { x: cx + 11, y: cy - h / 2, w, h }, { x: cx - w - 11, y: cy - h / 2, w, h }];
      candidates.forEach((rect, k) => {
        const side = k % 2, far = k >= 2 ? 12 : 0;
        let score = Math.abs(t - 0.5) * 10 + (s.len < w ? 50 : 0) + segments.indexOf(s) * 5 + side * 3 + far + (horizontal ? 0 : 14);
        // Covering a box's words or icon is worse than any detour a label can take.
        for (const o of obstacles) if (rectsOverlap(rect, o)) score += 700;
        for (const o of soft) if (rectsOverlap(rect, o)) score += 120;
        for (const o of placed) if (rectsOverlap(rect, o, 2)) score += 60;
        for (const seg of otherEdges) {
          // Only segments whose box comes within NEAR of the label can touch or crowd it.
          if (Math.max(seg.a.x, seg.b.x) < rect.x - NEAR || Math.min(seg.a.x, seg.b.x) > rect.x + rect.w + NEAR || Math.max(seg.a.y, seg.b.y) < rect.y - NEAR || Math.min(seg.a.y, seg.b.y) > rect.y + rect.h + NEAR) continue;
          if (segmentCrossesRect(seg.a, seg.b, rect)) score += 400;
          else if (rectToLine(rect, [seg.a, seg.b]) < NEAR) score += 80;
        }
        // The arrowhead and the last few pixels before it belong to the box it points at.
        if (rectToLine(rect, [end, end]) < HEAD) score += 30;
        if (score < bestScore) {
          bestScore = score;
          best = rect;
        }
      });
      if (bestScore === 0) break;
    }
    if (bestScore === 0) break;
  }
  // A line too short to hold its label between the boxes it joins: step the label off the line, across the boxes, until it clears them.
  if (bestScore >= 700) {
    const s = segments[0]!;
    const horizontal = s.a.y === s.b.y;
    const cx = (s.a.x + s.b.x) / 2;
    const cy = (s.a.y + s.b.y) / 2;
    for (let d = 16; d <= 200 && bestScore >= 700; d += 12) {
      const tries: Rect[] = horizontal ? [{ x: cx - w / 2, y: cy - h - d, w, h }, { x: cx - w / 2, y: cy + d, w, h }] : [{ x: cx + d, y: cy - h / 2, w, h }, { x: cx - w - d, y: cy - h / 2, w, h }];
      for (const rect of tries) {
        let score = 200 + d;
        for (const o of obstacles) if (rectsOverlap(rect, o)) score += 700;
        for (const o of placed) if (rectsOverlap(rect, o, 2)) score += 60;
        for (const seg of otherEdges) if (segmentCrossesRect(seg.a, seg.b, rect)) score += 400;
        if (score < bestScore) {
          bestScore = score;
          best = rect;
        }
      }
    }
  }
  const r = best ?? { x: points[0]!.x, y: points[0]!.y - h, w, h };
  return { ...r, text, lines: wrapped.lines, size: opts.size };
}

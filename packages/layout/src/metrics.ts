/**
 * Quality metrics for a laid-out view. These are the numbers an agent reads
 * back after a render to decide whether the diagram is good enough or needs
 * a split, a collapse, or a different arrangement.
 */
import { rectsOverlap, segmentCrossesRect, segmentsCross } from './geometry.ts';
import type { Extra, LayoutBox, LayoutEdge, QualityMetrics } from './types.ts';
import { CROWD, measureLegibility } from './legibility.ts';

export function measureQuality(boxes: readonly LayoutBox[], edges: readonly LayoutEdge[], width: number, height: number, extras: readonly Extra[] = []): QualityMetrics {
  let crossings = 0;
  let bends = 0;
  let edgeBoxCrossings = 0;
  let labelOverlaps = 0;
  const leaves = boxes.filter((b) => b.kind !== 'container');
  const segs = edges.flatMap((e) => {
    const out = [];
    for (let i = 0; i + 1 < e.points.length; i++) out.push({ a: e.points[i]!, b: e.points[i + 1]!, edge: e.id });
    return out;
  });
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i]!, t = segs[j]!;
      if (s.edge === t.edge) continue;
      if (segmentsCross(s.a, s.b, t.a, t.b)) crossings++;
    }
  }
  for (const e of edges) {
    bends += Math.max(0, e.points.length - 2);
    const ends = new Set([e.from, e.to]);
    for (let i = 0; i + 1 < e.points.length; i++) {
      for (const b of leaves) {
        if (ends.has(b.id)) continue;
        if (segmentCrossesRect(e.points[i]!, e.points[i + 1]!, { x: b.x + 1, y: b.y + 1, w: b.w - 2, h: b.h - 2 })) edgeBoxCrossings++;
      }
    }
  }
  const labels = edges.map((e) => e.label).filter((l): l is NonNullable<typeof l> => l !== undefined);
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) if (rectsOverlap(labels[i]!, labels[j]!)) labelOverlaps++;
    for (const b of leaves) if (rectsOverlap(labels[i]!, b)) labelOverlaps++;
  }
  const connected = new Set(edges.flatMap((e) => [e.from, e.to, ...e.members.flatMap((m) => m.split('>'))]));
  const unconnected = leaves.filter((b) => !connected.has(b.id)).length;
  const backEdges = edges.filter((e) => e.reversed).length;
  const aspect = height ? width / height : 1;
  const notes: string[] = [];
  let score = 100;
  score -= Math.min(40, crossings * 4);
  score -= Math.min(20, edgeBoxCrossings * 5);
  score -= Math.min(15, labelOverlaps * 3);
  score -= Math.min(10, Math.max(0, bends - edges.length * 2) * 0.5);
  score -= Math.min(10, backEdges * 2);
  const read = measureLegibility(boxes, edges, extras);
  score -= Math.min(12, read.labelDrift * 3);
  score -= Math.min(9, read.labelOnFrame * 3);
  score -= Math.min(12, read.labelCrossed * 4);
  score -= Math.min(10, read.hugging * 2);
  score -= Math.min(12, read.sharedRuns * 3);
  score -= Math.min(8, read.borderRuns * 2);
  score -= Math.min(8, read.frameRuns * 2);
  score -= Math.min(8, read.jogs);
  score -= Math.min(9, read.crowdedSides * 3);
  score -= Math.min(9, read.badgeOverlaps * 3);
  score -= Math.min(10, read.truncated * 2);
  score -= Math.min(9, read.detours * 3);
  score -= Math.min(12, read.throughText * 4);
  score -= Math.min(12, read.frameLoops * 4);
  if (aspect > 3.2 || aspect < 0.35) {
    score -= 8;
    notes.push(`aspect ratio ${aspect.toFixed(2)} is extreme; consider direction: ${aspect > 3.2 ? 'down' : 'right'} or splitting the view`);
  }
  if (crossings > 0) notes.push(`${crossings} edge crossings; reorder children with arrange.order or move a relation to another view`);
  if (edgeBoxCrossings > 0) notes.push(`${edgeBoxCrossings} edges pass through boxes; add arrange hints or collapse a container`);
  if (labelOverlaps > 0) notes.push(`${labelOverlaps} labels overlap something; shorten labels or add room with arrange.gap`);
  if (unconnected > 0 && edges.length > 0) notes.push(`${unconnected} boxes have no arrows in this view; remove them or give them a relation`);
  if (read.labelDrift > 0) notes.push(`${read.labelDrift} labels sit away from their own line`);
  if (read.labelCrossed > 0) notes.push(`${read.labelCrossed} labels have another line running through them`);
  if (read.labelOnFrame > 0) notes.push(`${read.labelOnFrame} labels lie across a container's frame`);
  if (read.hugging > 0) notes.push(`${read.hugging} pairs of lines run a few pixels apart`);
  if (read.sharedRuns > 0) notes.push(`${read.sharedRuns} runs where two lines lie on top of each other`);
  if (read.borderRuns > 0) notes.push(`${read.borderRuns} lines run along a box or container border`);
  if (read.frameRuns > 0) notes.push(`${read.frameRuns} long runs follow a container's frame`);
  if (read.jogs > 0) notes.push(`${read.jogs} short jogs kink a line`);
  if (read.crowdedSides > 0) notes.push(`${read.crowdedSides} box sides have arrows closer than ${CROWD} pixels`);
  if (read.badgeOverlaps > 0) notes.push(`${read.badgeOverlaps} story badges cover a badge or a label`);
  if (read.truncated > 0) notes.push(`${read.truncated} text lines are cut short; shorten the text`);
  if (read.throughText > 0) notes.push(`${read.throughText} lines cross a container's title or facts`);
  if (read.frameLoops > 0) notes.push(`${read.frameLoops} lines leave a container and come back into it`);
  if (read.detours > 0) notes.push(`${read.detours} edges detour far around the picture`);
  if (leaves.length > 40) notes.push(`${leaves.length} leaf boxes; readers do best under 25 per view, consider collapse or a second view`);
  if (edges.length === 0) notes.push('no relations: this view is an inventory, not a story');
  return {
    crossings,
    bends,
    edgeBoxCrossings,
    labelOverlaps,
    backEdges,
    unconnected,
    boxes: boxes.length,
    edges: edges.length,
    area: Math.round(width * height),
    aspect: Math.round(aspect * 100) / 100,
    legibility: read,
    score: Math.max(0, Math.round(score)),
    notes,
  };
}

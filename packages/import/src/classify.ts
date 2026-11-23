/**
 * What each shape of a page is for. Shapes with text become nodes; a
 * group with no visual of its own is transparent; an unlabeled box drawn
 * around several boxes is a highlight; a picture inside a labelled box is
 * its icon; a legend is noted and dropped. Containment comes from the file
 * when it records parents and from geometry when it does not.
 */
import type { RawPage, RawShape } from './drawing.ts';
import { area, contains } from './drawing.ts';
import { isShortLabel } from './text.ts';

export type NodeKind = 'node' | 'text' | 'image' | 'note';

export interface Classified {
  readonly shape: RawShape;
  readonly kind: NodeKind;
  /** Final parent shape id after groups fell through and geometry was read. */
  readonly parentId?: string;
  /** Lines merged in from label cells sitting on this shape. */
  readonly lines: readonly string[];
  /** The parent was recorded by the file, not inferred from geometry. */
  readonly explicitParent: boolean;
  /** A picture drawn inside this box, which becomes its icon. */
  readonly icon?: RawShape;
}

export interface HighlightBox {
  readonly shape: RawShape;
  readonly members: readonly string[];
  readonly label?: string;
}

export interface Dropped {
  readonly id: string;
  readonly reason: string;
}

export interface PageClassification {
  readonly nodes: readonly Classified[];
  readonly highlights: readonly HighlightBox[];
  readonly dropped: readonly Dropped[];
  readonly legend: boolean;
}

/** The shape draws a picture: an embedded one or a vendor library icon. */
const pictured = (s: RawShape): boolean => s.image !== undefined || s.iconHint !== undefined;

const LEGEND_GLYPHS = /^[→□■─⬜⬛●○]/;

function isLegend(s: RawShape): boolean {
  if (s.id.startsWith('x-legend')) return true;
  const first = s.lines[0]?.toLowerCase() ?? '';
  if (/^(legend|key)$/.test(first)) return true;
  return s.lines.length >= 2 && s.lines.every((l) => LEGEND_GLYPHS.test(l));
}

/** A count bubble: "3", "+2 more", "27 inside". */
function isBadge(lines: readonly string[]): boolean {
  return lines.length === 1 && (lines[0]!.length <= 2 || /^\+?\d+( more| inside)?$/.test(lines[0]!));
}

export function classifyPage(page: RawPage): PageClassification {
  const byId = new Map(page.shapes.map((s) => [s.id, s]));
  const dropped: Dropped[] = [];
  const drop = (id: string, reason: string): void => {
    dropped.push({ id, reason });
  };

  // Legends and everything explicitly inside them go.
  const legendIds = new Set(page.shapes.filter(isLegend).map((s) => s.id));
  const inLegend = (s: RawShape): boolean => {
    for (let p = s.parentId; p !== undefined; p = byId.get(p)?.parentId) if (legendIds.has(p)) return true;
    return legendIds.has(s.id);
  };
  for (const s of page.shapes) if (inLegend(s)) drop(s.id, 'legend');
  const live = page.shapes.filter((s) => !inLegend(s));
  const liveIds = new Set(live.map((s) => s.id));
  const explicitChildren = (id: string): RawShape[] => live.filter((s) => s.parentId === id);

  // Groups and unlabeled boxes are transparent: their children belong to whatever holds the group.
  const transparent = new Set<string>();
  for (const s of live) {
    if (s.group) transparent.add(s.id);
    else if (s.lines.length === 0 && !pictured(s) && explicitChildren(s.id).length === 1) transparent.add(s.id);
  }
  const effectiveParent = (s: RawShape): string | undefined => {
    let p = s.parentId;
    while (p !== undefined && (transparent.has(p) || !liveIds.has(p))) p = byId.get(p)?.parentId;
    return p;
  };
  for (const id of transparent) drop(id, 'group with no visual of its own');

  // A container that draws a vendor icon (an AWS group, a VPC) stays a box and wears the icon.
  const kindOf = (s: RawShape): NodeKind => (pictured(s) && !s.container ? 'image' : s.note ? 'note' : s.text ? 'text' : 'node');
  const labelled = (s: RawShape): boolean => s.lines.length > 0 || pictured(s);
  const boxes = live.filter((s) => !transparent.has(s.id));

  // Highlight candidates: no label, or a short label over boxes the file already parents elsewhere.
  const highlights = new Map<string, HighlightBox>();
  const isHighlightBox = (s: RawShape): boolean => {
    if (kindOf(s) !== 'node' || s.container && s.lines.length > 0) return false;
    if (s.lines.length === 0) return true;
    if (!isShortLabel(s.lines) || explicitChildren(s.id).length) return false;
    const inside = boxes.filter((o) => o !== s && labelled(o) && contains(s.rect, o.rect) && area(o.rect) < area(s.rect));
    return inside.length >= 2 && inside.every((o) => effectiveParent(o) !== undefined && effectiveParent(o) !== s.id);
  };
  const highlightIds = new Set(boxes.filter((s) => !labelled(s) || isHighlightBox(s)).map((s) => s.id));

  // Containment: the file's parent, else the smallest labelled box around the shape in the same scope.
  const parentOf = new Map<string, { id: string; explicit: boolean }>();
  const canHold = (p: RawShape): boolean => kindOf(p) === 'node' && p.lines.length > 0 && !highlightIds.has(p.id);
  for (const s of boxes) {
    if (highlightIds.has(s.id)) continue;
    const explicit = effectiveParent(s);
    const scope = explicit;
    const holders = boxes.filter((p) => p !== s && canHold(p) && effectiveParent(p) === scope && area(p.rect) > area(s.rect) * 1.02 && contains(p.rect, s.rect));
    holders.sort((a, b) => area(a.rect) - area(b.rect));
    const holder = holders[0];
    if (holder) parentOf.set(s.id, { id: holder.id, explicit: false });
    else if (explicit !== undefined && !highlightIds.has(explicit)) parentOf.set(s.id, { id: explicit, explicit: true });
    else if (explicit !== undefined) {
      // Parented to a highlight box: the box falls through to its own holder.
      const up = parentOf.get(explicit)?.id ?? effectiveParent(byId.get(explicit)!);
      if (up !== undefined) parentOf.set(s.id, { id: up, explicit: true });
    }
  }

  // Icons and count bubbles inside any labelled box are decoration of that box; small labels inside a labelled leaf join its text.
  const decorative = (o: RawShape): boolean => pictured(o) || isBadge(o.lines) || (o.text && o.lines.length <= 2);
  const isIcon = (o: RawShape, holder: RawShape): boolean => pictured(o) && o.lines.length === 0 && area(o.rect) < area(holder.rect) * 0.25;
  const icons = new Map<string, RawShape>();
  const isLeafHolder = (holder: RawShape): boolean => !holder.container && holder.lines.length > 0 && boxes.filter((o) => parentOf.get(o.id)?.id === holder.id).every(decorative);
  const merged = new Map<string, string[]>();
  const nodes: Classified[] = [];
  for (const s of boxes) {
    if (highlightIds.has(s.id)) continue;
    const kind = kindOf(s);
    const parent = parentOf.get(s.id);
    const holder = parent ? byId.get(parent.id) : undefined;
    if (holder && holder.lines.length > 0 && isIcon(s, holder)) {
      const had = icons.get(holder.id);
      if (!had || area(s.rect) > area(had.rect)) icons.set(holder.id, s);
      drop(s.id, `icon of ${holder.id}`);
      continue;
    }
    if (holder && holder.lines.length > 0 && isBadge(s.lines)) {
      drop(s.id, `badge on ${holder.id}`);
      continue;
    }
    if (holder && isLeafHolder(holder)) {
      merged.set(holder.id, [...(merged.get(holder.id) ?? []), ...s.lines]);
      drop(s.id, `label merged into ${holder.id}`);
      continue;
    }
    nodes.push({ shape: s, kind, ...(parent ? { parentId: parent.id } : {}), lines: s.lines, explicitParent: parent?.explicit ?? false });
  }
  const withMerged = nodes.map((n): Classified => {
    const icon = icons.get(n.shape.id);
    const lines = merged.has(n.shape.id) ? [...n.lines, ...merged.get(n.shape.id)!] : n.lines;
    return { ...n, lines, ...(icon ? { icon } : {}) };
  });

  // Highlight members: the topmost kept shapes inside the box, which must be siblings.
  const kept = new Set(withMerged.map((n) => n.shape.id));
  for (const id of highlightIds) {
    const box = byId.get(id)!;
    const inside = withMerged.filter((n) => contains(box.rect, n.shape.rect) && area(n.shape.rect) < area(box.rect));
    const topmost = inside.filter((n) => !(n.parentId !== undefined && inside.some((o) => o.shape.id === n.parentId)));
    const groups = new Map<string, string[]>();
    for (const n of topmost) {
      const key = parentOf.get(n.shape.id)?.id ?? '';
      groups.set(key, [...(groups.get(key) ?? []), n.shape.id]);
    }
    const best = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
    if (best.length >= 2 && best.every((m) => kept.has(m))) {
      highlights.set(id, { shape: box, members: best, ...(box.lines.length ? { label: box.lines.join(' ') } : {}) });
      drop(id, `box around ${best.length} siblings, kept as a highlight`);
    } else drop(id, box.lines.length ? `short label with nothing to frame` : 'decoration without text');
  }

  return { nodes: withMerged, highlights: [...highlights.values()], dropped, legend: legendIds.size > 0 };
}

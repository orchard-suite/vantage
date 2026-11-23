/**
 * How wide a gutter between two siblings must be. Every line that crosses it
 * may jog there, so each gets a lane of its own, and its widest label needs a
 * band no lane runs through. A gutter never shrinks below the gap asked for.
 */

/** A line between two siblings, with the size of its label (0 by 0 when it has none). */
export interface GutterEdge {
  readonly from: string;
  readonly to: string;
  readonly label: { readonly w: number; readonly h: number };
}

export interface GutterStyle {
  /** Clear space between a box and the nearest line. */
  readonly edgeMargin: number;
  /** Space between two lines running side by side. */
  readonly laneGap: number;
  readonly labelPad: number;
}

/**
 * The size across a gutter that holds these lines side by side, beside their largest label, with a margin to each box.
 * `across` is the gutter's own axis: 'x' for the gap between two columns, 'y' for the gap between two rows.
 */
export function gutterWidth(crossing: readonly GutterEdge[], across: 'x' | 'y', style: GutterStyle): number {
  if (!crossing.length) return 0;
  const label = Math.max(0, ...crossing.map((e) => (across === 'x' ? e.label.w : e.label.h)));
  const lanes = (crossing.length - 1) * style.laneGap;
  return style.edgeMargin * 2 + lanes + (label > 0 ? label + style.labelPad * 2 + style.laneGap : 0);
}

/** The lines that cross the gutter after slot `at`, given each end's slot (its column or row, or its layer). */
export function crossingAfter(edges: readonly GutterEdge[], slot: ReadonlyMap<string, number>, at: number): GutterEdge[] {
  return edges.filter((e) => {
    const a = slot.get(e.from), b = slot.get(e.to);
    return a !== undefined && b !== undefined && Math.min(a, b) <= at && at < Math.max(a, b);
  });
}

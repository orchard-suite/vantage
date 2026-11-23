/** Every size the layout uses, in canvas pixels. One place, so the look is one system. */
export interface LayoutStyle {
  readonly nameSize: number;
  readonly subtitleSize: number;
  readonly containerNameSize: number;
  readonly labelSize: number;
  readonly iconSize: number;
  readonly containerIconSize: number;
  readonly leafPadX: number;
  readonly leafPadY: number;
  readonly leafMinWidth: number;
  readonly leafMaxTextWidth: number;
  readonly containerPad: number;
  readonly containerHeader: number;
  readonly siblingGap: number;
  readonly layerGap: number;
  readonly gridGap: number;
  readonly canvasPad: number;
  readonly edgeMargin: number;
  /** Space between two lines running side by side in a gutter; a gutter grows a lane per line that crosses it. */
  readonly laneGap: number;
  readonly labelPad: number;
  readonly factSize: number;
  readonly valueSize: number;
  readonly bigIconSize: number;
  readonly noteWidth: number;
  readonly indent: number;
  readonly badgeRadius: number;
  /** The open item count on a bound box's corner: its radius and its figure. */
  readonly openBadgeRadius: number;
  readonly openBadgeText: number;
  readonly proseWidth: number;
  readonly headingSize: number;
  readonly proseSize: number;
  /** Legend entry text; the renderer draws legend rows at this size. */
  readonly legendTextSize: number;
  /** Timeline views: one row per item, a date track, arrows for what waits on what. */
  readonly timeline: TimelineStyle;
  /** A box drawn at another size than normal: its name a step from nameSize, its icon, its widths, its padding. Normal uses the leaf sizes above. */
  readonly nodeSizes: Readonly<Record<'compact' | 'large' | 'icon', NodeSizeStyle>>;
  /** Flowchart steps by shape: how wide their text wraps, their padding, their narrowest width. */
  readonly flowStep: FlowStepStyle;
}

export interface NodeSizeStyle {
  /** Added to nameSize. */
  readonly nameStep: number;
  /** The icon's size; none means bigIconSize. */
  readonly icon?: number;
  readonly minWidth: number;
  readonly maxText: number;
  readonly padX: number;
  readonly padY: number;
}

export interface FlowStepStyle {
  readonly maxText: number;
  readonly decisionMaxText: number;
  readonly padX: number;
  /** Start and end are pills: rounder ends take more room. */
  readonly pillPadX: number;
  readonly decisionPadX: number;
  readonly padY: number;
  readonly decisionPadY: number;
  readonly minWidth: number;
  readonly decisionMinWidth: number;
}

export interface TimelineStyle {
  readonly laneTitleWidth: number;
  readonly barHeight: number;
  readonly rowGap: number;
  readonly axisHeight: number;
  readonly milestone: number;
  /** Space between the lane titles and the first date, and after the last. */
  readonly trackInset: number;
  readonly labelGap: number;
  readonly minBarWidth: number;
  /** An outside label wraps to two lines past this width. */
  readonly labelMaxWidth: number;
  readonly dayWidth: number;
  readonly stepWidth: number;
  readonly minTrack: number;
  readonly maxTrack: number;
  /** The shortest run an arrow takes into the left end of the next item. */
  readonly elbowRun: number;
}

/** Width of a count chip ("3 inside", "+2 more"): layout keeps ports off it and the renderer draws it this wide. */
export function chipWidth(label: string): number {
  return label.length * 6.4 + 14;
}

export const DEFAULT_STYLE: LayoutStyle = {
  nameSize: 13,
  subtitleSize: 11,
  containerNameSize: 13,
  labelSize: 11,
  iconSize: 26,
  containerIconSize: 18,
  leafPadX: 14,
  leafPadY: 12,
  leafMinWidth: 128,
  leafMaxTextWidth: 150,
  containerPad: 18,
  containerHeader: 34,
  siblingGap: 22,
  layerGap: 72,
  gridGap: 18,
  canvasPad: 28,
  edgeMargin: 14,
  laneGap: 16,
  labelPad: 4,
  factSize: 11,
  valueSize: 24,
  bigIconSize: 44,
  noteWidth: 170,
  indent: 26,
  badgeRadius: 10,
  openBadgeRadius: 9,
  openBadgeText: 10,
  proseWidth: 720,
  headingSize: 18,
  proseSize: 12.5,
  legendTextSize: 10.5,
  timeline: {
    laneTitleWidth: 140,
    barHeight: 34,
    rowGap: 14,
    axisHeight: 44,
    milestone: 22,
    trackInset: 28,
    labelGap: 8,
    minBarWidth: 14,
    labelMaxWidth: 360,
    dayWidth: 24,
    stepWidth: 120,
    minTrack: 720,
    maxTrack: 1600,
    elbowRun: 12,
  },
  nodeSizes: {
    compact: { nameStep: -1, icon: 20, minWidth: 92, maxText: 120, padX: 10, padY: 8 },
    large: { nameStep: 2, icon: 34, minWidth: 176, maxText: 200, padX: 18, padY: 16 },
    icon: { nameStep: -1, minWidth: 0, maxText: 130, padX: 6, padY: 4 },
  },
  flowStep: { maxText: 160, decisionMaxText: 120, padX: 16, pillPadX: 22, decisionPadX: 34, padY: 12, decisionPadY: 18, minWidth: 110, decisionMinWidth: 120 },
};

/**
 * The distances the engine's own passes keep, and the sizes it judges a
 * picture by, in canvas pixels. A document never changes them, so they are
 * not part of the style a caller passes; they live here so every size the
 * engine uses is in one file.
 */
export const RULES = {
  /** Ports on one side keep this far apart, and this far from the side's corners. */
  portGap: 16,
  /** A moved port keeps this far from its side's corners and from other ports. */
  portRoom: 16,
  /** Jogs shorter than this are removed when they can be. */
  kink: 16,
  /** How far a run is slid to part it from another. */
  part: 18,
  /** A slid run must keep at least this far from any other line beside it, and from box borders. */
  partClear: 16,
  /** Sideways, runs closer than this count as one line. */
  sameLine: 3,
  /** End to end across a gap shorter than this, two slid runs read as one stroke. */
  partGap: 120,
  /** End to end on one line, a gap shorter than this reads as one line. */
  strokeGap: 40,
  /** Another edge closer than this to a label reads as the label's own. */
  labelNear: 16,
  /** Room a label keeps clear around the arrowhead. */
  labelHead: 16,
  /** Widest a page may be and still read on a laptop screen; wider, it drops a column. */
  pageMaxWidth: 2400,
  /** Sequence views: a message row, the header of lifeline titles, a fragment's title band. */
  sequence: { row: 34, header: 48, fragmentHead: 26 },
  /** What legibility counts as a trip for the reader. */
  legibility: {
    /** A label farther than this from its own line is adrift. */
    labelReach: 12,
    /** Another edge nearer a label than this makes it ambiguous, however close its own line is. */
    labelClear: 14,
    /** Parallel segments of different edges closer than this hug. */
    hug: 16,
    /** An inner segment shorter than this is a kink, not a turn. */
    jog: 14,
    /** Two ports on a side closer than this read as a pile. */
    crowd: 12,
    /** Two edges on one line for longer than this cannot be told apart. */
    shared: 20,
    /** A line closer than this to a drawn border reads as part of the frame. */
    border: 8,
    /** A line closer than this to a container's frame, for longer than frameRun, tours the frame. */
    frameNear: 28,
    frameRun: 160,
  },
  /** The title block a published picture carries: its padding, its title, subtitle, and meta lines. */
  titleBlock: { pad: 20, title: 18, subtitle: 12, meta: 11, metaLine: 16 },
  /** Side of a story badge's hit square: 24 screen pixels at the viewer's readable opening zoom of one half. */
  badgeHit: 48,
} as const;

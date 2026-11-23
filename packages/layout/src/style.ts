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
  /** Sequence views: rows, lifeline heads, fragments, notes, activations, and the text on messages. */
  sequence: {
    /** A message row, the header of lifeline titles, a fragment's title band. */
    row: 34,
    header: 48,
    fragmentHead: 26,
    /** Space under the heads before the first row, and after the last row. */
    headerGap: 30,
    tail: 24,
    /** Extra height under a fragment's title, an else divider's row, a fragment's closing row. */
    fragmentOpenPad: 6,
    elseRow: 22,
    closeRow: 14,
    /** A row a destroyed participant's cross sits in; the cross is drawn at its middle. */
    destroyRow: 26,
    cross: 9,
    /** How wide a note and a message label wrap. */
    noteWrap: 220,
    labelWrap: 240,
    /** A note's row: room around its text, its inset in the row, its text's offset, how far it spans past its lifelines. */
    notePad: 22,
    noteInset: 4,
    noteTextX: 12,
    noteTextY: 8,
    noteRoom: 24,
    noteSpan: 40,
    noteBeside: 18,
    /** Room above and below a message's label, the extra height of a self call, a created participant's row. */
    messagePad: 20,
    selfExtra: 14,
    createdExtra: 12,
    /** Where a self call's label sits, its arrow's top and bottom inside the row, and a label's lift off its line. */
    selfLabelX: 22,
    selfLabelY: 6,
    selfTop: 8,
    selfBottom: 10,
    labelLift: 3,
    /** An activation bar's width, how far each nested one steps right, and where it ends above the reply. */
    activationWidth: 8,
    activationStep: 8,
    activationTail: 6,
    /** A lifeline head: its narrowest width, the room beside its name, and the gap and label room between two. */
    headMinWidth: 120,
    headPad: 32,
    headGap: 36,
    labelRoom: 36,
    /** A head's name and subtitle offsets: the name alone sits lower. */
    nameTop: 10,
    nameAloneTop: 15,
    subtitleTop: 28,
    /** A fragment's reach past its outer lifelines, how far it overhangs them, and how far a nested one steps in. */
    fragmentReach: 10,
    fragmentOverhang: 12,
    fragmentInset: 10,
  },
  /** Node boxes: room around an icon, gaps between a box's text blocks, the cylinder's lip, the widths text wraps to. */
  node: {
    factWrapMin: 140,
    blockGap: 4,
    iconGap: 6,
    iconRoom: 16,
    iconTextGap: 8,
    sideIconGap: 10,
    cylinderLip: 10,
    textMaxText: 340,
    /** A text box's name wraps to this many lines. */
    textMaxLines: 8,
    valueWrap: 220,
    /** The step a box widens by while it searches for a width its facts fit. */
    widthStep: 20,
  },
  /** Container headers: the count badge's room, an unframed container's padding, the gaps along the header. */
  container: {
    badgeRoom: 16,
    unframedPad: 6,
    unframedInnerTop: 4,
    iconGap: 8,
    headerGap: 10,
    detailsMinWidth: 260,
    detailsInset: 8,
    detailsGap: 4,
    nameTop: 10,
    iconTop: 9,
    /** The header band a label keeps off ends this far above the inner area. */
    headerInset: 4,
  },
  /** Edge labels: how wide they wrap, the room a layer keeps for one, the narrowing search, the spots tried beside a line, and the nudge outward when all are taken. */
  edgeLabel: {
    maxWidth: 160,
    roomX: 36,
    roomY: 28,
    narrowStep: 6,
    minWidth: 48,
    nearAbove: 2,
    farAbove: 8,
    nearBelow: 3,
    farBelow: 9,
    nearSide: 6,
    farSide: 11,
    nudgeStart: 16,
    nudgeStep: 12,
    nudgeMax: 200,
  },
  /** An outline arrangement: the least gap between rows, and how much tighter than the sibling gap it runs. */
  outline: { minGap: 8, gapCut: 8 },
  /** Flowcharts: label wrap and room, the layer gap's trim, and the swimlanes' title band, floor, and padding. */
  flow: { labelWrap: 120, roomX: 24, roomY: 16, layerTrim: 8, laneTitle: 36, laneMin: 80, lanePad: 48, laneLead: 24, laneTail: 12, laneTitleX: 14, laneTitleY: 10 },
  /** Pages of views: the text column's floor and fallback width, and the gaps under a heading and a paragraph. */
  page: { textMin: 320, textFallback: 480, headingGap: 8, textGap: 12 },
  /** Ports: the slack a side keeps before it spreads them, and the room kept clear of a header's count chip. */
  ports: { slack: 8, chipClear: 8 },
  /** A leaf's count chip ("+3 more"): its height, how far it rises above the top edge, and how far it overhangs the right one. */
  chip: { height: 18, rise: 9, overhang: 6 },
  /** Routing: what a relation pass keeps clear. */
  relation: {
    /** Two ends closer than this crowd one port. */
    crowdedEnd: 16,
    /** A self loop runs this much wider than the edge margin. */
    loopMargin: 6,
    /** Half the thickness of the strip a frame line counts as. */
    frameStrip: 3,
  },
  /** The router's distances: its margin off boxes, its side lanes, how near a border and a frame counts, and the straight stub at a port. */
  router: { margin: 14, lane: 16, borderGap: 8, frameGap: 28, stub: 8 },
  /** Pinned boxes: the room searched around them, the canvas when none is placed, the search's step, and what a spot outside its parent costs. */
  pinned: { canvasMargin: 400, emptyCanvas: 4000, searchStep: 24, outsideCost: 600 },
  /** A matrix gesture's least padding around its cells. */
  gesture: { matrixPadMin: 30 },
  /** What the diff, drift, and highlight overlays draw around boxes: frames, notes, and lists. */
  overlay: {
    highlightPad: 6,
    containerHighlightPad: 4,
    /** A box counts as moved past this many pixels. */
    movedMin: 24,
    labelRise: 10,
    noteGap: 10,
    notePad: 10,
    noteTextTop: 8,
    listGap: 12,
    listPadX: 10,
    listPadY: 8,
    listTextTop: 6,
    listExtraWidth: 40,
    /** A highlighted set's frame and its label. */
    setPad: 8,
    setLabelRise: 4,
  },
  /** The prose under a picture: its floor width, the space above a heading, after a count heading, after a heading, between paragraphs and paths, and the badge column. */
  prose: { minWidth: 240, headingTop: 14, countGap: 4, headingGap: 6, paragraphGap: 6, pathGap: 8, badgeColumn: 28 },
  /** The legend: a column's floor, its swatch and trailing room, the most columns, its inset, its top gap, and a row. */
  legend: { minColumn: 150, swatch: 36, room: 18, maxColumns: 3, inset: 16, top: 14, row: 20 },
  /** Story notes and captions beside a box: padding, gap, and the clearance kept off other boxes. */
  notes: { pad: 10, captionPad: 6, gap: 10, captionGap: 22, clearance: 4 },
  /** Path badges along an edge: the clearance beside a label, the step outward, and the disc kept clear around one. */
  badges: { labelClear: 6, step: 14, discPad: 3, clearance: 6 },
  /** Timeline text and arrows: a lane title's inset, tick marks and labels, an item's label room, and where an arrow leaves and enters. */
  timelineText: { titleInset: 20, titleX: 12, tickRise: 6, tickLabelTop: 10, labelRoom: 20, labelInset: 16, exitMax: 12, entryClear: 6, entryInset: 10, near: 6 },
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
    /** A port within this of a side lies on it. */
    onSide: 1.5,
    /** Room around a container's header text, and where its count chip sits in the header: in from the right, down from the top. */
    headerPad: 4,
    chipInset: 10,
    chipTop: 9,
    /** Hugging lines and a line along a border count only past these runs. */
    hugRun: 24,
    borderRun: 30,
    /** Half a story badge's side, as legibility measures it. */
    badgeHalf: 10,
    /** A route shorter than this is never a detour. */
    detourMin: 320,
  },
  /** The title block a published picture carries: its padding, its title, subtitle, and meta lines. */
  titleBlock: { pad: 20, title: 18, subtitle: 12, meta: 11, metaLine: 16 },
  /** Side of a story badge's hit square: 24 screen pixels at the viewer's readable opening zoom of one half. */
  badgeHit: 48,
} as const;

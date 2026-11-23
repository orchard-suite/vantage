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
};

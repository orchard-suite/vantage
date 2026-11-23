/** Layout output. Coordinates are absolute canvas pixels; the renderer scales. */
import type { ModelNode, ModelRelation, RelationKind, NodeShape, Frame, EdgeStyle, Head } from '@vantage/model';
import type { Point, Rect } from './geometry.ts';
import type { Legibility } from './legibility.ts';

export type BoxKind = 'leaf' | 'container' | 'collapsed';

export interface TextBlock {
  readonly lines: readonly string[];
  readonly size: number;
  readonly weight: 'regular' | 'medium' | 'semibold';
  readonly x: number;
  readonly y: number;
  readonly lineHeight: number;
  readonly anchor: 'start' | 'middle';
}

export interface LayoutBox extends Rect {
  readonly id: string;
  readonly kind: BoxKind;
  readonly depth: number;
  readonly node: ModelNode;
  readonly shape: NodeShape;
  readonly name: TextBlock;
  readonly subtitle?: TextBlock;
  readonly icon?: { readonly id: string; readonly x: number; readonly y: number; readonly size: number };
  /** A picture drawn inside the box; href is a path, URL, or data URL. */
  readonly image?: { readonly href: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Count badge such as "+3 more" or "x4". */
  readonly badge?: string;
  /** Facts, bullets, and the big value, already measured and positioned. */
  readonly texts?: readonly TextBlock[];
  readonly frame: Frame;
  /** Icon-only presentation: no shape, a large icon with the name as caption. */
  readonly iconOnly: boolean;
  readonly parentId?: string;
  /** Rect of the child area for containers. */
  readonly inner?: Rect;
}

export interface EdgeLabel extends Rect {
  readonly text: string;
  readonly lines: readonly string[];
  readonly size: number;
}

export interface LayoutEdge {
  readonly id: string;
  readonly relation: ModelRelation;
  /** Visible endpoints after collapsing, which can differ from relation.from/to. */
  readonly from: string;
  readonly to: string;
  readonly kind: RelationKind;
  readonly points: readonly Point[];
  readonly label?: EdgeLabel;
  readonly both: boolean;
  /** How many model relations this drawn edge stands for. */
  readonly bundled: number;
  /** Original endpoints when the edge was lifted to a container: `from>to` per member. */
  readonly members: readonly string[];
  readonly reversed: boolean;
  /** Set when a path claims the edge; the renderer colors the line. */
  readonly color?: string;
  readonly pathIds?: readonly string[];
  readonly style: EdgeStyle;
  readonly heads?: { readonly from?: Head | undefined; readonly to?: Head | undefined };
}

export interface QualityMetrics {
  readonly crossings: number;
  readonly bends: number;
  readonly edgeBoxCrossings: number;
  readonly labelOverlaps: number;
  readonly backEdges: number;
  readonly unconnected: number;
  readonly boxes: number;
  readonly edges: number;
  readonly area: number;
  readonly aspect: number;
  /** Reader-facing checks beyond crossings: drifting labels, hugging lines, kinks, crowding, repeats, truncation. */
  readonly legibility: Legibility;
  /** 0 to 100; 100 is a diagram a careful human would be happy to ship. */
  readonly score: number;
  readonly notes: readonly string[];
}

export interface Layout {
  readonly viewId: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  /** Where the drawing ends and the prose under it (annotations, step lists, legend) begins; absent when nothing is under it. */
  readonly figureHeight?: number;
  readonly boxes: readonly LayoutBox[];
  readonly edges: readonly LayoutEdge[];
  readonly metrics: QualityMetrics;
  /** Extra drawings for sequence and flow views. */
  readonly extras?: readonly Extra[];
  /** The view asks exported pictures to draw open item badges. */
  readonly openItems?: boolean;
}

export type Extra =
  | { readonly kind: 'lifeline'; readonly id: string; readonly x: number; readonly y0: number; readonly y1: number }
  | { readonly kind: 'activation'; readonly id: string; readonly rect: Rect; readonly depth: number }
  | { readonly kind: 'fragment'; readonly id: string; readonly rect: Rect; readonly op: string; readonly condition: string; readonly dividers: readonly number[] }
  | { readonly kind: 'note'; readonly id: string; readonly rect: Rect; readonly text: TextBlock }
  | { readonly kind: 'lane'; readonly id: string; readonly rect: Rect; readonly title: TextBlock }
  | { readonly kind: 'message'; readonly id: string; readonly from: Point; readonly to: Point; readonly label: TextBlock; readonly style: 'sync' | 'async' | 'reply'; readonly selfCall: boolean }
  | { readonly kind: 'highlight'; readonly id: string; readonly rect: Rect; readonly label?: TextBlock; readonly color: string; readonly style: 'frame' | 'band' | 'tint' }
  | { readonly kind: 'badge'; readonly id: string; readonly at: Point; readonly text: string; readonly color: string }
  | { readonly kind: 'text'; readonly id: string; readonly text: TextBlock; readonly role: 'heading' | 'prose' | 'caption' | 'axis'; readonly color?: string }
  | { readonly kind: 'legend'; readonly id: string; readonly rect: Rect; readonly items: readonly LegendItem[]; /** Columns the items wrap into, as many as fit the view's width. */ readonly cols: number }
  | { readonly kind: 'line'; readonly id: string; readonly from: Point; readonly to: Point; readonly style: 'divider' | 'leader' }
  | { readonly kind: 'panel'; readonly id: string; readonly rect: Rect };

export interface LegendItem {
  readonly label: string;
  readonly swatch: 'arrow' | 'box';
  readonly color: string;
  readonly edgeKind?: RelationKind;
}

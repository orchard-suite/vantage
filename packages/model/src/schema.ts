/**
 * The Vantage document schema. One file holds a model (nodes), the truth
 * about how they talk (relations), and any number of views that each tell
 * one story over that model.
 *
 * Everything an author can write is defined here, once, with zod. The JSON
 * Schema shipped to agents is generated from these definitions.
 */
import { ArtifactSchema, DocsSchema, EvidenceSchema } from './schema-docs.ts';
import { z } from 'zod';
import { AnnotationSchema, FactSchema, FrameSchema, HighlightSchema, MatrixSchema, PanelSchema, PathSchema, PinsSchema, SizeSchema } from './schema-story.ts';
import { ObserveSchema } from './schema-observe.ts';
import { NodeOpenItemSchema } from './schema-open.ts';

/** Agents write `reply: 201` and mean the text; accept numbers wherever a short label goes. */
const text = z.union([z.string(), z.number()]).transform((v) => String(v));

const ids = z.union([z.string(), z.array(z.string())]).transform((v) => (Array.isArray(v) ? v : [v]));

/** Where an observed value came from. Set by the hub overlay from a bound entity; authors never write it. */
export const ProvenanceSchema = z
  .object({
    source: z.string().describe('Connector source id, for example orrery or kubectl'),
    sourceId: z.string().describe('The entity id inside that source'),
    observed: z.string().describe('ISO timestamp of the last observation'),
    url: z.string().optional().describe('Where the source shows this entity'),
  })
  .strict();

export const StyleSchema = z
  .object({
    dashed: z.boolean().optional().describe('Dashed border: a logical grouping, not a real container'),
    plural: z.boolean().optional().describe('Draw as a stack to suggest many instances'),
    emphasis: z.enum(['none', 'low', 'high']).optional().describe('Visual weight within its view'),
    frame: FrameSchema.optional(),
    fill: z.string().optional().describe('Explicit background color (hex or palette name)'),
    stroke: z.string().optional().describe('Explicit border color (hex or palette name)'),
  })
  .strict();

const nodeBase = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.\-]*$/, 'ids are letters, digits, _ . -').optional(),
    name: z.string().min(1).describe('Human label, two or three words. Machine names go in subtitle'),
    type: z.string().optional().describe('A built-in or locally defined type; sets icon, color, shape, role'),
    subtitle: text.optional().describe('Technology, machine name, or qualifier under the name'),
    description: z.string().optional().describe('Markdown shown on hover or click'),
    icon: z.string().optional().describe('Icon id as pack/name, for example azure/aks or generic/database'),
    shape: z.enum(['box', 'rounded', 'cylinder', 'person', 'cloud', 'hexagon', 'pill', 'document', 'queue', 'ellipse', 'circle', 'diamond', 'parallelogram', 'triangle']).optional().describe('Override the type shape'),
    image: z.string().optional().describe('Picture file (relative to the document) or URL; the name becomes its caption'),
    imageWidth: z.number().positive().optional(),
    imageHeight: z.number().positive().optional(),
    color: z.string().optional().describe('Palette family: slate blue violet emerald amber red teal pink'),
    tags: z.array(z.string()).optional(),
    url: z.string().optional().describe('Link opened from the viewer'),
    decisions: z.array(z.string()).optional().describe('Decision records that govern this box, cited as PREFIX-NNNN (SHOP-2001) or adr:<ULID>; a hub shows them on the box'),
    style: StyleSchema.optional(),
    count: z.number().int().positive().optional().describe('How many of these exist; shown as a badge'),
    facts: z.array(FactSchema).optional().describe('Label: value lines shown in the box, for example "Cost center: 3301"'),
    bullets: z.array(text).optional().describe('Short lines listed in the box'),
    value: text.optional().describe('One big figure the box is about, for example $250 or 10.50.120.0/21'),
    size: SizeSchema.optional(),
    note: z.string().optional().describe('A sticky note pinned beside this node in every view'),
    bind: z.string().optional().describe('Observed entity this node stands for, as source:id; it inherits facts, freshness, and drift checks'),
    observe: ObserveSchema.optional().describe('Fill this node from a source: the hub draws its observed entities inside it on every render'),
    provenance: ProvenanceSchema.optional(),
    openItems: z.array(NodeOpenItemSchema).optional().describe('What is open against the bound entity now; set by the hub overlay, authors never write it'),
  })
  .strict();

export interface NodeInput extends z.input<typeof nodeBase> {
  children?: NodeInput[] | undefined;
}
export interface NodeOutput extends z.output<typeof nodeBase> {
  children?: NodeOutput[] | undefined;
}

export const NodeSchema: z.ZodType<NodeOutput, NodeInput> = nodeBase.extend({
  children: z.lazy(() => z.array(NodeSchema)).optional(),
});

export const HeadSchema = z.enum(['open', 'filled', 'diamond', 'circle', 'none', 'many', 'one', 'one-or-many', 'zero-or-one']);

export const RelationSchema = z
  .object({
    id: z.string().optional(),
    from: ids.describe('Source node id or list of ids'),
    to: ids.describe('Target node id or list of ids'),
    label: text.optional().describe('What happens on this arrow: a verb phrase, never "connection"'),
    description: z.string().optional().describe('The sentence a reader needs on click'),
    kind: z.enum(['sync', 'async', 'data', 'deploy', 'auth', 'observe', 'manage']).optional().describe('Arrow style family'),
    via: ids.optional().describe('Nodes the relation passes through, in order'),
    tags: z.array(z.string()).optional(),
    both: z.boolean().optional().describe('Arrowheads at both ends'),
    weight: z.number().positive().optional().describe('Layout importance; heavier arrows get straighter paths'),
    color: z.string().optional(),
    style: z.enum(['orthogonal', 'straight', 'curved']).optional().describe('Line style; orthogonal is the default'),
    heads: z
      .object({ from: HeadSchema.optional(), to: HeadSchema.optional() })
      .strict()
      .optional()
      .describe('Arrowhead per end: open, filled, diamond, circle, none; crow\'s foot for ER: many, one, one-or-many, zero-or-one'),
  })
  .strict();

export const ArrangementSchema = z
  .object({
    node: z.string().describe('The container this hint applies to; "root" is the canvas'),
    as: z
      .enum(['auto', 'flow', 'grid', 'row', 'column', 'mirror', 'ring', 'outline', 'matrix'])
      .optional()
      .describe('flow follows the arrows; grid, row, column pack peers; mirror sets halves face to face; ring puts one child in the middle; outline indents like a tree; matrix places by tags'),
    direction: z.enum(['right', 'down', 'left', 'up']).optional(),
    columns: z.number().int().positive().optional().describe('Grid column count'),
    order: z.array(z.string()).optional().describe('Explicit child order; unnamed children follow'),
    layers: z.array(z.array(z.string())).optional().describe('Explicit tiers for a flow, first tier first; children not named are layered by their arrows'),
    center: z.string().optional().describe('The child in the middle of a ring; default is the most connected'),
    matrix: MatrixSchema.optional(),
    divider: z.boolean().optional().describe('Draw a line between halves of a mirror or the cells of a matrix'),
    align: z.enum(['start', 'center', 'end']).optional(),
    gap: z.number().optional(),
  })
  .strict();

export const IncludeSchema = z
  .object({
    tags: z.array(z.string()).optional().describe('Model relations carrying any of these tags'),
    relations: z.array(z.string()).optional().describe('Model relation ids'),
    nodes: z.array(z.string()).optional().describe('Nodes to show even without a relation'),
    subtree: z.array(z.string()).optional().describe('Show every descendant of these nodes'),
  })
  .strict();

const viewBase = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  group: z.string().optional().describe('Picker group; nest with " / " (Platform / Identity); views keep file order inside a group'),
  hidden: z.boolean().optional().describe('A part other views build on with extends. Left out of the picker, presenting, and whole-document exports until the reader turns on Show parts'),
  question: z.string().optional().describe('The question this view answers; shown as the view notes'),
  notes: z.string().optional().describe('Markdown shown beside the diagram'),
  tags: z.array(z.string()).optional(),
});

export const RelationViewSchema = viewBase
  .extend({
    kind: z.literal('relation').default('relation'),
    extends: ids.optional().describe('Other relation views whose relations and arrangement this view inherits'),
    include: IncludeSchema.optional(),
    relations: z.array(RelationSchema).optional().describe('Relations specific to this view'),
    direction: z.enum(['right', 'down']).optional().describe('Main flow direction for the canvas'),
    detail: z.number().int().min(0).optional().describe('Depth cut below the deepest participant; 0 shows participants only'),
    expand: z.array(z.string()).optional().describe('Containers always opened in this view'),
    collapse: z.array(z.string()).optional().describe('Containers shown as one box in this view'),
    hide: z.array(z.string()).optional().describe('Nodes removed from this view with their relations'),
    reparent: z.record(z.string(), z.string()).optional().describe('Node id to the container it sits in for this view only; "root" lifts it to the canvas. A second tree over the same resources'),
    arrange: z.array(ArrangementSchema).optional(),
    legend: z.boolean().optional().describe('Draw a legend of the arrow kinds and colors used; by default one appears when the view mixes line styles'),
    openItems: z.boolean().optional().describe('Draw the open item badges on bound boxes in exported pictures (SVG, PNG, PDF) too; the viewers always show them'),
    paths: z.array(PathSchema).optional().describe('Numbered journeys over the arrows, each with its own color and a narrative under the diagram'),
    annotations: z.array(AnnotationSchema).optional().describe('Notes pinned to nodes, and paragraphs under the diagram'),
    highlights: z.array(HighlightSchema).optional().describe('Frames around sets of siblings; members are kept together'),
    narrative: z.boolean().optional().describe('Write the path steps as a numbered list under the diagram; default true when paths exist'),
    pins: PinsSchema.optional().describe('Geometry kept from an import; pinned boxes never move, the engine places the rest around them'),
  })
  .strict();

export interface SequenceStepInput {
  from?: string | undefined;
  to?: string | undefined;
  label?: string | number | undefined;
  description?: string | undefined;
  kind?: 'sync' | 'async' | 'reply' | undefined;
  reply?: string | number | undefined;
  steps?: SequenceStepInput[] | undefined;
  alt?: string | undefined;
  opt?: string | undefined;
  loop?: string | undefined;
  par?: string | undefined;
  else?: SequenceStepInput[] | undefined;
  note?: string | undefined;
  over?: string | string[] | undefined;
  create?: boolean | undefined;
  destroy?: string | undefined;
}
export interface SequenceStepOutput extends Omit<SequenceStepInput, 'steps' | 'else' | 'over' | 'label' | 'reply'> {
  label?: string | undefined;
  reply?: string | undefined;
  steps?: SequenceStepOutput[] | undefined;
  else?: SequenceStepOutput[] | undefined;
  over?: string[] | undefined;
}

export const SequenceStepSchema: z.ZodType<SequenceStepOutput, SequenceStepInput> = z.lazy(() =>
  z
    .object({
      from: z.string().optional(),
      to: z.string().optional(),
      label: text.optional(),
      description: z.string().optional(),
      kind: z.enum(['sync', 'async', 'reply']).optional(),
      reply: text.optional().describe('Label of the return arrow drawn after nested steps'),
      steps: z.array(SequenceStepSchema).optional().describe('Steps that happen while this call is active'),
      alt: z.string().optional().describe('Fragment: condition for the steps below'),
      opt: z.string().optional(),
      loop: z.string().optional(),
      par: z.string().optional(),
      else: z.array(SequenceStepSchema).optional().describe('Steps of the else branch of an alt fragment'),
      note: z.string().optional().describe('A note placed over one or more participants'),
      over: ids.optional(),
      create: z.boolean().optional().describe('This message creates its target: the participant box appears at this row'),
      destroy: z.string().optional().describe('Participant whose lifeline ends here with a cross'),
    })
    .strict(),
);

export const SequenceViewSchema = viewBase
  .extend({
    kind: z.literal('sequence'),
    participants: z.array(z.string()).optional().describe('Left to right order; unnamed participants follow by first use'),
    steps: z.array(SequenceStepSchema).min(1),
  })
  .strict();

export const FlowStepSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    shape: z.enum(['start', 'end', 'process', 'decision', 'io', 'subprocess', 'wait', 'document']).optional(),
    lane: z.string().optional(),
    node: z.string().optional().describe('Model node this step belongs to; used for icon and hover'),
    description: z.string().optional(),
  })
  .strict();

export const FlowEdgeSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    label: text.optional().describe('Branch label, for example yes / no'),
    kind: z.enum(['sync', 'async']).optional(),
  })
  .strict();

export const FlowViewSchema = viewBase
  .extend({
    kind: z.literal('flow'),
    direction: z.enum(['right', 'down']).optional(),
    lanes: z.array(z.string()).optional().describe('Swimlanes in order'),
    layers: z.array(z.array(z.string()).min(1)).optional().describe('Columns (rows when direction is down) in order, each a list of step ids; a step not named keeps the column the flow gives it'),
    steps: z.array(FlowStepSchema).min(1),
    edges: z.array(FlowEdgeSchema),
  })
  .strict();

export const WalkthroughStepSchema = z
  .object({
    title: z.string(),
    text: z.string().optional(),
    highlight: z.array(z.string()).optional().describe('Node or relation ids lit up on this step'),
    focus: z.string().optional().describe('Node the camera centers on'),
    view: z.string().optional().describe('Switch to this view for this step'),
  })
  .strict();

export const WalkthroughViewSchema = viewBase
  .extend({
    kind: z.literal('walkthrough'),
    view: z.string().describe('The relation view the walkthrough plays over'),
    steps: z.array(WalkthroughStepSchema).min(1),
  })
  .strict();

export const PageViewSchema = viewBase
  .extend({
    kind: z.literal('page'),
    columns: z.number().int().positive().optional().describe('Panel columns; default 1'),
    panels: z.array(PanelSchema).min(1).describe('Headings, prose, and embedded views composed on one canvas'),
  })
  .strict();

export const TimelineItemSchema = z
  .object({
    id: z.string().optional(),
    text: z.string().min(1),
    lane: z.string().optional().describe('Owner or stream; one band per lane'),
    start: z.string().describe('ISO date, or a plain label when `scale: ordinal`'),
    end: z.string().optional().describe('Omit for a milestone'),
    color: z.string().optional(),
    node: z.string().optional().describe('Model node this item belongs to'),
    description: z.string().optional(),
  })
  .strict();

export const TimelineViewSchema = viewBase
  .extend({
    kind: z.literal('timeline'),
    lanes: z.array(z.string()).optional().describe('Band order; unnamed lanes follow by first use'),
    scale: z.enum(['date', 'ordinal']).optional().describe('date reads ISO dates; ordinal uses the labels in start as equal steps'),
    items: z.array(TimelineItemSchema).min(1),
    dependencies: z.array(z.object({ from: z.string(), to: z.string() }).strict()).optional().describe('Item ids; drawn as arrows from end to start'),
  })
  .strict();

export const DocViewSchema = viewBase
  .extend({
    kind: z.literal('doc'),
    file: z.string().optional().describe('The page as a Markdown file, a path relative to the document'),
    text: z.string().optional().describe('The page as Markdown written here, for a short page; use file for a long one'),
    beside: z.string().optional().describe('A view kept beside the prose while it is read; the boxes a passage names light up as it scrolls by'),
  })
  .strict();

/** The four classes every state falls in, so a roadmap, a list, or a report reads any kind the same way. */
export const STATE_CLASSES = ['not-started', 'in-progress', 'done', 'parked'] as const;
export type StateClass = (typeof STATE_CLASSES)[number];

/** Who a move may name without the kind declaring it. */
/** Who a move may name without the kind declaring it: `proof` is the hub, moving an item when its proof says so. */
export const BUILT_IN_ROLES: readonly string[] = ['author', 'holder', 'asker', 'proof'];

export const LifecycleStateSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'lower case letters, digits, and dashes'),
    text: z.string().min(1).describe('The state as people say it: In review'),
    class: z.enum(STATE_CLASSES).describe('not-started, in-progress, done, or parked'),
    page: z.string().optional().describe('A Markdown page beside the document that says how to do the work in this state'),
    waits: z.boolean().optional().describe('Where an item waits for a person to answer a question asked on it; an agent asks by moving it here'),
    description: z.string().optional(),
  })
  .strict();

export const LifecycleMoveSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    label: text.optional().describe('The move as people say it: approve, send back'),
    who: z.array(z.string()).optional().describe('Who may make it: author (anyone who writes the workspace), holder, asker, proof (the hub, when the item\'s proof says so), or a role the kind names. Default author'),
    needs: z.array(z.string().regex(/^(note|revision|label:[a-z][a-z0-9_]*)$/, 'note, revision, or label:<name>')).optional().describe('What the move needs: a note, a content revision to pin, or a label that must be set'),
    approval: z.boolean().optional().describe('An approval: the person who asked for the item never makes it'),
    people: z.boolean().optional().describe('For people only: an agent never makes it, so a person makes it themselves'),
  })
  .strict();

export const LifecycleViewSchema = viewBase
  .extend({
    kind: z.literal('lifecycle'),
    direction: z.enum(['right', 'down']).optional(),
    states: z.array(LifecycleStateSchema).min(1).describe('Every state an item of the kind can be in; the first is where a new item starts'),
    moves: z.array(LifecycleMoveSchema).describe('Every move between states; the hub refuses any move not drawn here'),
  })
  .strict();

export const ViewSchema = z.discriminatedUnion('kind', [
  RelationViewSchema,
  SequenceViewSchema,
  FlowViewSchema,
  WalkthroughViewSchema,
  PageViewSchema,
  TimelineViewSchema,
  DocViewSchema,
  LifecycleViewSchema,
]);

export const LABEL_TYPES = ['text', 'number', 'money', 'date', 'choice'] as const;
export type LabelType = (typeof LABEL_TYPES)[number];

export const KindLabelSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/, 'lower case letters, digits, and underscores'),
    type: z.enum(LABEL_TYPES),
    title: z.string().optional(),
    choices: z.array(z.string().min(1)).optional().describe('For a choice: the values it may take'),
  })
  .strict();

/** The kinds the hub ships, which a kind may build on. */
export const BASE_KINDS = ['work-item', 'roadmap-item', 'milestone'] as const;
export type BaseKind = (typeof BASE_KINDS)[number];

export const KindSchema = z
  .object({
    prefix: z.string().regex(/^[A-Z][A-Z0-9]{1,11}$/, 'a letter, then upper-case letters and digits, two to twelve long').describe('The key prefix: VAN makes VAN-1, VAN-2'),
    name: z.string().min(1).describe('The kind as people say it: Vantage work'),
    base: z.enum(BASE_KINDS).optional().describe('A kind the hub ships to build on: its labels, roles, and lifecycle, unless this file names its own'),
    owner: z.string().regex(/^[a-z][a-z0-9-]*$/).optional().describe('The system that keeps the content; absent when the hub does, and then an item has a Markdown body'),
    labels: z.array(KindLabelSchema).optional().describe('A few flat values the owner publishes; the hub shows, sorts, and filters them and never reads their meaning'),
    roles: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.array(z.string().min(1))).optional().describe('Roles a move may name, each to the people (by email) and teams (team:<name>) who hold it'),
    parts: z.array(z.string()).optional().describe('The prefixes of kinds whose items may be parts of one of these'),
    lifecycle: z.string().optional().describe('The id of the lifecycle view in this document that items of the kind follow'),
  })
  .strict();

export const TypeDefSchema = z
  .object({
    extends: z.string().optional().describe('Built-in type to inherit role and shape from'),
    icon: z.string().optional(),
    color: z.string().optional(),
    shape: z.enum(['box', 'rounded', 'cylinder', 'person', 'cloud', 'hexagon', 'pill', 'document', 'queue', 'ellipse', 'circle', 'diamond', 'parallelogram', 'triangle']).optional(),
    role: z.enum(['actor', 'edge', 'compute', 'data', 'platform', 'external', 'boundary']).optional(),
    frame: FrameSchema.optional(),
    description: z.string().optional(),
  })
  .strict();

export const ImportSchema = z
  .object({
    path: z.string(),
    as: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/).describe('Namespace prefix: nodes are referenced as Prefix.id'),
  })
  .strict();

export const DocumentSchema = z
  .object({
    vantage: z.number().int().positive().optional().describe('Language version this document is written for; current is 1'),
    title: z.string().optional(),
    author: z.string().optional(),
    updated: z.string().optional(),
    description: z.string().optional(),
    theme: z.enum(['light', 'dark', 'print', 'colorblind', 'auto']).optional().describe('Default palette: light, dark, print (white, strong strokes), colorblind (distinguishable without hue)'),
    profiles: z.array(z.string()).optional().describe('Type vocabularies over the built-in catalog: azure, aws, k8s (vendor icons), bpmn, uml'),
    icons: z
      .record(z.string(), z.string().min(1))
      .optional()
      .describe('Custom icons: an id (pack/name) to an SVG or picture file relative to the document, or a URL. Any node or type uses the id as its icon'),
    imports: z.array(ImportSchema).optional(),
    kind: KindSchema.optional().describe('This file defines a kind of tracked item: its key prefix, labels, roles, and the lifecycle view it follows'),
    types: z.record(z.string(), TypeDefSchema).optional(),
    nodes: z.array(NodeSchema).default([]),
    relations: z.array(RelationSchema).optional(),
    views: z.array(ViewSchema).default([]),
    docs: DocsSchema.optional().describe('The docs contract: what the document is about, the pages it must have, its readers, and the checks every save enforces'),
    artifacts: z.array(ArtifactSchema).optional().describe('Files the document keeps and versions but never draws, such as an analyzer\'s specification, under artifacts/'),
    evidence: z.array(EvidenceSchema).optional().describe('What each box or page section was read from: repository files and the commit they were checked at'),
  })
  .strict();

export type DocumentInput = z.input<typeof DocumentSchema>;
export type Document = z.output<typeof DocumentSchema>;
export type Relation = z.output<typeof RelationSchema>;
export type RelationInput = z.input<typeof RelationSchema>;
export type View = z.output<typeof ViewSchema>;
export type RelationView = z.output<typeof RelationViewSchema>;
export type SequenceView = z.output<typeof SequenceViewSchema>;
export type FlowView = z.output<typeof FlowViewSchema>;
export type LifecycleView = z.output<typeof LifecycleViewSchema>;
export type LifecycleState = z.output<typeof LifecycleStateSchema>;
export type LifecycleMove = z.output<typeof LifecycleMoveSchema>;
export type KindDefinition = z.output<typeof KindSchema>;
export type KindLabel = z.output<typeof KindLabelSchema>;
export type FlowStep = z.output<typeof FlowStepSchema>;
export type FlowEdge = z.output<typeof FlowEdgeSchema>;
export type WalkthroughView = z.output<typeof WalkthroughViewSchema>;
export type WalkthroughStep = z.output<typeof WalkthroughStepSchema>;
export type PageView = z.output<typeof PageViewSchema>;
export type TimelineView = z.output<typeof TimelineViewSchema>;
export type DocView = z.output<typeof DocViewSchema>;
export type TimelineItem = z.output<typeof TimelineItemSchema>;
export type SequenceStep = SequenceStepOutput;
export type Arrangement = z.output<typeof ArrangementSchema>;
export type Style = z.output<typeof StyleSchema>;
export type Provenance = z.output<typeof ProvenanceSchema>;
export type TypeDef = z.output<typeof TypeDefSchema>;
export type RelationKind = NonNullable<Relation['kind']>;
export type EdgeStyle = NonNullable<Relation['style']>;
export type Head = z.output<typeof HeadSchema>;
export type Direction = 'right' | 'down' | 'left' | 'up';

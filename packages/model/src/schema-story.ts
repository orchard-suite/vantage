/**
 * The story layer of the schema: what turns a correct diagram into one
 * that tells a story. Facts and notes on nodes, numbered paths over the
 * arrows, highlights around sets, prose on the canvas, and pages that
 * compose several views. None of it is a diagram type; each piece is a
 * primitive an author combines.
 */
import { z } from 'zod';

const text = z.union([z.string(), z.number()]).transform((v) => String(v));

/** `Cost center: 3301` as a string, or `{ label, value }`. */
export const FactSchema = z
  .union([
    z.string(),
    z.object({ label: z.string(), value: text }).strict(),
  ])
  .transform((v) => {
    if (typeof v !== 'string') return v;
    const i = v.indexOf(':');
    return i > 0 ? { label: v.slice(0, i).trim(), value: v.slice(i + 1).trim() } : { label: '', value: v.trim() };
  });

export const SizeSchema = z
  .enum(['compact', 'normal', 'large', 'icon'])
  .describe('How much room the node takes: compact for inventories, large for the hero of a view, icon for a big icon with a caption and no box');

export const FrameSchema = z.enum(['box', 'dashed', 'none']).describe('Border of a container: none draws only the title and the children, for outlines and loose groups');

export const AnnotationSchema = z
  .object({
    text: z.string().min(1),
    at: z.string().optional().describe('Node id the note is pinned to; without it the text is a paragraph under the diagram'),
    side: z.enum(['top', 'right', 'bottom', 'left']).optional().describe('Preferred side of the node; the engine moves it when that side is busy'),
    kind: z.enum(['note', 'callout', 'heading']).optional().describe('note is a sticky, callout is a plain label with a leader line, heading is a section title'),
  })
  .strict();

export const HighlightSchema = z
  .object({
    nodes: z.array(z.string()).min(1).describe('Siblings to keep together and draw a frame around'),
    label: z.string().optional(),
    color: z.string().optional().describe('Palette family or hex'),
    style: z.enum(['frame', 'band', 'tint']).optional().describe('frame outlines, band is a translucent fill, tint colors the members'),
  })
  .strict();

export const PathStepSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    label: text.optional().describe('Matches an existing arrow by label, or labels the arrow this step adds'),
    text: z.string().optional().describe('The sentence for the narrative under the diagram'),
    id: text.optional().describe('Badge text when not a plain number, for example 4a'),
  })
  .strict();

export const PathSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    color: z.string().optional().describe('Palette family or hex; each path gets its own by default'),
    steps: z.array(PathStepSchema).min(1),
  })
  .strict();

export const PanelSchema = z
  .object({
    heading: z.string().optional(),
    text: z.string().optional().describe('Prose under the heading, above the embedded view'),
    view: z.string().optional().describe('A view to embed; omit for a text-only panel'),
    span: z.number().int().positive().optional().describe('Columns this panel spans'),
  })
  .strict();

export const MatrixSchema = z
  .object({
    rows: z.array(z.string()).min(1).describe('Row labels; a child belongs to the row whose label is among its tags'),
    columns: z.array(z.string()).optional().describe('Column labels, matched by tag; omit for one column'),
  })
  .strict();

export type Fact = z.output<typeof FactSchema>;
export type NodeSize = z.output<typeof SizeSchema>;
export type Frame = z.output<typeof FrameSchema>;
export type Annotation = z.output<typeof AnnotationSchema>;
export type Highlight = z.output<typeof HighlightSchema>;
export type PathStep = z.output<typeof PathStepSchema>;
export type StoryPath = z.output<typeof PathSchema>;
export type Panel = z.output<typeof PanelSchema>;
export type Matrix = z.output<typeof MatrixSchema>;

const PinRectSchema = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }).strict();
const PinPointSchema = z.object({ x: z.number(), y: z.number() }).strict();

/**
 * Per-view geometry kept from an import or a deliberate placement. Pinned
 * boxes never move; unpinned ones are placed around them. Edge keys are
 * `from>to`; a pinned edge keeps its waypoints while both ends stay put.
 */
export const PinsSchema = z
  .object({
    nodes: z.record(z.string(), PinRectSchema).default({}),
    edges: z.record(z.string(), z.array(PinPointSchema).min(2)).optional(),
  })
  .strict();

export type PinRect = z.output<typeof PinRectSchema>;
export type PinPoint = z.output<typeof PinPointSchema>;
export type Pins = z.output<typeof PinsSchema>;

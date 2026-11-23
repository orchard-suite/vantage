/**
 * mxGraph style strings to our vocabulary: the shape family of a vertex,
 * the line style and arrowheads of an edge. Anything we cannot name is
 * returned as an unmapped token for the report.
 */
import type { Head, EdgeStyle } from '@vantage/model';
import type { ShapeForm } from './drawing.ts';

export type MxStyle = Readonly<Record<string, string>>;

export function parseStyle(s: string | undefined): MxStyle {
  const out: Record<string, string> = {};
  let last: string | undefined;
  for (const part of (s ?? '').split(';')) {
    if (!part) continue;
    // A data URL keeps its ";base64," marker, which the split just cut.
    if (last === 'image' && part.startsWith('base64,') && out['image']?.startsWith('data:')) {
      out['image'] = `${out['image']};${part}`;
      continue;
    }
    const i = part.indexOf('=');
    if (i < 0) out[part] = '';
    else out[part.slice(0, i)] = part.slice(i + 1);
    last = i < 0 ? part : part.slice(0, i);
  }
  return out;
}

/**
 * An embedded image as a data URL a browser can read. draw.io writes
 * `data:image/png,<base64>` without the base64 marker; put it back.
 */
export function imageDataUrl(value: string | undefined): string | undefined {
  if (value === undefined || !value.startsWith('data:')) return undefined;
  const comma = value.indexOf(',');
  if (comma < 0) return undefined;
  const meta = value.slice(5, comma), data = value.slice(comma + 1);
  if (!data) return undefined;
  if (meta.includes(';base64')) return value;
  const looksBase64 = /^[A-Za-z0-9+/=\s]+$/.test(data) && !data.startsWith('<') && !data.startsWith('%');
  return looksBase64 ? `data:${meta};base64,${data}` : value;
}

export function flag(style: MxStyle, key: string): boolean {
  const v = style[key];
  return v !== undefined && v !== '0' && v !== 'false';
}

const KNOWN_SHAPE_KEYS = new Set(['ellipse', 'rhombus', 'triangle', 'text', 'image', 'swimlane', 'group', 'label']);
const KNOWN_SHAPES = new Set(['cylinder', 'cylinder2', 'cylinder3', 'hexagon', 'parallelogram', 'document', 'cloud', 'note', 'image', 'ellipse', 'rhombus', 'triangle', 'swimlane', 'umlActor', 'actor', 'mxgraph.basic.rect', 'rect', 'rectangle', 'label', 'text']);

export interface VertexForm {
  readonly form: ShapeForm;
  readonly unmapped: readonly string[];
}

/** The closest of our shapes to a vertex style. */
export function vertexForm(style: MxStyle, w: number, h: number): VertexForm {
  const shape = style['shape'];
  const unmapped: string[] = [];
  if (shape !== undefined && !KNOWN_SHAPES.has(shape) && !shape.startsWith('mxgraph.')) unmapped.push(`shape=${shape}`);
  if (shape !== undefined && shape.startsWith('mxgraph.') && !/person|actor|user|cloud|database|cylinder/i.test(shape)) unmapped.push(`shape=${shape}`);
  const round = flag(style, 'rounded');
  const pick = (): ShapeForm => {
    if ('ellipse' in style || shape === 'ellipse') return Math.abs(w - h) <= 2 || style['aspect'] === 'fixed' ? 'circle' : 'ellipse';
    if ('rhombus' in style || shape === 'rhombus') return 'diamond';
    if ('triangle' in style || shape === 'triangle') return 'triangle';
    if (shape?.startsWith('cylinder') || /database|cylinder/i.test(shape ?? '')) return 'cylinder';
    if (shape === 'hexagon') return 'hexagon';
    if (shape === 'parallelogram') return 'parallelogram';
    if (shape === 'document') return 'document';
    if (shape === 'cloud' || /cloud/i.test(shape ?? '')) return 'cloud';
    if (shape === 'umlActor' || shape === 'actor' || /person|actor|user/i.test(shape ?? '')) return 'person';
    if (round) return Number(style['arcSize']) >= 50 && !flag(style, 'absoluteArcSize') ? 'pill' : 'rounded';
    return 'box';
  };
  return { form: pick(), unmapped };
}

export function isTextOnly(style: MxStyle): boolean {
  return 'text' in style || style['shape'] === 'text';
}

/** A box with neither fill nor border: an icon with a caption, or a loose group. */
export function isFrameless(style: MxStyle): boolean {
  return !isTextOnly(style) && style['fillColor'] === 'none' && style['strokeColor'] === 'none' && !('image' in style);
}

export function isGroup(style: MxStyle): boolean {
  return 'group' in style && Object.keys(style).length <= 3;
}

export function isContainer(style: MxStyle): boolean {
  return 'swimlane' in style || style['shape'] === 'swimlane' || flag(style, 'container');
}

export { KNOWN_SHAPE_KEYS };

const HEADS: Readonly<Record<string, Head>> = {
  classic: 'filled', classicThin: 'filled', block: 'filled', blockThin: 'filled', doubleBlock: 'filled',
  open: 'open', openThin: 'open', openAsync: 'open', async: 'open',
  diamond: 'diamond', diamondThin: 'diamond',
  oval: 'circle', circle: 'circle', circlePlus: 'circle',
  none: 'none',
  ERmany: 'many', ERzeroToMany: 'many', ERoneToMany: 'one-or-many', ERone: 'one', ERmandOne: 'one', ERzeroToOne: 'zero-or-one',
};

export interface EdgeForm {
  readonly style: EdgeStyle;
  readonly dashed: boolean;
  readonly heads: { readonly from: Head; readonly to: Head };
  readonly unmapped: readonly string[];
}

function headOf(name: string | undefined, fill: string | undefined, fallback: Head, unmapped: string[], key: string): Head {
  if (name === undefined) return fallback;
  const h = HEADS[name];
  if (h === undefined) {
    unmapped.push(`${key}=${name}`);
    return fallback;
  }
  // A hollow triangle is drawn as an open head.
  if (h === 'filled' && fill === '0') return 'open';
  return h;
}

export function edgeForm(style: MxStyle): EdgeForm {
  const unmapped: string[] = [];
  const es = style['edgeStyle'];
  const lineStyle: EdgeStyle = flag(style, 'curved') ? 'curved' : es === undefined || es === 'none' ? 'straight' : 'orthogonal';
  if (es !== undefined && !['orthogonalEdgeStyle', 'elbowEdgeStyle', 'entityRelationEdgeStyle', 'segmentEdgeStyle', 'isometricEdgeStyle', 'none'].includes(es)) unmapped.push(`edgeStyle=${es}`);
  return {
    style: lineStyle,
    dashed: flag(style, 'dashed'),
    heads: { from: headOf(style['startArrow'], style['startFill'], 'none', unmapped, 'startArrow'), to: headOf(style['endArrow'], style['endFill'], 'filled', unmapped, 'endArrow') },
    unmapped,
  };
}

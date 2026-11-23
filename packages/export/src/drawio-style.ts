/** mxGraph style strings and labels for our boxes and edges. */
import type { LayoutBox, LayoutEdge, TextBlock } from '@vantage/layout';
import type { NodeShape, RelationKind } from '@vantage/model';
import { familyOf, type Theme } from '@vantage/render';
import { mix } from './common.ts';

export type Style = Record<string, string | number>;

export function styleString(style: Style): string {
  return Object.entries(style).map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join(';') + ';';
}

/** Escapes text for use inside an html=1 label; the XML attribute escaping happens later. */
export function htmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function shapeStyle(shape: NodeShape, h: number): Style {
  switch (shape) {
    case 'box':
      return { rounded: 0 };
    case 'rounded':
      return { rounded: 1, absoluteArcSize: 1, arcSize: 16 };
    case 'pill':
      return { rounded: 1, arcSize: 50 };
    case 'cylinder':
      return { shape: 'cylinder3', boundedLbl: 1, backgroundOutline: 1, size: 6 };
    case 'queue':
      return { shape: 'cylinder3', boundedLbl: 1, backgroundOutline: 1, size: 6, direction: 'south' };
    case 'hexagon':
      return { shape: 'hexagon', perimeter: 'hexagonPerimeter2', size: 0.18 };
    case 'document':
      return { shape: 'document', size: 0.2 };
    case 'cloud':
      return { rounded: 1, absoluteArcSize: 1, arcSize: Math.min(44, h) };
    case 'person':
      return { rounded: 1, absoluteArcSize: 1, arcSize: 20 };
    case 'ellipse':
    case 'circle':
      return { ellipse: '', aspect: shape === 'circle' ? 'fixed' : 'variable' };
    case 'diamond':
      return { rhombus: '' };
    case 'parallelogram':
      return { shape: 'parallelogram', perimeter: 'parallelogramPerimeter', size: 0.2 };
    case 'triangle':
      return { triangle: '', direction: 'north' };
  }
}

function weight(t: TextBlock): number {
  return t.weight === 'regular' ? 0 : 1;
}

/** Name on the first line, subtitle and facts below in the muted color. */
export function boxLabel(b: LayoutBox, theme: Theme, nameColor: string): string {
  const lines = [`<font color="${nameColor}" style="font-size:${b.name.size}px">${b.name.lines.map(htmlText).join('<br>')}</font>`];
  if (b.subtitle) lines.push(`<font color="${theme.muted}" style="font-size:${b.subtitle.size}px">${b.subtitle.lines.map(htmlText).join('<br>')}</font>`);
  for (const t of b.texts ?? []) lines.push(`<font color="${theme.ink}" style="font-size:${t.size}px">${t.lines.map(htmlText).join('<br>')}</font>`);
  return lines.join('<br>');
}

export function textStyle(t: TextBlock): Style {
  return { fontSize: t.size, fontStyle: weight(t), align: t.anchor === 'middle' ? 'center' : 'left', verticalAlign: 'top', spacingTop: Math.max(0, Math.round(t.y - 4)), spacingLeft: t.anchor === 'middle' ? 0 : Math.round(t.x) };
}

export function containerStyle(b: LayoutBox, theme: Theme): Style {
  const fam = familyOf(theme, b.node.color);
  const base = b.node.style.fill ?? theme.containerFills[Math.min(b.depth, theme.containerFills.length - 1)]!;
  const fill = b.node.color !== 'slate' && !b.node.style.fill ? mix(fam.fill, base, 0.35) : base;
  const stroke = b.node.style.stroke ?? (b.node.color === 'slate' ? theme.containerStroke : fam.softStroke);
  return {
    rounded: 1, absoluteArcSize: 1, arcSize: 20, whiteSpace: 'wrap', html: 1, container: 1, collapsible: 0, recursiveResize: 0,
    ...textStyle(b.name),
    fillColor: b.frame === 'none' ? 'none' : fill,
    strokeColor: b.frame === 'none' ? 'none' : stroke,
    strokeWidth: b.node.style.emphasis === 'high' ? 2 : 1.25,
    fontColor: theme.containerTitle,
    ...(b.frame === 'dashed' ? { dashed: 1, dashPattern: '6 4' } : {}),
  };
}

export function leafStyle(b: LayoutBox, theme: Theme): Style {
  const fam = familyOf(theme, b.node.color);
  if (b.iconOnly) {
    return { rounded: 1, whiteSpace: 'wrap', html: 1, fillColor: 'none', strokeColor: 'none', fontColor: theme.ink, ...textStyle(b.name) };
  }
  return {
    ...shapeStyle(b.shape, b.h), whiteSpace: 'wrap', html: 1,
    ...textStyle(b.name),
    fillColor: b.node.style.fill ?? fam.fill,
    strokeColor: b.node.style.stroke ?? fam.stroke,
    strokeWidth: b.node.style.emphasis === 'high' ? 2.25 : 1.25,
    fontColor: fam.text,
    ...(b.frame === 'dashed' ? { dashed: 1, dashPattern: '6 4' } : {}),
    ...(b.node.style.plural ? { shadow: 1 } : {}),
  };
}

const EDGE_DASH: Record<RelationKind, { dash?: string; open: boolean; width: number }> = {
  sync: { open: false, width: 1.5 },
  async: { dash: '6 4', open: true, width: 1.5 },
  data: { open: false, width: 2 },
  deploy: { dash: '2 4', open: false, width: 1.5 },
  auth: { dash: '8 3 2 3', open: false, width: 1.5 },
  observe: { dash: '1 4', open: true, width: 1.5 },
  manage: { dash: '10 4', open: false, width: 1.5 },
};

/** Fraction of the terminal box where the edge leaves or enters, so draw.io keeps our ports. */
function port(p: { x: number; y: number }, b: LayoutBox | undefined): { x: number; y: number } | undefined {
  if (!b || b.w === 0 || b.h === 0) return undefined;
  const clamp = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;
  return { x: clamp((p.x - b.x) / b.w), y: clamp((p.y - b.y) / b.h) };
}

export function edgeStyle(e: LayoutEdge, theme: Theme, from: LayoutBox | undefined, to: LayoutBox | undefined): Style {
  const st = EDGE_DASH[e.kind];
  const colorName = e.color ?? e.relation.color;
  const color = colorName ? familyOf(theme, colorName).stroke : theme.edge;
  const first = e.points[0], last = e.points[e.points.length - 1];
  const exit = first ? port(first, from) : undefined;
  const entry = last ? port(last, to) : undefined;
  return {
    edgeStyle: 'orthogonalEdgeStyle', rounded: 1, orthogonalLoop: 1, jettySize: 'auto', html: 1,
    strokeColor: color,
    strokeWidth: e.relation.weight >= 2 ? st.width + 1 : st.width,
    endArrow: st.open ? 'open' : 'block', endFill: st.open ? 0 : 1,
    ...(e.both ? { startArrow: st.open ? 'open' : 'block', startFill: st.open ? 0 : 1 } : {}),
    ...(st.dash ? { dashed: 1, dashPattern: st.dash } : {}),
    fontColor: theme.ink, labelBackgroundColor: theme.labelHalo,
    ...(e.label ? { fontSize: e.label.size } : {}),
    ...(exit ? { exitX: exit.x, exitY: exit.y, exitDx: 0, exitDy: 0 } : {}),
    ...(entry ? { entryX: entry.x, entryY: entry.y, entryDx: 0, entryDy: 0 } : {}),
  };
}

/** Icon SVG as a data url for an image style, with currentColor resolved. Returns nothing when the icon is too big to inline. */
/** draw.io keeps a data URL inside a style string, where `;` separates keys, so it drops the `;base64` marker. */
export function drawioDataUrl(href: string): string | undefined {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(href);
  return m ? `data:${m[1]},${m[2]}` : undefined;
}

export function iconDataUrl(svg: string, color: string, limit = 12000): string | undefined {
  // A custom icon is one embedded picture: hand draw.io the picture itself.
  const picture = /^<svg[^>]*><image href="(data:[^"]+)"[^>]*\/><\/svg>$/.exec(svg)?.[1];
  if (picture !== undefined) return drawioDataUrl(picture.replace(/&amp;/g, '&'));
  const resolved = svg.replace(/currentColor/g, color);
  if (resolved.length > limit) return undefined;
  return `data:image/svg+xml,${Buffer.from(resolved, 'utf8').toString('base64')}`;
}

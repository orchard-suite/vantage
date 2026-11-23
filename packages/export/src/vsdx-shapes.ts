/**
 * Visio shape XML. Units are inches with the origin at the bottom left, so
 * every y is flipped against the page height. Shapes carry a Geometry
 * section in relative coordinates; connectors are 1-D shapes whose local
 * x axis runs from the begin point to the end point.
 */
import type { Point, Rect, TextBlock } from '@vantage/layout';
import type { NodeShape } from '@vantage/model';
import { PLAIN } from '@vantage/render';
import { inches, num, xmlEsc } from './common.ts';

export interface ShapeText {
  readonly runs: readonly { readonly text: string; readonly color: string; readonly sizePx: number; readonly bold: boolean }[];
  readonly align: 'left' | 'center';
  readonly vertical: 'top' | 'middle';
  /** Left inset in pixels when the text is left aligned, matching the layout's text x. */
  readonly leftPx?: number;
  readonly topPx?: number;
}

export interface ShapeStyle {
  readonly fill?: string;
  readonly stroke?: string;
  /** Stroke width in pixels. */
  readonly strokeWidth?: number;
  /** Visio line pattern: 1 solid, 2 dashed, 3 dotted, 4 dash dot. */
  readonly pattern?: number;
  /** Corner radius in pixels. */
  readonly rounding?: number;
  readonly shape?: NodeShape | 'ellipse';
}

const cell = (n: string, v: string | number, extra = ''): string => `<Cell N="${n}" V="${typeof v === 'number' ? num(v) : v}"${extra}/>`;
const LINE_WEIGHT = (px: number): number => inches(px) * 0.75;

function textSection(t: ShapeText | undefined): string {
  if (!t || t.runs.length === 0) return '';
  const rows = t.runs.map((r, i) => `<Row IX="${i}">${cell('Color', r.color)}${cell('Size', inches(r.sizePx))}${cell('Style', r.bold ? 1 : 0)}${cell('Font', 0)}</Row>`).join('');
  const body = t.runs.map((r, i) => `<cp IX="${i}"/>${xmlEsc(r.text)}${i < t.runs.length - 1 ? '\n' : ''}`).join('');
  return `<Section N="Character">${rows}</Section><Section N="Paragraph"><Row IX="0">${cell('HorzAlign', t.align === 'center' ? 1 : 0)}</Row></Section><Text>${body}</Text>`;
}

function textCells(t: ShapeText | undefined): string {
  if (!t) return '';
  return cell('VerticalAlign', t.vertical === 'top' ? 0 : 1) + (t.leftPx !== undefined ? cell('LeftMargin', inches(t.leftPx)) : '') + (t.topPx !== undefined ? cell('TopMargin', inches(t.topPx)) : '');
}

function rel(x: number, y: number, t: 'RelMoveTo' | 'RelLineTo', ix: number): string {
  return `<Row T="${t}" IX="${ix}">${cell('X', x)}${cell('Y', y)}</Row>`;
}

/** Outline in relative coordinates (0..1, y up). Hexagons get their real points; other shapes are rectangles with rounding. */
function geometry(style: ShapeStyle, w: number, h: number): string {
  if (style.shape === 'ellipse') {
    return `<Section N="Geometry" IX="0">${cell('NoFill', style.fill ? 0 : 1)}${cell('NoLine', style.stroke ? 0 : 1)}<Row T="Ellipse" IX="1">${cell('X', inches(w) / 2)}${cell('Y', inches(h) / 2)}${cell('A', inches(w))}${cell('B', inches(h) / 2)}${cell('C', inches(w) / 2)}${cell('D', inches(h))}</Row></Section>`;
  }
  const rows: string[] = [];
  if (style.shape === 'hexagon') {
    const d = Math.min(18, w * 0.18) / w;
    rows.push(rel(d, 1, 'RelMoveTo', 1), rel(1 - d, 1, 'RelLineTo', 2), rel(1, 0.5, 'RelLineTo', 3), rel(1 - d, 0, 'RelLineTo', 4), rel(d, 0, 'RelLineTo', 5), rel(0, 0.5, 'RelLineTo', 6), rel(d, 1, 'RelLineTo', 7));
  } else {
    rows.push(rel(0, 0, 'RelMoveTo', 1), rel(1, 0, 'RelLineTo', 2), rel(1, 1, 'RelLineTo', 3), rel(0, 1, 'RelLineTo', 4), rel(0, 0, 'RelLineTo', 5));
  }
  const main = `<Section N="Geometry" IX="0">${cell('NoFill', style.fill ? 0 : 1)}${cell('NoLine', style.stroke ? 0 : 1)}${rows.join('')}</Section>`;
  if (style.shape !== 'cylinder') return main;
  // The cap line that makes a cylinder read as a database.
  const ry = 6 / h;
  const cap = `<Section N="Geometry" IX="1">${cell('NoFill', 1)}${cell('NoLine', 0)}${rel(0, 1 - ry, 'RelMoveTo', 1)}${rel(1, 1 - ry, 'RelLineTo', 2)}</Section>`;
  return main + cap;
}

/** A 2-D shape from a pixel rect on a page of the given pixel height. */
export function shape2d(id: number, r: Rect, pageH: number, style: ShapeStyle, text?: ShapeText, name?: string): string {
  const w = inches(r.w), h = inches(r.h);
  const pinX = inches(r.x) + w / 2, pinY = inches(pageH - r.y - r.h) + h / 2;
  const cells = [
    cell('PinX', pinX), cell('PinY', pinY), cell('Width', w), cell('Height', h),
    cell('LocPinX', w / 2, ' F="Width*0.5"'), cell('LocPinY', h / 2, ' F="Height*0.5"'),
    cell('FillForegnd', style.fill ?? PLAIN.paper), cell('FillPattern', style.fill ? 1 : 0),
    cell('LineColor', style.stroke ?? PLAIN.ink), cell('LinePattern', style.stroke ? style.pattern ?? 1 : 0),
    cell('LineWeight', LINE_WEIGHT(style.strokeWidth ?? 1.25)),
    cell('Rounding', inches(style.rounding ?? 0)),
    textCells(text),
  ];
  return `<Shape ID="${id}" ${name ? `NameU="${xmlEsc(name)}" Name="${xmlEsc(name)}" ` : ''}Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">${cells.join('')}${geometry(style, r.w, r.h)}${textSection(text)}</Shape>`;
}

/** A picture: a foreign shape whose PNG lives in the page's relationships under `relId`. */
export function picture(id: number, r: Rect, pageH: number, relId: string, name: string): string {
  const w = inches(r.w), h = inches(r.h);
  const pinX = inches(r.x) + w / 2, pinY = inches(pageH - r.y - r.h) + h / 2;
  const cells = [
    cell('PinX', pinX), cell('PinY', pinY), cell('Width', w), cell('Height', h),
    cell('LocPinX', w / 2, ' F="Width*0.5"'), cell('LocPinY', h / 2, ' F="Height*0.5"'),
    cell('ImgOffsetX', 0), cell('ImgOffsetY', 0), cell('ImgWidth', w, ' F="Width"'), cell('ImgHeight', h, ' F="Height"'),
    cell('LinePattern', 0), cell('FillPattern', 0),
  ];
  return `<Shape ID="${id}" NameU="${xmlEsc(name)}" Name="${xmlEsc(name)}" Type="Foreign" LineStyle="0" FillStyle="0" TextStyle="0">${cells.join('')}<ForeignData ForeignType="Bitmap" CompressionType="PNG"><Rel r:id="${relId}"/></ForeignData></Shape>`;
}

export interface ConnectorStyle {
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly pattern: number;
  /** Visio arrow ids: 0 none, 4 filled triangle, 13 open arrow. */
  readonly endArrow: number;
  readonly beginArrow: number;
}

/** A 1-D connector through pixel waypoints, with a Connects entry for glue when the ends are known. */
export function connector(id: number, points: readonly Point[], pageH: number, style: ConnectorStyle, label?: TextBlock | { lines: readonly string[]; size: number }, labelColor: string = PLAIN.ink): string {
  const first = points[0], last = points[points.length - 1];
  if (!first || !last) return '';
  const toIn = (p: Point): Point => ({ x: inches(p.x), y: inches(pageH - p.y) });
  const b = toIn(first), e = toIn(last);
  const dx = e.x - b.x, dy = e.y - b.y;
  const len = Math.hypot(dx, dy) || 0.0001;
  const angle = Math.atan2(dy, dx);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const local = (p: Point): Point => {
    const q = toIn(p);
    const rx = q.x - b.x, ry = q.y - b.y;
    return { x: rx * cos + ry * sin, y: -rx * sin + ry * cos };
  };
  const rows = points.map((p, i) => {
    const l = local(p);
    return `<Row T="${i === 0 ? 'MoveTo' : 'LineTo'}" IX="${i + 1}">${cell('X', l.x)}${cell('Y', l.y)}</Row>`;
  });
  const cells = [
    cell('BeginX', b.x), cell('BeginY', b.y), cell('EndX', e.x), cell('EndY', e.y),
    cell('PinX', (b.x + e.x) / 2), cell('PinY', (b.y + e.y) / 2), cell('Width', len), cell('Height', 0),
    cell('LocPinX', len / 2, ' F="Width*0.5"'), cell('LocPinY', 0, ' F="Height*0.5"'), cell('Angle', angle),
    cell('ObjType', 2),
    cell('LineColor', style.stroke), cell('LineWeight', LINE_WEIGHT(style.strokeWidth)), cell('LinePattern', style.pattern),
    cell('BeginArrow', style.beginArrow), cell('EndArrow', style.endArrow), cell('BeginArrowSize', 1), cell('EndArrowSize', 1),
    cell('TextBkgnd', 1),
  ];
  const text = label && label.lines.length ? textSection({ runs: [{ text: label.lines.join('\n'), color: labelColor, sizePx: label.size, bold: false }], align: 'center', vertical: 'middle' }) : '';
  return `<Shape ID="${id}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">${cells.join('')}<Section N="Geometry" IX="0">${cell('NoFill', 1)}${cell('NoLine', 0)}${rows.join('')}</Section>${text}</Shape>`;
}

export function connect(fromSheet: number, toSheet: number, end: 'begin' | 'end'): string {
  return `<Connect FromSheet="${fromSheet}" FromCell="${end === 'begin' ? 'BeginX' : 'EndX'}" FromPart="${end === 'begin' ? 9 : 12}" ToSheet="${toSheet}" ToCell="PinX" ToPart="3"/>`;
}

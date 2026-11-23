/**
 * VSDX reader. A .vsdx is a zip of OOXML parts; visio/pages/pages.xml
 * names the pages and visio/pages/pageN.xml holds the shapes. Units are
 * inches with the origin at the bottom left, so every y is flipped against
 * the page height and scaled at 96 pixels per inch. Connectors are 1-D
 * shapes glued to boxes through the Connects table. Pictures are foreign
 * shapes whose bytes sit in visio/media behind the page's relationships.
 * Lucidchart exports to this format, so it comes through the same path.
 */
import { strFromU8, unzipSync } from 'fflate';
import type { Head } from '@vantage/model';
import type { Drawing, Point, RawEdge, RawPage, RawShape, Rect, ShapeForm } from './drawing.ts';
import { splitLines } from './text.ts';
import { childElements, descendants, firstChild, parseXml, textOf, type XmlElement } from './xml.ts';

const PX = 96;

interface Sheet {
  readonly el: XmlElement;
  readonly id: string;
  readonly cells: ReadonlyMap<string, string>;
  readonly master?: string;
}

function cellsOf(shape: XmlElement): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of childElements(shape, 'Cell')) {
    const n = c.attrs['N'], v = c.attrs['V'];
    if (n !== undefined && v !== undefined) m.set(n, v);
  }
  return m;
}

const num = (v: string | undefined, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export function isVsdx(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/** Visio arrowhead ids to our heads. Ids outside the known sets are reported. */
function headOf(v: string | undefined, fallback: Head, unmapped: string[], key: string): Head {
  if (v === undefined) return fallback;
  const n = num(v, -1);
  if (n === 0) return 'none';
  if ([1, 2, 3, 4, 5, 6, 11, 12].includes(n)) return 'filled';
  if ([13, 14, 15, 16].includes(n)) return 'open';
  if ([7, 8, 19].includes(n)) return 'diamond';
  if ([10, 20, 21, 22].includes(n)) return 'circle';
  if ([27, 28].includes(n)) return 'many';
  if ([29, 30].includes(n)) return 'one';
  unmapped.push(`${key}=${v}`);
  return fallback;
}

/** Shape form from the geometry rows and the master name. */
function formOf(sheet: Sheet, masterName: string | undefined, w: number, h: number): { form: ShapeForm; unmapped: string[] } {
  const name = `${masterName ?? ''} ${sheet.el.attrs['NameU'] ?? ''}`.toLowerCase();
  const geometries = childElements(sheet.el, 'Section').filter((s) => s.attrs['N'] === 'Geometry');
  const rows = geometries.flatMap((g) => childElements(g, 'Row').map((r) => r.attrs['T'] ?? ''));
  if (rows.includes('Ellipse') || rows.includes('EllipticalArcTo') && rows.length <= 5 || /\b(circle|ellipse)\b/.test(name)) return { form: Math.abs(w - h) <= 2 ? 'circle' : 'ellipse', unmapped: [] };
  if (/database|cylinder|data store|datastore/.test(name) || geometries.length === 2 && rows.filter((r) => r === 'RelLineTo').length === 5) return { form: 'cylinder', unmapped: [] };
  if (/decision|diamond/.test(name)) return { form: 'diamond', unmapped: [] };
  if (/cloud/.test(name)) return { form: 'cloud', unmapped: [] };
  if (/document/.test(name)) return { form: 'document', unmapped: [] };
  if (/hexagon|preparation/.test(name) || rows.filter((r) => r === 'RelLineTo').length === 6) return { form: 'hexagon', unmapped: [] };
  if (/parallelogram|\bdata\b/.test(name)) return { form: 'parallelogram', unmapped: [] };
  if (/triangle/.test(name)) return { form: 'triangle', unmapped: [] };
  if (/person|actor|user/.test(name)) return { form: 'person', unmapped: [] };
  if (num(sheet.cells.get('Rounding')) > 0.02) return { form: 'rounded', unmapped: [] };
  const known = /rectangle|process|box|square|container|swimlane|^\s*$|sheet\.\d+|^ *\w+\.\d+ *$/.test(name) || masterName === undefined;
  return { form: 'box', unmapped: known ? [] : [`master=${masterName}`] };
}

function shapeText(el: XmlElement): string[] {
  const t = firstChild(el, 'Text');
  return t ? splitLines(textOf(t)) : [];
}

interface Frame {
  /** Page coordinates in inches of the parent's local origin, plus rotation. */
  readonly ox: number;
  readonly oy: number;
}

const PICTURE_TYPES: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', emf: 'image/x-emf', wmf: 'image/x-wmf', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff' };

/** A page's pictures by relationship id, as data URLs. */
type PageMedia = (relId: string) => string | undefined;

/** The picture a foreign shape embeds: through a relationship in a vsdx, inline base64 in older files. */
function foreignPicture(el: XmlElement, media: PageMedia): string | undefined {
  const fd = firstChild(el, 'ForeignData');
  if (!fd) return undefined;
  const rel = firstChild(fd, 'Rel');
  if (rel) return media(rel.attrs['r:id'] ?? '');
  const inline = textOf(fd).replace(/\s+/g, '');
  const kind = (fd.attrs['CompressionType'] ?? (fd.attrs['ForeignType'] === 'EnhMetaFile' ? 'emf' : 'png')).toLowerCase();
  return inline ? `data:${PICTURE_TYPES[kind] ?? `image/${kind}`};base64,${inline}` : undefined;
}

function readShapes(container: XmlElement, frame: Frame, pageH: number, masters: ReadonlyMap<string, string>, shapes: RawShape[], edges: RawEdge[], parentId: string | undefined, warnings: string[], media: PageMedia): void {
  for (const el of childElements(container, 'Shape')) {
    const id = el.attrs['ID'] ?? `${shapes.length + edges.length}`;
    const sheet: Sheet = { el, id, cells: cellsOf(el), ...(el.attrs['Master'] !== undefined ? { master: el.attrs['Master'] } : {}) };
    const c = sheet.cells;
    const w = num(c.get('Width')), h = num(c.get('Height'));
    const pinX = num(c.get('PinX')), pinY = num(c.get('PinY'));
    const locX = num(c.get('LocPinX'), w / 2), locY = num(c.get('LocPinY'), h / 2);
    const angle = num(c.get('Angle'));
    // Local point to page inches, honouring the pin, the local pin, and the rotation.
    const toPage = (lx: number, ly: number): Point => {
      const dx = lx - locX, dy = ly - locY;
      return { x: frame.ox + pinX + dx * Math.cos(angle) - dy * Math.sin(angle), y: frame.oy + pinY + dx * Math.sin(angle) + dy * Math.cos(angle) };
    };
    const px = (p: Point): Point => ({ x: p.x * PX, y: (pageH - p.y) * PX });
    const isConnector = c.has('BeginX') || c.has('EndX') || c.get('ObjType') === '2' && c.has('BeginX');
    const lines = shapeText(el);
    if (isConnector) {
      const unmapped: string[] = [];
      const begin: Point = { x: frame.ox + num(c.get('BeginX')), y: frame.oy + num(c.get('BeginY')) };
      const end: Point = { x: frame.ox + num(c.get('EndX')), y: frame.oy + num(c.get('EndY')) };
      const way: Point[] = [];
      for (const g of childElements(el, 'Section').filter((s) => s.attrs['N'] === 'Geometry')) {
        for (const row of childElements(g, 'Row')) {
          const t = row.attrs['T'];
          if (t !== 'LineTo' && t !== 'MoveTo') continue;
          const rc = cellsOf(row);
          way.push(toPage(num(rc.get('X')), num(rc.get('Y'))));
        }
      }
      const inner = way.length >= 2 ? way.slice(1, -1) : [];
      const pattern = num(c.get('LinePattern'), 1);
      edges.push({
        id,
        lines,
        style: inner.length ? 'orthogonal' : 'straight',
        dashed: pattern >= 2 && pattern <= 23 && pattern !== 1,
        heads: { from: headOf(c.get('BeginArrow'), 'none', unmapped, 'BeginArrow'), to: headOf(c.get('EndArrow'), 'filled', unmapped, 'EndArrow') },
        points: [px(begin), ...inner.map(px), px(end)],
        syntheticEnds: false,
        unmapped,
      });
      continue;
    }
    const origin = toPage(0, 0);
    const topLeft = px({ x: origin.x, y: origin.y + h });
    const rect: Rect = { x: topLeft.x, y: topLeft.y, w: w * PX, h: h * PX };
    const masterName = sheet.master !== undefined ? masters.get(sheet.master) : undefined;
    const fm = formOf(sheet, masterName, rect.w, rect.h);
    const fillPattern = num(c.get('FillPattern'), 1), linePattern = num(c.get('LinePattern'), 1);
    const fill = fillPattern === 0 ? 'none' : c.get('FillForegnd');
    const stroke = linePattern === 0 ? 'none' : c.get('LineColor');
    const nested = firstChild(el, 'Shapes');
    const isGroup = el.attrs['Type'] === 'Group' || nested !== undefined;
    const image = foreignPicture(el, media);
    shapes.push({
      id,
      ...(parentId !== undefined ? { parentId } : {}),
      rect,
      lines,
      form: fm.form,
      container: isGroup && lines.length > 0 || /swimlane|container/i.test(masterName ?? ''),
      group: isGroup && lines.length === 0,
      ...(fill !== undefined ? { fill } : {}),
      ...(stroke !== undefined ? { stroke } : {}),
      dashed: linePattern >= 2 && linePattern <= 23,
      text: fill === 'none' && stroke === 'none' && lines.length > 0 && !isGroup,
      frameless: fill === 'none' && stroke === 'none' && isGroup,
      note: false,
      ...(image !== undefined ? { image } : {}),
      unmapped: fm.unmapped,
    });
    if (nested) {
      // Children live in the group's local coordinates: origin at its bottom left corner.
      readShapes(nested, { ox: origin.x, oy: origin.y }, pageH, masters, shapes, edges, id, warnings, media);
    }
  }
}

function glue(page: XmlElement, edges: RawEdge[]): RawEdge[] {
  const connects = firstChild(page, 'Connects');
  if (!connects) return edges;
  const byId = new Map(edges.map((e) => [e.id, e]));
  for (const c of childElements(connects, 'Connect')) {
    const e = byId.get(c.attrs['FromSheet'] ?? '');
    const to = c.attrs['ToSheet'];
    if (!e || to === undefined) continue;
    const cell = c.attrs['FromCell'] ?? '';
    const next: RawEdge = cell.startsWith('Begin') ? { ...e, source: to } : cell.startsWith('End') ? { ...e, target: to } : e;
    byId.set(e.id, next);
  }
  return edges.map((e) => byId.get(e.id) ?? e);
}

function mastersOf(files: Record<string, Uint8Array>): Map<string, string> {
  const out = new Map<string, string>();
  const part = files['visio/masters/masters.xml'];
  if (!part) return out;
  for (const m of descendants(parseXml(strFromU8(part)), 'Master')) {
    const id = m.attrs['ID'], name = m.attrs['NameU'] ?? m.attrs['Name'];
    if (id !== undefined && name !== undefined) out.set(id, name);
  }
  return out;
}

export function readVsdx(bytes: Uint8Array): Drawing {
  const files = unzipSync(bytes);
  const warnings: string[] = [];
  const pagesPart = files['visio/pages/pages.xml'];
  if (!pagesPart) throw new Error('vsdx: visio/pages/pages.xml is missing');
  const pagesXml = parseXml(strFromU8(pagesPart));
  const rels = files['visio/pages/_rels/pages.xml.rels'];
  const relTargets = new Map<string, string>();
  if (rels) for (const r of descendants(parseXml(strFromU8(rels)), 'Relationship')) relTargets.set(r.attrs['Id'] ?? '', r.attrs['Target'] ?? '');
  const masters = mastersOf(files);
  const pages: RawPage[] = [];
  childElements(pagesXml, 'Page').forEach((p, i) => {
    const name = p.attrs['Name'] ?? p.attrs['NameU'] ?? `Page ${i + 1}`;
    const rel = firstChild(p, 'Rel');
    const target = relTargets.get(rel?.attrs['r:id'] ?? '') ?? `page${i + 1}.xml`;
    const part = files[`visio/pages/${target.replace(/^\/?visio\/pages\//, '')}`];
    if (!part) {
      warnings.push(`page ${name}: part ${target} is missing`);
      return;
    }
    const content = parseXml(strFromU8(part));
    const sheet = firstChild(p, 'PageSheet');
    const shapesEl = firstChild(content, 'Shapes');
    const shapes: RawShape[] = [];
    const edges: RawEdge[] = [];
    const pageH = num(sheet ? cellsOf(sheet).get('PageHeight') : undefined) || pageHeightFrom(shapesEl);
    const media = pageMedia(files, `visio/pages/${target.replace(/^\/?visio\/pages\//, '')}`, (w) => warnings.push(`page ${name}: ${w}`));
    if (shapesEl) readShapes(shapesEl, { ox: 0, oy: 0 }, pageH, masters, shapes, edges, undefined, warnings, media);
    pages.push({ name, shapes, edges: glue(content, edges) });
  });
  return { pages, warnings };
}

/** The pictures a page part's relationships point at, read from the package. */
function pageMedia(files: Record<string, Uint8Array>, partPath: string, warn: (w: string) => void): PageMedia {
  const dir = partPath.slice(0, partPath.lastIndexOf('/'));
  const relsPart = files[`${dir}/_rels/${partPath.slice(dir.length + 1)}.rels`];
  const targets = new Map<string, string>();
  if (relsPart) for (const r of descendants(parseXml(strFromU8(relsPart)), 'Relationship')) targets.set(r.attrs['Id'] ?? '', r.attrs['Target'] ?? '');
  return (relId) => {
    const target = targets.get(relId);
    if (target === undefined) return undefined;
    const parts = `${dir}/${target}`.split('/');
    const path: string[] = [];
    for (const p of parts) if (p === '..') path.pop(); else if (p !== '.' && p !== '') path.push(p);
    const bytes = files[path.join('/')];
    if (!bytes) {
      warn(`picture ${target} is missing from the package`);
      return undefined;
    }
    const ext = target.slice(target.lastIndexOf('.') + 1).toLowerCase();
    return `data:${PICTURE_TYPES[ext] ?? `image/${ext}`};base64,${Buffer.from(bytes).toString('base64')}`;
  };
}

/** Without a page sheet, the page is as tall as its highest shape. */
function pageHeightFrom(shapesEl: XmlElement | undefined): number {
  if (!shapesEl) return 0;
  let top = 0;
  for (const s of childElements(shapesEl, 'Shape')) {
    const c = cellsOf(s);
    top = Math.max(top, num(c.get('PinY')) - num(c.get('LocPinY'), num(c.get('Height')) / 2) + num(c.get('Height')));
  }
  return top;
}

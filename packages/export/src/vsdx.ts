/**
 * VSDX export: a zip of the minimal OOXML parts with one page per view.
 * Containers are plain shapes placed behind their children; edges are 1-D
 * connectors glued to the boxes they join; icons and pictures are foreign
 * shapes over their box, drawn as PNG (the one picture format every Visio
 * reads).
 */
import { strToU8, zipSync } from 'fflate';
import type { Extra, Layout, LayoutBox, LayoutEdge } from '@vantage/layout';
import type { RelationKind } from '@vantage/model';
import { THEMES, assetHref, familyOf, FileAssetSource, renderPng, type Resources, type Theme } from '@vantage/render';
import { inches, mix, num, xmlEsc, type ExportTheme } from './common.ts';
import { appProps, contentTypes, coreProps, documentRels, documentXml, pageRels, pagesRels, rootRels, REL_NS, VISIO_NS } from './vsdx-parts.ts';
import { connect, connector, picture, shape2d, type ConnectorStyle, type ShapeStyle, type ShapeText } from './vsdx-shapes.ts';
import { vsdxExtra } from './vsdx-extras.ts';

export interface VsdxOptions extends Resources {
  readonly theme?: ExportTheme;
  readonly title?: string;
  readonly author?: string;
}

const PATTERN: Record<RelationKind, number> = { sync: 1, async: 2, data: 1, deploy: 3, auth: 4, observe: 3, manage: 2 };
const OPEN_ARROW = new Set<RelationKind>(['async', 'observe']);

const UNDER = new Set<Extra['kind']>(['panel']);
const MID = new Set<Extra['kind']>(['highlight', 'line']);
const OVER = new Set<Extra['kind']>(['badge', 'text', 'legend', 'note']);

function rounding(b: LayoutBox): number {
  if (b.kind === 'container') return 10;
  switch (b.shape) {
    case 'rounded': return 8;
    case 'pill': case 'queue': return b.h / 2;
    case 'cloud': return Math.min(22, b.h / 2);
    case 'person': return 10;
    default: return 0;
  }
}

function boxText(b: LayoutBox, theme: Theme, nameColor: string): ShapeText {
  const runs = [{ text: b.name.lines.join('\n'), color: nameColor, sizePx: b.name.size, bold: b.name.weight !== 'regular' }];
  if (b.subtitle) runs.push({ text: b.subtitle.lines.join('\n'), color: theme.muted, sizePx: b.subtitle.size, bold: false });
  for (const t of b.texts ?? []) runs.push({ text: t.lines.join('\n'), color: theme.ink, sizePx: t.size, bold: t.weight !== 'regular' });
  const left = b.name.anchor === 'start';
  return { runs, align: left ? 'left' : 'center', vertical: 'top', ...(left ? { leftPx: b.name.x } : {}), topPx: Math.max(0, b.name.y - 2) };
}

function boxShape(id: number, b: LayoutBox, pageH: number, theme: Theme): string {
  const fam = familyOf(theme, b.node.color);
  const dashed = b.frame === 'dashed' ? 2 : 1;
  if (b.kind === 'container') {
    const base = b.node.style.fill ?? theme.containerFills[Math.min(b.depth, theme.containerFills.length - 1)]!;
    const fill = b.node.color !== 'slate' && !b.node.style.fill ? mix(fam.fill, base, 0.35) : base;
    const stroke = b.node.style.stroke ?? (b.node.color === 'slate' ? theme.containerStroke : fam.softStroke);
    const style: ShapeStyle = b.frame === 'none' ? { rounding: 10 } : { fill, stroke, strokeWidth: b.node.style.emphasis === 'high' ? 2 : 1.25, pattern: dashed, rounding: 10 };
    return shape2d(id, b, pageH, style, boxText(b, theme, theme.containerTitle), b.node.name);
  }
  if (b.iconOnly) return shape2d(id, b, pageH, {}, boxText(b, theme, theme.ink), b.node.name);
  const style: ShapeStyle = { fill: b.node.style.fill ?? fam.fill, stroke: b.node.style.stroke ?? fam.stroke, strokeWidth: b.node.style.emphasis === 'high' ? 2.25 : 1.25, pattern: dashed, rounding: rounding(b), shape: b.shape };
  return shape2d(id, b, pageH, style, boxText(b, theme, fam.text), b.node.name);
}

function edgeShape(id: number, e: LayoutEdge, pageH: number, theme: Theme): string {
  const colorName = e.color ?? e.relation.color;
  const open = OPEN_ARROW.has(e.kind);
  const style: ConnectorStyle = {
    stroke: colorName ? familyOf(theme, colorName).stroke : theme.edge,
    strokeWidth: (e.kind === 'data' ? 2 : 1.5) + (e.relation.weight >= 2 ? 1 : 0),
    pattern: PATTERN[e.kind],
    endArrow: open ? 13 : 4,
    beginArrow: e.both ? (open ? 13 : 4) : 0,
  };
  return connector(id, e.points, pageH, style, e.label, theme.ink);
}

/** The package's pictures as PNG files, shared across pages, each rendered once. */
export class VsdxMedia {
  readonly files: Record<string, Uint8Array> = {};
  private readonly byKey = new Map<string, string>();

  constructor(private readonly res: Resources) {}

  /** The media file for a box's icon, in the box's color where the icon takes one. */
  icon(id: string, color: string): string | undefined {
    const svg = this.res.icons?.get(id);
    return svg ? this.add(`icon:${id}:${color}`, () => svg.replace(/currentColor/g, color), 96) : undefined;
  }

  /** The media file for a picture node. */
  image(ref: string, w: number, h: number): string | undefined {
    const href = assetHref(ref, this.res.assets ?? new FileAssetSource());
    if (href === undefined) return undefined;
    return this.add(`image:${ref}`, () => `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${num(w)} ${num(h)}"><image href="${xmlEsc(href)}" width="${num(w)}" height="${num(h)}" preserveAspectRatio="xMidYMid meet"/></svg>`, Math.round(w * 3));
  }

  private add(key: string, svg: () => string, width: number): string | undefined {
    const known = this.byKey.get(key);
    if (known !== undefined) return known;
    try {
      const target = `image${this.byKey.size + 1}.png`;
      this.files[`visio/media/${target}`] = renderPng(svg(), { width }).bytes;
      this.byKey.set(key, target);
      return target;
    } catch {
      return undefined;
    }
  }
}

/** One page part: shapes in paint order, then the glue table; `rels` lists the pictures it draws. */
export function vsdxPage(layout: Layout, opts: VsdxOptions = {}, media: VsdxMedia = new VsdxMedia(opts)): { xml: string; rels: { relId: string; target: string }[] } {
  const theme = THEMES[opts.theme ?? 'light'];
  const pageH = layout.height;
  const extras = layout.extras ?? [];
  const shapes: string[] = [];
  const connects: string[] = [];
  let next = 1;
  const sheetOf = new Map<string, number>();
  const rels: { relId: string; target: string }[] = [];
  const pictures = (b: LayoutBox): void => {
    const draw = (target: string | undefined, r: { x: number; y: number; w: number; h: number }, name: string): void => {
      if (target === undefined) return;
      const relId = `rId${rels.length + 1}`;
      rels.push({ relId, target });
      shapes.push(picture(next++, { x: b.x + r.x, y: b.y + r.y, w: r.w, h: r.h }, pageH, relId, name));
    };
    if (b.image) draw(media.image(b.image.href, b.image.w, b.image.h), b.image, `${b.node.name} picture`);
    if (b.icon) draw(media.icon(b.icon.id, familyOf(theme, b.node.color).stroke), { x: b.icon.x, y: b.icon.y, w: b.icon.size, h: b.icon.size }, `${b.node.name} icon`);
  };
  const pushExtras = (list: readonly Extra[]): void => {
    for (const e of list) {
      const made = vsdxExtra(e, next, pageH, theme);
      shapes.push(...made);
      next += made.length;
    }
  };
  pushExtras(extras.filter((e) => UNDER.has(e.kind)));
  pushExtras(extras.filter((e) => e.kind === 'lane'));
  for (const b of layout.boxes.filter((x) => x.kind === 'container').sort((a, c) => a.depth - c.depth)) {
    sheetOf.set(b.id, next);
    shapes.push(boxShape(next++, b, pageH, theme));
    pictures(b);
  }
  pushExtras(extras.filter((e) => MID.has(e.kind)));
  for (const b of layout.boxes.filter((x) => x.kind !== 'container')) {
    sheetOf.set(b.id, next);
    shapes.push(boxShape(next++, b, pageH, theme));
    pictures(b);
  }
  pushExtras(extras.filter((e) => !UNDER.has(e.kind) && !MID.has(e.kind) && !OVER.has(e.kind) && e.kind !== 'lane'));
  for (const e of layout.edges) {
    const id = next++;
    shapes.push(edgeShape(id, e, pageH, theme));
    const from = sheetOf.get(e.from), to = sheetOf.get(e.to);
    if (from !== undefined) connects.push(connect(id, from, 'begin'));
    if (to !== undefined) connects.push(connect(id, to, 'end'));
  }
  pushExtras(extras.filter((e) => OVER.has(e.kind)));
  return { xml: `<?xml version="1.0" encoding="utf-8"?>\n<PageContents xmlns="${VISIO_NS}" xmlns:r="${REL_NS}" xml:space="preserve"><Shapes>${shapes.join('')}</Shapes>${connects.length ? `<Connects>${connects.join('')}</Connects>` : ''}</PageContents>`, rels };
}

function pagesXml(layouts: readonly Layout[], theme: Theme): string {
  const pages = layouts.map((l, i) => {
    const sheet = `<PageSheet LineStyle="0" FillStyle="0" TextStyle="0"><Cell N="PageWidth" V="${num(inches(l.width))}"/><Cell N="PageHeight" V="${num(inches(l.height))}"/><Cell N="PageScale" V="1" U="IN"/><Cell N="DrawingScale" V="1" U="IN"/><Cell N="DrawingSizeType" V="3"/><Cell N="DrawingScaleType" V="0"/><Cell N="PageLockReplace" V="0"/><Cell N="PageLockDuplicate" V="0"/></PageSheet>`;
    return `<Page ID="${i}" NameU="${xmlEsc(l.title)}" Name="${xmlEsc(l.title)}" ViewScale="1" ViewCenterX="${num(inches(l.width) / 2)}" ViewCenterY="${num(inches(l.height) / 2)}"${theme.name === 'dark' ? ' Background="0"' : ''}>${sheet}<Rel r:id="rId${i + 1}"/></Page>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>\n<Pages xmlns="${VISIO_NS}" xmlns:r="${REL_NS}" xml:space="preserve">${pages.join('')}</Pages>`;
}

/** The .vsdx package bytes. */
export function renderVsdx(layouts: readonly Layout[], opts: VsdxOptions = {}): Uint8Array<ArrayBuffer> {
  if (layouts.length === 0) throw new Error('vsdx export needs at least one view');
  const theme = THEMES[opts.theme ?? 'light'];
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes(layouts.length)),
    '_rels/.rels': strToU8(rootRels()),
    'docProps/core.xml': strToU8(coreProps(opts.title ?? layouts[0]!.title, opts.author)),
    'docProps/app.xml': strToU8(appProps()),
    'visio/document.xml': strToU8(documentXml()),
    'visio/_rels/document.xml.rels': strToU8(documentRels()),
    'visio/pages/pages.xml': strToU8(pagesXml(layouts, theme)),
    'visio/pages/_rels/pages.xml.rels': strToU8(pagesRels(layouts.length)),
  };
  const media = new VsdxMedia(opts);
  layouts.forEach((l, i) => {
    const page = vsdxPage(l, opts, media);
    files[`visio/pages/page${i + 1}.xml`] = strToU8(page.xml);
    if (page.rels.length) files[`visio/pages/_rels/page${i + 1}.xml.rels`] = strToU8(pageRels(page.rels));
  });
  Object.assign(files, media.files);
  const zipped = zipSync(files, { level: 6 });
  return new Uint8Array(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer);
}

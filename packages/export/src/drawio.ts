/**
 * draw.io export. Each view becomes a diagram page in an mxfile; containers
 * are group vertices whose children carry geometry relative to them, edges
 * keep our waypoints, and the paint order follows the SVG renderer.
 */
import type { Extra, Layout, LayoutBox, LayoutEdge } from '@vantage/layout';
import { THEMES, assetHref, familyOf, FileAssetSource, MapIconSource, type Resources, type Theme } from '@vantage/render';
import { num, xmlEsc, type ExportTheme } from './common.ts';
import { boxLabel, containerStyle, drawioDataUrl, edgeStyle, iconDataUrl, leafStyle, styleString } from './drawio-style.ts';
import { extraCells, vertex } from './drawio-extras.ts';

export interface DrawioOptions extends Resources {
  readonly theme?: ExportTheme;
}

const UNDER = new Set<Extra['kind']>(['panel']);
const MID = new Set<Extra['kind']>(['highlight', 'line']);
const OVER = new Set<Extra['kind']>(['badge', 'text', 'legend', 'note']);

function boxCell(b: LayoutBox, theme: Theme, byId: Map<string, LayoutBox>, res: Required<Resources>): string {
  const parent = b.parentId ? byId.get(b.parentId) : undefined;
  const parentCell = parent ? `n-${parent.id}` : '1';
  const rect = { x: b.x - (parent?.x ?? 0), y: b.y - (parent?.y ?? 0), w: b.w, h: b.h };
  const fam = familyOf(theme, b.node.color);
  const style = b.kind === 'container' ? containerStyle(b, theme) : leafStyle(b, theme);
  const value = boxLabel(b, theme, b.kind === 'container' ? theme.containerTitle : b.iconOnly ? theme.ink : fam.text);
  const cells = [vertex(`n-${b.id}`, value, style, rect, parentCell)];
  if (b.image) {
    const href = assetHref(b.image.href, res.assets);
    const url = href?.startsWith('data:') ? drawioDataUrl(href) : href;
    if (url) cells.push(vertex(`p-${b.id}`, '', { shape: 'image', image: url, imageAspect: 1, strokeColor: 'none', fillColor: 'none' }, { x: b.image.x, y: b.image.y, w: b.image.w, h: b.image.h }, `n-${b.id}`));
  }
  if (b.icon) {
    const svg = res.icons.get(b.icon.id);
    const url = svg ? iconDataUrl(svg, fam.stroke) : undefined;
    // `vantageIcon` names the icon so an import of this file gets the same id back.
    if (url) cells.push(vertex(`i-${b.id}`, '', { shape: 'image', image: url, imageAspect: 0, strokeColor: 'none', fillColor: 'none', vantageIcon: b.icon.id }, { x: b.icon.x, y: b.icon.y, w: b.icon.size, h: b.icon.size }, `n-${b.id}`));
  }
  if (b.badge) cells.push(vertex(`b-${b.id}`, b.badge, { rounded: 1, arcSize: 50, html: 1, fillColor: fam.stroke, strokeColor: 'none', fontColor: theme.canvas, fontSize: 10.5, fontStyle: 1 }, { x: b.kind === 'container' ? b.w - 10 - (b.badge.length * 6.4 + 14) : b.w + 6 - (b.badge.length * 6.4 + 14), y: b.kind === 'container' ? 9 : -9, w: b.badge.length * 6.4 + 14, h: 18 }, `n-${b.id}`));
  return cells.join('');
}

function edgeCell(e: LayoutEdge, theme: Theme, byId: Map<string, LayoutBox>): string {
  const from = byId.get(e.from), to = byId.get(e.to);
  const style = styleString(edgeStyle(e, theme, from, to));
  const way = e.points.slice(1, -1);
  const points = way.length ? `<Array as="points">${way.map((p) => `<mxPoint x="${num(p.x)}" y="${num(p.y)}"/>`).join('')}</Array>` : '';
  const first = e.points[0], last = e.points[e.points.length - 1];
  const ends = (first ? `<mxPoint x="${num(first.x)}" y="${num(first.y)}" as="sourcePoint"/>` : '') + (last ? `<mxPoint x="${num(last.x)}" y="${num(last.y)}" as="targetPoint"/>` : '');
  const label = e.label ? e.label.lines.join('<br>') : '';
  const terminals = `${from ? ` source="n-${xmlEsc(from.id)}"` : ''}${to ? ` target="n-${xmlEsc(to.id)}"` : ''}`;
  return `<mxCell id="e-${xmlEsc(e.id)}" value="${xmlEsc(label)}" style="${xmlEsc(style)}" edge="1" parent="1"${terminals}><mxGeometry relative="1" as="geometry">${ends}${points}</mxGeometry></mxCell>`;
}

/** The mxGraphModel of one view. */
export function drawioModel(layout: Layout, opts: DrawioOptions = {}): string {
  const theme = THEMES[opts.theme ?? 'light'];
  const byId = new Map(layout.boxes.map((b) => [b.id, b]));
  const extras = layout.extras ?? [];
  const containers = layout.boxes.filter((b) => b.kind === 'container').sort((a, b) => a.depth - b.depth);
  const leaves = layout.boxes.filter((b) => b.kind !== 'container');
  const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const res: Required<Resources> = { icons: opts.icons ?? new MapIconSource({}), assets: opts.assets ?? new FileAssetSource() };
  const push = (list: readonly Extra[]): void => {
    for (const e of list) cells.push(...extraCells(e, theme));
  };
  push(extras.filter((e) => UNDER.has(e.kind)));
  push(extras.filter((e) => e.kind === 'lane'));
  for (const c of containers) cells.push(boxCell(c, theme, byId, res));
  push(extras.filter((e) => MID.has(e.kind)));
  for (const l of leaves) cells.push(boxCell(l, theme, byId, res));
  push(extras.filter((e) => !UNDER.has(e.kind) && !MID.has(e.kind) && !OVER.has(e.kind) && e.kind !== 'lane'));
  for (const e of layout.edges) cells.push(edgeCell(e, theme, byId));
  push(extras.filter((e) => OVER.has(e.kind)));
  return `<mxGraphModel dx="0" dy="0" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${num(layout.width)}" pageHeight="${num(layout.height)}" background="${theme.canvas}"><root>${cells.join('')}</root></mxGraphModel>`;
}

/** A complete .drawio file with one page per view. */
export function renderDrawio(layouts: readonly Layout[], opts: DrawioOptions = {}): string {
  const pages = layouts.map((l) => `<diagram id="${xmlEsc(l.viewId)}" name="${xmlEsc(l.title)}">${drawioModel(l, opts)}</diagram>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="vantage" agent="vantage" version="24.0.0" type="device">${pages.join('')}</mxfile>\n`;
}

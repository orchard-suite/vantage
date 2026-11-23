/**
 * Renders a Layout to SVG text, for exports and for the viewer bundle;
 * every element carries data attributes the viewer uses for hover, focus,
 * and walkthroughs.
 */
import type { Layout, LayoutBox, LayoutEdge, TextBlock, Extra } from '@vantage/layout';
import { chipWidth } from '@vantage/layout';
import type { RelationKind } from '@vantage/model';
import { THEMES, familyOf, type Theme, type ThemeName } from './theme.ts';
import { cylinderCap, shapePath } from './shapes.ts';
import { symbolBody } from './icons/symbol.ts';
import { assetHref, type Resources } from './hrefs.ts';
import { renderExtras, renderStoryExtras } from './svg-extras.ts';
import { withOpenBadge } from './svg-open.ts';
import { titleBlockHeight, titleBlockSvg, type TitleBlock } from './title-block.ts';

export interface RenderOptions extends Resources {
  readonly theme?: ThemeName;
  /** Embed the Inter font faces as data urls (for standalone files). */
  readonly fontCss?: string;
  readonly background?: boolean;
  readonly title?: boolean;
  /** Header band above the picture; the SVG grows by its height. */
  readonly titleBlock?: TitleBlock;
  /** Dim boxes whose observed provenance is older than the threshold; `now` defaults to the clock. */
  readonly freshness?: { readonly thresholdDays: number; readonly now?: Date };
  /** Draw the open item badges on bound boxes; default the view's own choice, which is off. The viewers turn it on. */
  readonly openItems?: boolean;
}

/** Age class of a box from its provenance: fresh, stale, or unknown when nothing observed it. */
export function freshnessOf(observed: string | undefined, thresholdDays: number, now: Date): 'fresh' | 'stale' | 'unknown' {
  if (observed === undefined) return 'unknown';
  const t = Date.parse(observed);
  if (Number.isNaN(t)) return 'unknown';
  return now.getTime() - t > thresholdDays * 86400000 ? 'stale' : 'fresh';
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const r2 = (n: number): string => String(Math.round(n * 100) / 100);

type HeadShape = 'filled' | 'open' | 'diamond' | 'circle' | 'many' | 'one' | 'one-or-many' | 'zero-or-one';

const colorMarkers = new Map<string, string>();
/** A marker for one head shape in one color, created on first use. Returns the marker id. */
function markerFor(colorName: string, color: string, shape: HeadShape, canvas: string): string {
  const id = `mk-${shape}-${colorName.replace(/[^a-z0-9]+/gi, '-')}`;
  if (!colorMarkers.has(id)) {
    const body =
      shape === 'filled' ? `<path d="M1 1L9 5L1 9Z" fill="${color}" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`
      : shape === 'open' ? `<path d="M1 1L9 5L1 9" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`
      : shape === 'diamond' ? `<path d="M1 5L5 1.5L9 5L5 8.5Z" fill="${canvas}" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/>`
      : shape === 'circle' ? `<circle cx="5" cy="5" r="3.2" fill="${canvas}" stroke="${color}" stroke-width="1.4"/>`
      : shape === 'many' ? `<path d="M1 5H9M2 5L9 1M2 5L9 9" fill="none" stroke="${color}" stroke-width="1.3"/>`
      : shape === 'one' ? `<path d="M1 5H9M5 1.5V8.5" fill="none" stroke="${color}" stroke-width="1.3"/>`
      : shape === 'one-or-many' ? `<path d="M0 5H9M2 5L9 1M2 5L9 9M1.5 1.5V8.5" fill="none" stroke="${color}" stroke-width="1.3"/>`
      : `<path d="M0 5H9M6 1.5V8.5" fill="none" stroke="${color}" stroke-width="1.3"/><circle cx="2.5" cy="5" r="2" fill="${canvas}" stroke="${color}" stroke-width="1.2"/>`;
    const size = shape === 'diamond' ? 12 : shape === 'filled' || shape === 'open' ? 9 : 14;
    colorMarkers.set(id, `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${size}" markerHeight="${size}" orient="auto" markerUnits="userSpaceOnUse">${body}</marker>` +
      `<marker id="${id}-start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="${size}" markerHeight="${size}" orient="auto-start-reverse" markerUnits="userSpaceOnUse">${body}</marker>`);
  }
  return id;
}

/** The SVG of a layout. Pictures come from `assets` or are URLs; nothing here reads a disk, so it runs in a browser too. */
export function drawSvg(layout: Layout, opts: RenderOptions = {}): string {
  const theme = THEMES[opts.theme ?? 'light'];
  const parts: string[] = [];
  colorMarkers.clear();
  const usedIcons = new Map<string, string>();
  const iconId = (id: string): string | undefined => {
    if (!opts.icons) return undefined;
    const svg = opts.icons.get(id);
    if (!svg) return undefined;
    const sym = `i-${id.replace(/[^a-z0-9]+/gi, '-')}`;
    if (!usedIcons.has(sym)) {
      const { body, viewBox } = symbolBody(svg);
      usedIcons.set(sym, `<symbol id="${sym}" viewBox="${esc(viewBox)}">${body}</symbol>`);
    }
    return sym;
  };
  const draw: Draw = { iconId, imageHref: (ref) => assetHref(ref, opts.assets) ?? '' };

  const containers = layout.boxes.filter((b) => b.kind === 'container').sort((a, b) => a.depth - b.depth);
  const leaves = layout.boxes.filter((b) => b.kind !== 'container');
  const extras = layout.extras ?? [];
  // Paint order: page panels and lanes, containers, highlights and dividers, leaves, sequence decor, edges, then notes and text on top.
  const under = new Set(['panel']);
  const mid = new Set(['highlight', 'line']);
  const over = new Set(['badge', 'text', 'legend', 'note']);
  parts.push(renderStoryExtras(extras.filter((e) => under.has(e.kind)), theme));
  parts.push(renderExtras(extras.filter((e) => e.kind === 'lane'), theme));
  const stale = (b: LayoutBox): string => {
    if (!opts.freshness || !b.node.provenance) return '';
    const f = freshnessOf(b.node.provenance.observed, opts.freshness.thresholdDays, opts.freshness.now ?? new Date());
    return f === 'stale' ? ' v-stale' : f === 'fresh' ? ' v-fresh' : '';
  };
  const open = opts.openItems ?? layout.openItems ?? false;
  const badged = (group: string, b: LayoutBox): string => (open ? withOpenBadge(group, b, theme) : group);
  for (const c of containers) parts.push(badged(renderContainer(c, theme, draw).replace('class="v-box v-container"', `class="v-box v-container${stale(c)}"`), c));
  parts.push(renderStoryExtras(extras.filter((e) => mid.has(e.kind)), theme));
  for (const l of leaves) parts.push(badged(renderLeaf(l, theme, draw).replace(/class="v-box v-leaf( v-iconic)?"/, (m, ic: string | undefined) => `class="v-box v-leaf${ic ?? ''}${stale(l)}"`), l));
  parts.push(renderExtras(extras.filter((e) => !under.has(e.kind) && !mid.has(e.kind) && !over.has(e.kind) && e.kind !== 'lane'), theme));
  for (const e of layout.edges) parts.push(renderEdge(e, theme));
  parts.push(renderStoryExtras(extras.filter((e) => over.has(e.kind)), theme));

  const defs = [markers(theme), ...colorMarkers.values(), ...usedIcons.values()].join('');
  const style = `<style>${opts.fontCss ?? ''}text{font-family:${theme.fontFamily};}.v-stale{opacity:0.45}.v-stale .v-shape{stroke-dasharray:4 3}.v-open-stale{opacity:0.45}</style>`;
  const headerH = opts.titleBlock ? titleBlockHeight(opts.titleBlock) : 0;
  const header = opts.titleBlock ? titleBlockSvg(opts.titleBlock, layout.width, theme) : '';
  const height = layout.height + headerH;
  const bg = opts.background === false ? '' : `<rect class="v-canvas" width="${layout.width}" height="${height}" fill="${theme.canvas}"/>`;
  const root = headerH ? `<g class="v-root" transform="translate(0,${headerH})">` : '<g class="v-root">';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${layout.width}" height="${height}" viewBox="0 0 ${layout.width} ${height}" data-view="${esc(layout.viewId)}" data-theme="${theme.name}">${style}<defs>${defs}</defs>${bg}${header}${root}${parts.join('')}</g></svg>`;
}

function markers(theme: Theme): string {
  const m = (id: string, color: string, filled: boolean, start = false): string =>
    `<marker id="${id}" viewBox="0 0 10 10" refX="${start ? 1 : 9}" refY="5" markerWidth="9" markerHeight="9" orient="${start ? 'auto-start-reverse' : 'auto'}" markerUnits="userSpaceOnUse"><path d="${filled ? 'M1 1L9 5L1 9Z' : 'M1 1L9 5L1 9'}" fill="${filled ? color : 'none'}" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></marker>`;
  return [
    m('arrow', theme.edge, true),
    m('arrow-open', theme.edge, false),
    m('arrow-start', theme.edge, true, true),
    m('arrow-muted', theme.edgeMuted, true),
    m('arrow-hi', theme.hi, true),
    `<marker id="dot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse"><circle cx="5" cy="5" r="3" fill="${theme.edge}"/></marker>`,
  ].join('');
}

function text(t: TextBlock, color: string, ox = 0, oy = 0, cls = ''): string {
  const anchor = t.anchor === 'middle' ? ' text-anchor="middle"' : '';
  const lines = t.lines
    .map((line, i) => `<tspan x="${r2(ox + t.x)}" dy="${i === 0 ? r2(t.size * 0.95) : r2(t.lineHeight)}">${esc(line)}</tspan>`)
    .join('');
  return `<text class="${cls}" y="${r2(oy + t.y)}" font-size="${t.size}" font-weight="${t.weight === 'semibold' ? 600 : t.weight === 'medium' ? 500 : 400}" fill="${color}"${anchor}>${lines}</text>`;
}

function iconUse(sym: string | undefined, x: number, y: number, size: number, color: string): string {
  if (!sym) return '';
  return `<use href="#${sym}" x="${r2(x)}" y="${r2(y)}" width="${size}" height="${size}" color="${color}"/>`;
}

function badge(label: string, x: number, y: number, theme: Theme, fam: ReturnType<typeof familyOf>): string {
  const w = chipWidth(label);
  return `<g class="v-badge" transform="translate(${r2(x - w)},${r2(y)})"><rect width="${r2(w)}" height="18" rx="9" fill="${fam.stroke}" opacity="0.9"/><text x="${r2(w / 2)}" y="12.5" font-size="10.5" font-weight="500" text-anchor="middle" fill="${theme.canvas}">${esc(label)}</text></g>`;
}

/** How a box reaches its icon symbol and its picture. */
interface Draw {
  readonly iconId: (id: string) => string | undefined;
  readonly imageHref: (ref: string) => string;
}

function renderContainer(b: LayoutBox, theme: Theme, draw: Draw): string {
  const fam = familyOf(theme, b.node.color);
  const fill = b.node.style.fill ?? theme.containerFills[Math.min(b.depth, theme.containerFills.length - 1)]!;
  const stroke = b.node.style.stroke ?? (b.node.color === 'slate' ? theme.containerStroke : fam.softStroke);
  const dash = b.frame === 'dashed' ? ' stroke-dasharray="6 4"' : '';
  const sym = b.icon ? draw.iconId(b.icon.id) : undefined;
  const strong = b.node.style.emphasis === 'high';
  const shape = b.frame === 'none'
    ? `<rect class="v-shape" width="${r2(b.w)}" height="${r2(b.h)}" rx="10" fill="transparent" stroke="none"/>`
    : `<rect class="v-shape" width="${r2(b.w)}" height="${r2(b.h)}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${strong ? 2 : 1.25}"${dash}/>` +
      (b.node.color !== 'slate' ? `<rect width="${r2(b.w)}" height="${r2(b.h)}" rx="10" fill="${fam.fill}" opacity="0.35" pointer-events="none"/>` : '');
  return `<g class="v-box v-container" data-id="${esc(b.id)}" data-kind="container" data-depth="${b.depth}" transform="translate(${r2(b.x)},${r2(b.y)})">` +
    shape +
    (b.icon ? iconUse(sym, b.icon.x, b.icon.y, b.icon.size, fam.stroke) : '') +
    text(b.name, theme.containerTitle, 0, 0, 'v-name') +
    (b.subtitle ? text(b.subtitle, theme.muted, 0, 0, 'v-subtitle') : '') +
    (b.texts ?? []).map((t) => text(t, theme.ink, 0, 0, 'v-fact')).join('') +
    (b.badge ? badge(b.badge, b.w - 10, 9, theme, fam) : '') +
    `</g>`;
}

function renderLeaf(b: LayoutBox, theme: Theme, draw: Draw): string {
  const fam = familyOf(theme, b.node.color);
  const fill = b.node.style.fill ?? fam.fill;
  const stroke = b.node.style.stroke ?? fam.stroke;
  const dash = b.frame === 'dashed' ? ' stroke-dasharray="6 4"' : '';
  const sym = b.icon ? draw.iconId(b.icon.id) : undefined;
  if (b.iconOnly || b.frame === 'none') {
    const img = b.image ? `<image href="${esc(draw.imageHref(b.image.href))}" x="${r2(b.image.x)}" y="${r2(b.image.y)}" width="${r2(b.image.w)}" height="${r2(b.image.h)}" preserveAspectRatio="xMidYMid meet"/>` : '';
    return `<g class="v-box v-leaf v-iconic" data-id="${esc(b.id)}" data-kind="${b.kind}" data-depth="${b.depth}" transform="translate(${r2(b.x)},${r2(b.y)})">` +
      `<rect class="v-shape" width="${r2(b.w)}" height="${r2(b.h)}" rx="8" fill="transparent" stroke="none"/>` + img +
      (b.icon ? iconUse(sym, b.icon.x, b.icon.y, b.icon.size, fam.stroke) : '') +
      text(b.name, theme.ink, 0, 0, 'v-name') +
      (b.subtitle ? text(b.subtitle, theme.muted, 0, 0, 'v-subtitle') : '') +
      (b.texts ?? []).map((t) => text(t, theme.ink, 0, 0, 'v-fact')).join('') +
      (b.badge ? badge(b.badge, b.w + 6, -9, theme, fam) : '') +
      `</g>`;
  }
  const strong = b.node.style.emphasis === 'high';
  const path = shapePath(b.shape, b.w, b.h);
  const stack = b.node.style.plural ? `<path d="${shapePath(b.shape, b.w, b.h)}" transform="translate(5,-5)" fill="${fill}" stroke="${stroke}" stroke-width="1.25" opacity="0.6"/>` : '';
  const cap = b.shape === 'cylinder' ? `<path d="${cylinderCap(b.w)}" fill="none" stroke="${stroke}" stroke-width="1.25"/>` : '';
  const collapsed = b.kind === 'collapsed' ? `<path d="${path}" transform="translate(4,4)" fill="none" stroke="${stroke}" stroke-width="1.25" opacity="0.5"/>` : '';
  return `<g class="v-box v-leaf" data-id="${esc(b.id)}" data-kind="${b.kind}" data-depth="${b.depth}" transform="translate(${r2(b.x)},${r2(b.y)})">` +
    collapsed + stack +
    `<path class="v-shape" d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="${strong ? 2.25 : 1.25}"${dash}/>` + cap +
    (b.icon ? iconUse(sym, b.icon.x, b.icon.y, b.icon.size, fam.stroke) : '') +
    text(b.name, fam.text, 0, 0, 'v-name') +
    (b.subtitle ? text(b.subtitle, theme.muted, 0, 0, 'v-subtitle') : '') +
    (b.texts ?? []).map((t, i) => text(t, i === 0 && b.node.value !== undefined ? fam.text : theme.ink, 0, 0, 'v-fact')).join('') +
    (b.badge ? badge(b.badge, b.w + 6, -9, theme, fam) : '') +
    `</g>`;
}

export const EDGE_STYLE: Record<RelationKind, { dash?: string; marker: string; width: number }> = {
  sync: { marker: 'arrow', width: 1.5 },
  async: { dash: '6 4', marker: 'arrow-open', width: 1.5 },
  data: { marker: 'arrow', width: 2 },
  deploy: { dash: '2 4', marker: 'arrow', width: 1.5 },
  auth: { dash: '8 3 2 3', marker: 'arrow', width: 1.5 },
  observe: { dash: '1 4', marker: 'arrow-open', width: 1.5 },
  manage: { dash: '10 4', marker: 'arrow', width: 1.5 },
};

export function edgePath(e: LayoutEdge, radius = 8): string {
  const p = e.points;
  if (p.length < 2) return '';
  let d = `M${r2(p[0]!.x)} ${r2(p[0]!.y)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const prev = p[i - 1]!, cur = p[i]!, next = p[i + 1]!;
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y), outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const ux = (cur.x - prev.x) / (inLen || 1), uy = (cur.y - prev.y) / (inLen || 1);
    const vx = (next.x - cur.x) / (outLen || 1), vy = (next.y - cur.y) / (outLen || 1);
    d += `L${r2(cur.x - ux * r)} ${r2(cur.y - uy * r)}Q${r2(cur.x)} ${r2(cur.y)} ${r2(cur.x + vx * r)} ${r2(cur.y + vy * r)}`;
  }
  const last = p[p.length - 1]!;
  d += `L${r2(last.x)} ${r2(last.y)}`;
  return d;
}

/** A smooth curve through the points: quadratic segments through midpoints, the way a hand bows a line. */
export function curvedPath(points: readonly { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    const a = points[0]!, b = points[1]!;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const nx = -(b.y - a.y), ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    const bow = Math.min(40, len * 0.12);
    return `M${r2(a.x)} ${r2(a.y)}Q${r2(mx + (nx / len) * bow)} ${r2(my + (ny / len) * bow)} ${r2(b.x)} ${r2(b.y)}`;
  }
  let d = `M${r2(points[0]!.x)} ${r2(points[0]!.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const c = points[i]!, n = points[i + 1]!;
    d += `Q${r2(c.x)} ${r2(c.y)} ${r2((c.x + n.x) / 2)} ${r2((c.y + n.y) / 2)}`;
  }
  const last = points[points.length - 1]!;
  d += `L${r2(last.x)} ${r2(last.y)}`;
  return d;
}

function renderEdge(e: LayoutEdge, theme: Theme): string {
  const st = EDGE_STYLE[e.kind];
  const colorName = e.color ?? e.relation.color;
  const color = colorName ? familyOf(theme, colorName).stroke : theme.edge;
  const d = e.style === 'curved' ? curvedPath(e.points) : e.style === 'straight' && e.points.length === 2 ? `M${r2(e.points[0]!.x)} ${r2(e.points[0]!.y)}L${r2(e.points[1]!.x)} ${r2(e.points[1]!.y)}` : edgePath(e);
  const dash = st.dash ? ` stroke-dasharray="${st.dash}"` : '';
  const width = e.relation.weight >= 2 ? st.width + 1 : st.width;
  const defaultHead: HeadShape = st.marker === 'arrow-open' ? 'open' : 'filled';
  const toHead = e.heads?.to ?? defaultHead;
  const fromHead = e.heads?.from ?? (e.both ? defaultHead : 'none');
  const cname = colorName ?? 'edge';
  const markerId = toHead === 'none' ? undefined : markerFor(cname, color, toHead, theme.canvas);
  const startId = fromHead === 'none' ? undefined : markerFor(cname, color, fromHead, theme.canvas);
  const start = startId ? ` marker-start="url(#${startId}-start)"` : '';
  const label = e.label
    ? `<g class="v-label" transform="translate(${r2(e.label.x)},${r2(e.label.y)})"><rect width="${r2(e.label.w)}" height="${r2(e.label.h)}" rx="4" fill="${theme.labelHalo}" opacity="0.92"/>${text({ lines: e.label.lines, size: e.label.size, weight: 'regular', x: e.label.w / 2, y: 4, lineHeight: e.label.size * 1.25, anchor: 'middle' }, theme.ink)}</g>`
    : '';
  const title = e.relation.description ? `<title>${esc(e.relation.description)}</title>` : '';
  return `<g class="v-edge" data-id="${esc(e.id)}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" data-kind="${e.kind}" data-bundled="${e.bundled}">${title}` +
    `<path class="v-edge-hit" d="${d}" fill="none" stroke="transparent" stroke-width="14"/>` +
    `<path class="v-edge-line" d="${d}" fill="none" stroke="${color}" stroke-width="${width}"${dash}${markerId ? ` marker-end="url(#${markerId})"` : ''}${start} stroke-linejoin="round"/>` +
    label + `</g>`;
}

export type { Extra };

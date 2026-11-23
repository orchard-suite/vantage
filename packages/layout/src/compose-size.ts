/**
 * Sizing of one box from its content: name, subtitle, icon, facts, bullets,
 * a big value, and the presentation size. Everything is measured with the
 * real font, so a box is exactly as big as what it says.
 */
import type { Frame, ModelNode } from '@vantage/model';
import type { Rect, Size } from './geometry.ts';
import type { LayoutStyle } from './style.ts';
import type { LayoutBox, TextBlock } from './types.ts';
import { textWidth, wrapText, type WrappedText } from './text/measure.ts';

export interface Sized {
  readonly id: string;
  readonly size: Size;
  readonly children: Placement[];
  readonly box: Omit<LayoutBox, 'x' | 'y' | 'parentId' | 'inner'> & { inner?: Rect };
}

export interface Placement {
  readonly sized: Sized;
  readonly rect: Rect;
}

interface Scale {
  readonly name: number;
  readonly icon: number;
  readonly minWidth: number;
  readonly maxText: number;
  readonly padX: number;
  readonly padY: number;
}

function scaleFor(node: ModelNode, style: LayoutStyle): Scale {
  if (node.size === 'normal') return { name: style.nameSize, icon: style.iconSize, minWidth: style.leafMinWidth, maxText: style.leafMaxTextWidth, padX: style.leafPadX, padY: style.leafPadY };
  const s = style.nodeSizes[node.size];
  return { name: style.nameSize + s.nameStep, icon: s.icon ?? style.bigIconSize, minWidth: s.minWidth, maxText: s.maxText, padX: s.padX, padY: s.padY };
}

function block(w: WrappedText, size: number, weight: TextBlock['weight'], x: number, y: number, anchor: TextBlock['anchor']): TextBlock {
  return { lines: w.lines, size, weight, x, y, lineHeight: w.lineHeight, anchor };
}

/** Facts and bullets, wrapped, stacked top to bottom from y. */
function detailBlocks(node: ModelNode, maxText: number, x: number, y: number, anchor: TextBlock['anchor'], style: LayoutStyle): { blocks: TextBlock[]; width: number; height: number } {
  const blocks: TextBlock[] = [];
  let width = 0, cy = y;
  const push = (text: string, weight: TextBlock['weight']): void => {
    const w = wrapText(text, style.factSize, weight, Math.max(maxText, 140), 3);
    blocks.push(block(w, style.factSize, weight, x, cy, anchor));
    width = Math.max(width, w.width);
    cy += w.height + 1;
  };
  if (node.facts.length) cy += 4;
  for (const f of node.facts) push(f.label ? `${f.label}: ${f.value}` : f.value, 'medium');
  if (node.bullets.length) cy += 4;
  for (const b of node.bullets) push(`• ${b}`, 'regular');
  return { blocks, width, height: cy - y };
}

/** A leaf forced to a given size (a pin): content is re-centred inside the box, text is not re-wrapped. */
export function sizeLeafFixed(node: ModelNode, kind: 'leaf' | 'collapsed', hidden: number, style: LayoutStyle, fixed: Size): Sized {
  const natural = sizeLeafPlain(node, kind, hidden, style);
  const dx = (fixed.w - natural.size.w) / 2, dy = (fixed.h - natural.size.h) / 2;
  const move = (t: TextBlock): TextBlock => ({ ...t, x: t.x + (t.anchor === 'middle' ? dx : Math.max(0, dx)), y: t.y + dy });
  const b = natural.box;
  const box: Sized['box'] = {
    ...b,
    w: fixed.w,
    h: fixed.h,
    name: move(b.name),
    ...(b.subtitle ? { subtitle: move(b.subtitle) } : {}),
    ...(b.texts ? { texts: b.texts.map(move) } : {}),
    ...(b.icon ? { icon: { ...b.icon, x: b.icon.x + (b.iconOnly ? dx : Math.max(0, dx)), y: b.icon.y + dy } } : {}),
  };
  return { id: node.id, size: fixed, children: [], box };
}

/** Shapes that pinch their corners need a bigger box for the same content. */
const SHAPE_GROW: Partial<Record<ModelNode['shape'], { w: number; h: number }>> = {
  circle: { w: 1.35, h: 1.35 },
  ellipse: { w: 1.3, h: 1.35 },
  diamond: { w: 1.6, h: 1.8 },
  triangle: { w: 1.5, h: 2.0 },
  parallelogram: { w: 1.25, h: 1 },
};

export function sizeLeaf(node: ModelNode, kind: 'leaf' | 'collapsed', hidden: number, style: LayoutStyle): Sized {
  const grow = SHAPE_GROW[node.shape];
  if (grow) {
    const base = sizeLeafPlain(node, kind, hidden, style);
    const side = node.shape === 'circle' ? Math.max(base.size.w * 0.95, base.size.h * 1.5) : 0;
    const w = Math.ceil(side || base.size.w * grow.w), h = Math.ceil(side || base.size.h * grow.h);
    const fitted = sizeLeafFixed(node, kind, hidden, style, { w, h });
    // A triangle's room is at the bottom: push the content down a little.
    if (node.shape !== 'triangle') return fitted;
    const dy = h * 0.18;
    const b = fitted.box;
    const move = (t: TextBlock): TextBlock => ({ ...t, y: t.y + dy });
    return { ...fitted, box: { ...b, name: move(b.name), ...(b.subtitle ? { subtitle: move(b.subtitle) } : {}), ...(b.texts ? { texts: b.texts.map(move) } : {}), ...(b.icon ? { icon: { ...b.icon, y: b.icon.y + dy } } : {}) } };
  }
  return sizeLeafPlain(node, kind, hidden, style);
}

/** Text never ends in an ellipsis while widening the box can save it: the narrowest text width, up to twice the usual, at which the name, subtitle, and every fact fit their line limits. */
function fittedText(node: ModelNode, maxText: number, nameSize: number, style: LayoutStyle): number {
  const cut = (w: { lines: readonly string[] }): boolean => w.lines.some((l) => l.endsWith('…'));
  const fits = (m: number): boolean =>
    !cut(wrapText(node.name, nameSize, 'semibold', m, 2)) &&
    !(node.subtitle && cut(wrapText(node.subtitle, style.subtitleSize, 'regular', m, 2))) &&
    !node.facts.some((f) => cut(wrapText(f.label ? `${f.label}: ${f.value}` : f.value, style.factSize, 'medium', Math.max(m, 140), 3))) &&
    !node.bullets.some((b) => cut(wrapText(`• ${b}`, style.factSize, 'regular', Math.max(m, 140), 3)));
  for (let m = maxText; m <= maxText * 2; m += 20) if (fits(m)) return m;
  return maxText * 2;
}

function sizeLeafPlain(node: ModelNode, kind: 'leaf' | 'collapsed', hidden: number, style: LayoutStyle): Sized {
  const scaled = node.typeName === 'text' ? { ...scaleFor(node, style), maxText: 340, minWidth: 0 } : scaleFor(node, style);
  const sc = node.typeName === 'text' ? scaled : { ...scaled, maxText: fittedText(node, scaled.maxText, scaled.name, style) };
  const badge = kind === 'collapsed' ? `${hidden} inside` : node.count !== undefined ? `x${node.count}` : undefined;
  const hasIcon = node.icon !== undefined;
  const name = wrapText(node.name, sc.name, node.typeName === 'text' ? 'regular' : 'semibold', sc.maxText, node.typeName === 'text' ? 8 : 2);
  const subtitle = node.subtitle ? wrapText(node.subtitle, style.subtitleSize, 'regular', sc.maxText, 2) : undefined;
  const base = { id: node.id, kind, depth: node.depth, node, shape: node.shape, frame: node.style.frame ?? (node.style.dashed ? 'dashed' : 'box'), ...(badge ? { badge } : {}) } as const;

  if (node.image !== undefined && node.imageSize) {
    // A picture with its caption under it.
    const img = node.imageSize;
    const textW = Math.max(name.width, subtitle?.width ?? 0);
    const w = Math.ceil(Math.max(img.w, textW) + sc.padX * 2);
    const h = Math.ceil(sc.padY * 2 + img.h + 6 + name.height + (subtitle ? subtitle.height + 2 : 0));
    const y = sc.padY + img.h + 6;
    const box: Sized['box'] = { ...base, w, h, iconOnly: true, name: block(name, sc.name, 'semibold', w / 2, y, 'middle'), ...(subtitle ? { subtitle: block(subtitle, style.subtitleSize, 'regular', w / 2, y + name.height + 2, 'middle') } : {}), image: { href: node.image, x: (w - img.w) / 2, y: sc.padY, w: img.w, h: img.h } };
    return { id: node.id, size: { w, h }, children: [], box };
  }

  if (node.size === 'icon') {
    // A big icon with its caption under it and no shape: the inventory look.
    const details = detailBlocks(node, sc.maxText, 0, 0, 'middle', style);
    const textW = Math.max(name.width, subtitle?.width ?? 0, details.width);
    const w = Math.ceil(Math.max(sc.icon + 16, textW + sc.padX * 2));
    const iconH = hasIcon ? sc.icon + 6 : 0;
    const h = Math.ceil(sc.padY * 2 + iconH + name.height + (subtitle ? subtitle.height + 2 : 0) + details.height);
    let y = sc.padY + iconH;
    const nameB = block(name, sc.name, 'semibold', w / 2, y, 'middle');
    y += name.height + 2;
    const subB = subtitle ? block(subtitle, style.subtitleSize, 'regular', w / 2, y, 'middle') : undefined;
    y += subtitle ? subtitle.height : 0;
    const det = detailBlocks(node, sc.maxText, w / 2, y, 'middle', style);
    const box: Sized['box'] = { ...base, w, h, iconOnly: true, name: nameB, ...(subB ? { subtitle: subB } : {}), ...(hasIcon ? { icon: { id: node.icon!, x: (w - sc.icon) / 2, y: sc.padY, size: sc.icon } } : {}), ...(det.blocks.length ? { texts: det.blocks } : {}) };
    return { id: node.id, size: { w, h }, children: [], box };
  }

  if (node.value !== undefined) {
    // A sticky with one big figure: value on top, name as its caption, details under.
    const value = wrapText(node.value, style.valueSize, 'semibold', 220, 2);
    const details = detailBlocks(node, sc.maxText, 0, 0, 'middle', style);
    const textW = Math.max(value.width, name.width, subtitle?.width ?? 0, details.width);
    const w = Math.ceil(Math.max(sc.minWidth, textW + sc.padX * 2 + (hasIcon ? sc.icon + 8 : 0)));
    const h = Math.ceil(sc.padY * 2 + value.height + 4 + name.height + (subtitle ? subtitle.height + 2 : 0) + details.height);
    const cx = w / 2 + (hasIcon ? (sc.icon + 8) / 2 : 0);
    let y = sc.padY;
    const texts: TextBlock[] = [block(value, style.valueSize, 'semibold', cx, y, 'middle')];
    y += value.height + 4;
    const nameB = block(name, sc.name, 'semibold', cx, y, 'middle');
    y += name.height + 2;
    const subB = subtitle ? block(subtitle, style.subtitleSize, 'regular', cx, y, 'middle') : undefined;
    y += subtitle ? subtitle.height : 0;
    texts.push(...detailBlocks(node, sc.maxText, cx, y, 'middle', style).blocks);
    const box: Sized['box'] = { ...base, w, h, iconOnly: false, name: nameB, ...(subB ? { subtitle: subB } : {}), texts, ...(hasIcon ? { icon: { id: node.icon!, x: sc.padX, y: sc.padY, size: sc.icon } } : {}) };
    return { id: node.id, size: { w, h }, children: [], box };
  }

  const details = detailBlocks(node, sc.maxText, 0, 0, 'start', style);
  const textW = Math.max(name.width, subtitle?.width ?? 0, details.width);
  const textH = name.height + (subtitle ? subtitle.height + 2 : 0) + details.height;
  const iconW = hasIcon ? sc.icon + 10 : 0;
  const w = Math.max(sc.minWidth, Math.ceil(sc.padX * 2 + iconW + textW));
  const h = Math.ceil(Math.max(hasIcon ? sc.icon : 0, textH) + sc.padY * 2 + (node.shape === 'cylinder' ? 10 : 0));
  const textX = sc.padX + iconW;
  const top = (h - textH) / 2 + (node.shape === 'cylinder' ? 5 : 0);
  const det = detailBlocks(node, sc.maxText, textX, top + name.height + (subtitle ? subtitle.height + 2 : 0), 'start', style);
  const box: Sized['box'] = {
    ...base,
    w,
    h,
    iconOnly: false,
    name: block(name, sc.name, 'semibold', textX, top, 'start'),
    ...(subtitle ? { subtitle: block(subtitle, style.subtitleSize, 'regular', textX, top + name.height + 2, 'start') } : {}),
    ...(det.blocks.length ? { texts: det.blocks } : {}),
    ...(hasIcon ? { icon: { id: node.icon!, x: sc.padX, y: (h - sc.icon) / 2, size: sc.icon } } : {}),
  };
  return { id: node.id, size: { w, h }, children: [], box };
}

export interface ContainerHeader {
  readonly frame: Frame;
  readonly pad: number;
  /** Header height including facts. */
  readonly header: number;
  /** Minimum width the header text needs. */
  readonly minWidth: number;
  readonly parts: Pick<LayoutBox, 'name' | 'subtitle' | 'icon' | 'badge' | 'texts'>;
}

/** The title row and facts of a container, independent of where its children land. */
export function containerHeader(node: ModelNode, hidden: number, outline: boolean, style: LayoutStyle): ContainerHeader {
  const hasIcon = node.icon !== undefined;
  const frame = node.style.frame ?? (node.style.dashed ? 'dashed' : 'box');
  const nameW = textWidth(node.name, style.containerNameSize, 'semibold');
  const subW = node.subtitle ? textWidth(node.subtitle, style.subtitleSize, 'regular') : 0;
  const badge = hidden > 0 ? `+${hidden} more` : node.count !== undefined ? `x${node.count}` : undefined;
  const badgeW = badge ? textWidth(badge, style.subtitleSize, 'medium') + 16 : 0;
  const pad = frame === 'none' ? (outline ? 0 : 6) : style.containerPad;
  const textX = pad + (hasIcon ? style.containerIconSize + 8 : 0);
  const headerTextW = textX + nameW + (subW ? subW + 10 : 0) + (badgeW ? badgeW + 10 : 0);
  // Facts wrap no narrower than the title row, so a wide container's facts do not wrap early.
  const details = detailBlocks(node, Math.max(260, headerTextW - textX), textX, style.containerHeader - 8, 'start', style);
  const header = style.containerHeader + details.height + (details.height ? 4 : 0);
  return {
    frame,
    pad,
    header,
    minWidth: Math.max(headerTextW + pad, details.width + textX + pad),
    parts: {
      name: { lines: [node.name], size: style.containerNameSize, weight: 'semibold', x: textX, y: 10, lineHeight: style.containerNameSize * 1.25, anchor: 'start' },
      ...(node.subtitle ? { subtitle: { lines: [node.subtitle], size: style.subtitleSize, weight: 'regular', x: textX + nameW + 10, y: 10 + (style.containerNameSize - style.subtitleSize) / 2 + 1, lineHeight: style.subtitleSize * 1.25, anchor: 'start' } as TextBlock } : {}),
      ...(hasIcon ? { icon: { id: node.icon!, x: pad, y: 9, size: style.containerIconSize } } : {}),
      ...(badge ? { badge } : {}),
      ...(details.blocks.length ? { texts: details.blocks } : {}),
    },
  };
}

export function sizeContainer(node: ModelNode, children: Sized[], placed: { placed: { id: string; rect: Rect }[]; size: Size }, hidden: number, outline: boolean, style: LayoutStyle): Sized {
  const hd = containerHeader(node, hidden, outline, style);
  const { frame, pad, header } = hd;
  const innerW = placed.size.w;
  const innerH = placed.size.h;
  const w = Math.ceil(Math.max(innerW + pad * 2, hd.minWidth));
  const h = Math.ceil(header + innerH + pad * (frame === 'none' ? 1 : 2));
  const inner: Rect = { x: outline ? pad : (w - innerW) / 2, y: header + (frame === 'none' ? 4 : style.containerPad), w: innerW, h: innerH };
  const byId = new Map(placed.placed.map((p) => [p.id, p.rect]));
  const childPlacements: Placement[] = children.map((c) => {
    const r = byId.get(c.id)!;
    return { sized: c, rect: { x: inner.x + r.x, y: inner.y + r.y, w: r.w, h: r.h } };
  });
  const box: Sized['box'] = { id: node.id, kind: 'container', depth: node.depth, node, shape: node.shape, frame, iconOnly: false, w, h, ...hd.parts, inner };
  return { id: node.id, size: { w, h }, children: childPlacements, box };
}

/** Visio shapes for the sequence, flow, and story decorations. */
import type { Extra, TextBlock } from '@vantage/layout';
import { familyOf, type Theme } from '@vantage/render';
import { mix } from './common.ts';
import { connector, shape2d, type ShapeText } from './vsdx-shapes.ts';

function run(t: TextBlock, color: string, inset: { x: number; y: number }): ShapeText {
  const left = t.anchor === 'start';
  return { runs: [{ text: t.lines.join('\n'), color, sizePx: t.size, bold: t.weight !== 'regular' }], align: left ? 'left' : 'center', vertical: 'top', ...(left ? { leftPx: t.x - inset.x } : {}), topPx: Math.max(0, t.y - inset.y - 2) };
}

/** Free text has no rect in the layout; estimate one from the longest line. */
function textRect(t: TextBlock): { x: number; y: number; w: number; h: number } {
  const longest = Math.max(1, ...t.lines.map((l) => l.length));
  const w = Math.ceil(longest * t.size * 0.58) + 8;
  const h = Math.ceil(t.lines.length * t.lineHeight) + 4;
  return t.anchor === 'middle' ? { x: t.x - w / 2, y: t.y, w, h } : { x: t.x, y: t.y, w, h };
}

/** Shapes for one extra, numbered from `id` upward. */
export function vsdxExtra(e: Extra, id: number, pageH: number, theme: Theme): string[] {
  switch (e.kind) {
    case 'panel':
      return [shape2d(id, e.rect, pageH, { fill: theme.containerFills[0]!, stroke: theme.containerStroke, strokeWidth: 1, rounding: 12 })];
    case 'lane': {
      const i = Number(e.id.split('-')[1] ?? 0);
      return [shape2d(id, e.rect, pageH, { fill: i % 2 ? theme.laneAlt : theme.lane, stroke: theme.containerStroke, strokeWidth: 1 }, run(e.title, theme.containerTitle, { x: 0, y: 0 }))];
    }
    case 'highlight': {
      const fam = familyOf(theme, e.color);
      const alpha = e.style === 'band' ? 0.55 : 0.35;
      const style = e.style === 'frame'
        ? { stroke: fam.stroke, strokeWidth: 1.75, rounding: 10 }
        : { fill: mix(fam.fill, theme.canvas, alpha), stroke: fam.stroke, strokeWidth: 1, pattern: 2, rounding: 10 };
      return [shape2d(id, e.rect, pageH, style, e.label ? run(e.label, fam.stroke, e.rect) : undefined)];
    }
    case 'note':
      return [shape2d(id, e.rect, pageH, { fill: theme.families.amber.fill, stroke: theme.families.amber.stroke, strokeWidth: 1 }, run(e.text, theme.families.amber.text, { x: 0, y: 0 }))];
    case 'text': {
      const color = e.color ? familyOf(theme, e.color).stroke : e.role === 'heading' || e.role === 'axis' ? theme.containerTitle : e.role === 'caption' ? theme.muted : theme.ink;
      const r = textRect(e.text);
      return [shape2d(id, r, pageH, {}, { runs: [{ text: e.text.lines.join('\n'), color, sizePx: e.text.size, bold: e.text.weight !== 'regular' }], align: e.text.anchor === 'middle' ? 'center' : 'left', vertical: 'top', leftPx: 0, topPx: 0 })];
    }
    case 'badge': {
      const fam = familyOf(theme, e.color);
      const r = e.text.length > 2 ? 12 : 10;
      return [shape2d(id, { x: e.at.x - r, y: e.at.y - r, w: r * 2, h: r * 2 }, pageH, { fill: theme.canvas, stroke: fam.stroke, strokeWidth: 1.75, shape: 'ellipse' }, { runs: [{ text: e.text, color: fam.stroke, sizePx: 10.5, bold: true }], align: 'center', vertical: 'middle' })];
    }
    case 'legend': {
      const runs = e.items.map((it) => ({ text: `${it.swatch === 'arrow' ? '→' : '□'} ${it.label}`, color: it.color === 'edge' ? theme.edge : familyOf(theme, it.color).stroke, sizePx: 10.5, bold: false }));
      return [shape2d(id, e.rect, pageH, { fill: theme.containerFills[0]!, stroke: theme.containerStroke, strokeWidth: 1, rounding: 6 }, { runs, align: 'left', vertical: 'top', leftPx: 8, topPx: 4 })];
    }
    case 'line':
      return [connector(id, [e.from, e.to], pageH, { stroke: e.style === 'divider' ? theme.containerStroke : theme.muted, strokeWidth: e.style === 'divider' ? 1.5 : 1, pattern: e.style === 'divider' ? 2 : 1, endArrow: 0, beginArrow: 0 })];
    case 'lifeline':
      return [connector(id, [{ x: e.x, y: e.y0 }, { x: e.x, y: e.y1 }], pageH, { stroke: theme.edgeMuted, strokeWidth: 1, pattern: 2, endArrow: 0, beginArrow: 0 })];
    case 'activation':
      return [shape2d(id, e.rect, pageH, { fill: theme.families.blue.fill, stroke: theme.families.blue.stroke, strokeWidth: 1 })];
    case 'fragment': {
      const out = [shape2d(id, e.rect, pageH, { stroke: theme.muted, strokeWidth: 1 }, { runs: [{ text: `${e.op} [${e.condition}]`, color: theme.ink, sizePx: 11, bold: true }], align: 'left', vertical: 'top', leftPx: 8, topPx: 2 })];
      e.dividers.forEach((y, i) => out.push(connector(id + 1 + i, [{ x: e.rect.x, y }, { x: e.rect.x + e.rect.w, y }], pageH, { stroke: theme.muted, strokeWidth: 1, pattern: 2, endArrow: 0, beginArrow: 0 }, { lines: ['[else]'], size: 11 }, theme.muted)));
      return out;
    }
    case 'message': {
      const points = e.selfCall ? [e.from, { x: e.from.x + 28, y: e.from.y }, { x: e.from.x + 28, y: e.to.y }, e.to] : [e.from, e.to];
      return [connector(id, points, pageH, { stroke: theme.edge, strokeWidth: 1.5, pattern: e.style === 'sync' ? 1 : 2, endArrow: e.style === 'sync' ? 4 : 13, beginArrow: 0 }, e.label, theme.ink)];
    }
  }
}

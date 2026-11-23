/** draw.io cells for the sequence, flow, and story decorations. */
import type { Extra, TextBlock } from '@vantage/layout';
import type { Point, Rect } from '@vantage/layout';
import { familyOf, type Theme } from '@vantage/render';
import { xmlEsc, num } from './common.ts';
import { htmlText, styleString, type Style } from './drawio-style.ts';

export function vertex(id: string, value: string, style: Style, r: Rect, parent = '1'): string {
  return `<mxCell id="${xmlEsc(id)}" value="${xmlEsc(value)}" style="${xmlEsc(styleString(style))}" vertex="1" parent="${xmlEsc(parent)}"><mxGeometry x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}" as="geometry"/></mxCell>`;
}

/** An edge with its own end points, for lines that connect nothing. */
export function freeEdge(id: string, value: string, style: Style, from: Point, to: Point, points: readonly Point[] = []): string {
  const pts = points.length ? `<Array as="points">${points.map((p) => `<mxPoint x="${num(p.x)}" y="${num(p.y)}"/>`).join('')}</Array>` : '';
  return `<mxCell id="${xmlEsc(id)}" value="${xmlEsc(value)}" style="${xmlEsc(styleString(style))}" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${num(from.x)}" y="${num(from.y)}" as="sourcePoint"/><mxPoint x="${num(to.x)}" y="${num(to.y)}" as="targetPoint"/>${pts}</mxGeometry></mxCell>`;
}

function lines(t: TextBlock): string {
  return t.lines.map(htmlText).join('<br>');
}

/** A text block as a cell; width is estimated from the longest line because the layout stores no width for free text. */
function textRect(t: TextBlock): Rect {
  const longest = Math.max(1, ...t.lines.map((l) => l.length));
  const w = Math.ceil(longest * t.size * 0.58) + 8;
  const h = Math.ceil(t.lines.length * t.lineHeight) + 4;
  return t.anchor === 'middle' ? { x: t.x - w / 2, y: t.y, w, h } : { x: t.x, y: t.y, w, h };
}

const plainText = (t: TextBlock, color: string): Style => ({
  text: '', html: 1, whiteSpace: 'wrap', align: t.anchor === 'middle' ? 'center' : 'left', verticalAlign: 'top', fontSize: t.size, fontStyle: t.weight === 'regular' ? 0 : 1, fontColor: color, strokeColor: 'none', fillColor: 'none', spacing: 0, spacingTop: 0, spacingLeft: 0,
});

export function extraCells(e: Extra, theme: Theme): string[] {
  const id = `x-${e.kind}-${e.id}`;
  switch (e.kind) {
    case 'panel':
      return [vertex(id, '', { rounded: 1, absoluteArcSize: 1, arcSize: 24, fillColor: theme.containerFills[0]!, strokeColor: theme.containerStroke }, e.rect)];
    case 'lane': {
      const i = Number(e.id.split('-')[1] ?? 0);
      return [vertex(id, lines(e.title), { rounded: 0, html: 1, whiteSpace: 'wrap', fillColor: i % 2 ? theme.laneAlt : theme.lane, strokeColor: theme.containerStroke, fontColor: theme.containerTitle, fontSize: e.title.size, fontStyle: 1, align: 'left', verticalAlign: 'top', spacingLeft: Math.round(e.title.x), spacingTop: Math.max(0, Math.round(e.title.y - 4)) }, e.rect)];
    }
    case 'highlight': {
      const fam = familyOf(theme, e.color);
      const style: Style = {
        rounded: 1, absoluteArcSize: 1, arcSize: 20, html: 1, whiteSpace: 'wrap',
        fillColor: e.style === 'frame' ? 'none' : fam.fill, opacity: e.style === 'band' ? 55 : e.style === 'tint' ? 35 : 100,
        strokeColor: fam.stroke, strokeWidth: e.style === 'frame' ? 1.75 : 1, fontColor: fam.stroke, align: 'left', verticalAlign: 'top',
        ...(e.style === 'frame' ? {} : { dashed: 1, dashPattern: '5 4' }),
        ...(e.label ? { fontSize: e.label.size, fontStyle: 1, spacingLeft: Math.round(e.label.x - e.rect.x), spacingTop: Math.max(0, Math.round(e.label.y - e.rect.y - 4)) } : {}),
      };
      return [vertex(id, e.label ? lines(e.label) : '', style, e.rect)];
    }
    case 'note':
      return [vertex(id, lines(e.text), { shape: 'note', size: 8, html: 1, whiteSpace: 'wrap', fillColor: theme.families.amber.fill, strokeColor: theme.families.amber.stroke, fontColor: theme.families.amber.text, fontSize: e.text.size, align: 'left', verticalAlign: 'top', spacingLeft: Math.round(e.text.x), spacingTop: Math.max(0, Math.round(e.text.y - 4)) }, e.rect)];
    case 'text': {
      const color = e.color ? familyOf(theme, e.color).stroke : e.role === 'heading' || e.role === 'axis' ? theme.containerTitle : e.role === 'caption' ? theme.muted : theme.ink;
      return [vertex(id, lines(e.text), plainText(e.text, color), textRect(e.text))];
    }
    case 'badge': {
      const fam = familyOf(theme, e.color);
      const r = e.text.length > 2 ? 12 : 10;
      return [vertex(id, htmlText(e.text), { ellipse: '', html: 1, fillColor: theme.canvas, strokeColor: fam.stroke, strokeWidth: 1.75, fontColor: fam.stroke, fontSize: 10.5, fontStyle: 1 }, { x: e.at.x - r, y: e.at.y - r, w: r * 2, h: r * 2 })];
    }
    case 'legend': {
      const items = e.items.map((it) => `<font color="${it.color === 'edge' ? theme.edge : familyOf(theme, it.color).stroke}">${it.swatch === 'arrow' ? '&#8594;' : '&#9633;'}</font> ${htmlText(it.label)}`).join('<br>');
      return [vertex(id, items, { rounded: 1, absoluteArcSize: 1, arcSize: 12, html: 1, whiteSpace: 'wrap', fillColor: theme.containerFills[0]!, strokeColor: theme.containerStroke, fontColor: theme.ink, fontSize: 10.5, align: 'left', verticalAlign: 'top', spacingLeft: 8, spacingTop: 4 }, e.rect)];
    }
    case 'line':
      return [freeEdge(id, '', { endArrow: 'none', html: 1, strokeColor: e.style === 'divider' ? theme.containerStroke : theme.muted, strokeWidth: e.style === 'divider' ? 1.5 : 1, ...(e.style === 'divider' ? { dashed: 1, dashPattern: '6 5' } : {}) }, e.from, e.to)];
    case 'lifeline':
      return [freeEdge(id, '', { endArrow: 'none', html: 1, strokeColor: theme.edgeMuted, strokeWidth: 1, dashed: 1, dashPattern: '4 4' }, { x: e.x, y: e.y0 }, { x: e.x, y: e.y1 })];
    case 'activation':
      return [vertex(id, '', { rounded: 0, fillColor: theme.families.blue.fill, strokeColor: theme.families.blue.stroke }, e.rect)];
    case 'fragment': {
      const cells = [vertex(id, `<b>${htmlText(e.op)}</b> [${htmlText(e.condition)}]`, { rounded: 0, html: 1, whiteSpace: 'wrap', fillColor: 'none', strokeColor: theme.muted, fontColor: theme.ink, fontSize: 11, align: 'left', verticalAlign: 'top', spacingLeft: 8, spacingTop: 2 }, e.rect)];
      e.dividers.forEach((y, i) => cells.push(freeEdge(`${id}-div-${i}`, '[else]', { endArrow: 'none', html: 1, strokeColor: theme.muted, dashed: 1, dashPattern: '5 3', fontColor: theme.muted, fontSize: 11, align: 'left' }, { x: e.rect.x, y }, { x: e.rect.x + e.rect.w, y })));
      return cells;
    }
    case 'message': {
      const dash = e.style === 'reply' ? '5 4' : e.style === 'async' ? '7 3' : undefined;
      const style: Style = { html: 1, strokeColor: theme.edge, strokeWidth: 1.5, endArrow: e.style === 'sync' ? 'block' : 'open', endFill: e.style === 'sync' ? 1 : 0, fontColor: theme.ink, fontSize: e.label.size, ...(dash ? { dashed: 1, dashPattern: dash } : {}), ...(e.selfCall ? { edgeStyle: 'orthogonalEdgeStyle' } : {}) };
      const points = e.selfCall ? [{ x: e.from.x + 28, y: e.from.y }, { x: e.from.x + 28, y: e.to.y }] : [];
      return [freeEdge(id, lines(e.label), style, e.from, e.to, points)];
    }
  }
}

/** Sequence and flow view decorations: lifelines, activations, fragments, notes, lanes, messages. */
import type { Extra, TextBlock } from '@vantage/layout';
import { familyOf, type Theme } from './theme.ts';
import { esc, EDGE_STYLE } from './svg.ts';
import { RULES } from '@vantage/layout/core';

const BADGE_HIT = RULES.badgeHit;

const r2 = (n: number): string => String(Math.round(n * 100) / 100);

function text(t: TextBlock, color: string, ox = 0, oy = 0): string {
  const anchor = t.anchor === 'middle' ? ' text-anchor="middle"' : '';
  const lines = t.lines.map((line, i) => `<tspan x="${r2(ox + t.x)}" dy="${i === 0 ? r2(t.size * 0.95) : r2(t.lineHeight)}">${esc(line)}</tspan>`).join('');
  return `<text y="${r2(oy + t.y)}" font-size="${t.size}" font-weight="${t.weight === 'semibold' ? 600 : t.weight === 'medium' ? 500 : 400}" fill="${color}"${anchor}>${lines}</text>`;
}

export function renderExtras(extras: readonly Extra[], theme: Theme): string {
  const out: string[] = [];
  for (const e of extras) {
    switch (e.kind) {
      case 'lane': {
        const i = Number(e.id.split('-')[1] ?? 0);
        out.push(`<g class="v-lane" data-id="${esc(e.id)}"><rect x="${r2(e.rect.x)}" y="${r2(e.rect.y)}" width="${r2(e.rect.w)}" height="${r2(e.rect.h)}" fill="${i % 2 ? theme.laneAlt : theme.lane}" stroke="${theme.containerStroke}" stroke-width="1"/>${text(e.title, theme.containerTitle, e.rect.x, e.rect.y)}</g>`);
        break;
      }
      case 'lifeline':
        out.push(`<line class="v-lifeline" data-id="${esc(e.id)}" x1="${r2(e.x)}" y1="${r2(e.y0)}" x2="${r2(e.x)}" y2="${r2(e.y1)}" stroke="${theme.edgeMuted}" stroke-width="1" stroke-dasharray="4 4"/>`);
        break;
      case 'activation':
        out.push(`<rect class="v-activation" data-id="${esc(e.id)}" x="${r2(e.rect.x)}" y="${r2(e.rect.y)}" width="${r2(e.rect.w)}" height="${r2(e.rect.h)}" fill="${theme.families.blue.fill}" stroke="${theme.families.blue.stroke}" stroke-width="1"/>`);
        break;
      case 'fragment': {
        const tag = `${e.op}`;
        const tagW = tag.length * 7 + 18;
        out.push(
          `<g class="v-fragment" data-id="${esc(e.id)}"><rect x="${r2(e.rect.x)}" y="${r2(e.rect.y)}" width="${r2(e.rect.w)}" height="${r2(e.rect.h)}" fill="none" stroke="${theme.muted}" stroke-width="1"/>` +
            `<path d="M${r2(e.rect.x)} ${r2(e.rect.y)}H${r2(e.rect.x + tagW)}V${r2(e.rect.y + 14)}L${r2(e.rect.x + tagW - 6)} ${r2(e.rect.y + 20)}H${r2(e.rect.x)}Z" fill="${theme.containerFills[2]}" stroke="${theme.muted}" stroke-width="1"/>` +
            `<text x="${r2(e.rect.x + 8)}" y="${r2(e.rect.y + 14)}" font-size="11" font-weight="600" fill="${theme.ink}">${esc(tag)}</text>` +
            `<rect x="${r2(e.rect.x + tagW + 4)}" y="${r2(e.rect.y + 2)}" width="${r2(e.condition.length * 6.2 + 16)}" height="18" fill="${theme.canvas}" opacity="0.9"/>` +
            `<text x="${r2(e.rect.x + tagW + 8)}" y="${r2(e.rect.y + 14)}" font-size="11" fill="${theme.muted}">[${esc(e.condition)}]</text>` +
            e.dividers.map((y) => `<line x1="${r2(e.rect.x)}" y1="${r2(y)}" x2="${r2(e.rect.x + e.rect.w)}" y2="${r2(y)}" stroke="${theme.muted}" stroke-width="1" stroke-dasharray="5 3"/><text x="${r2(e.rect.x + 8)}" y="${r2(y + 14)}" font-size="11" fill="${theme.muted}">[else]</text>`).join('') +
            `</g>`,
        );
        break;
      }
      case 'note':
        out.push(`<g class="v-note" data-id="${esc(e.id)}"><path d="M${r2(e.rect.x)} ${r2(e.rect.y)}H${r2(e.rect.x + e.rect.w - 8)}L${r2(e.rect.x + e.rect.w)} ${r2(e.rect.y + 8)}V${r2(e.rect.y + e.rect.h)}H${r2(e.rect.x)}Z" fill="${theme.families.amber.fill}" stroke="${theme.families.amber.stroke}" stroke-width="1"/>${text(e.text, theme.families.amber.text, e.rect.x, e.rect.y)}</g>`);
        break;
      case 'message': {
        const dash = e.style === 'reply' ? ' stroke-dasharray="5 4"' : e.style === 'async' ? ' stroke-dasharray="7 3"' : '';
        const marker = e.style === 'sync' ? 'arrow' : 'arrow-open';
        const d = e.selfCall
          ? `M${r2(e.from.x)} ${r2(e.from.y)}H${r2(e.from.x + 28)}V${r2(e.to.y)}H${r2(e.to.x)}`
          : `M${r2(e.from.x)} ${r2(e.from.y)}L${r2(e.to.x)} ${r2(e.to.y)}`;
        out.push(`<g class="v-message" data-id="${esc(e.id)}"><path d="${d}" fill="none" stroke="transparent" stroke-width="12"/><path d="${d}" fill="none" stroke="${theme.edge}" stroke-width="1.5"${dash} marker-end="url(#${marker})"/>${text(e.label, theme.ink)}</g>`);
        break;
      }
    }
  }
  return out.join('');
}

/** Story decorations: highlights, badges, headings and prose, legend, dividers and leaders, page panels. */
export function renderStoryExtras(extras: readonly Extra[], theme: Theme): string {
  const out: string[] = [];
  for (const e of extras) {
    switch (e.kind) {
      case 'highlight': {
        const fam = familyOf(theme, e.color);
        const fill = e.style === 'frame' ? 'none' : fam.fill;
        const op = e.style === 'band' ? ' fill-opacity="0.55"' : e.style === 'tint' ? ' fill-opacity="0.35"' : '';
        out.push(`<g class="v-highlight" data-id="${esc(e.id)}"><rect x="${r2(e.rect.x)}" y="${r2(e.rect.y)}" width="${r2(e.rect.w)}" height="${r2(e.rect.h)}" rx="10" fill="${fill}"${op} stroke="${fam.stroke}" stroke-width="${e.style === 'frame' ? 1.75 : 1}"${e.style === 'frame' ? '' : ' stroke-dasharray="5 4"'}/>${e.label ? text(e.label, fam.stroke) : ''}</g>`);
        break;
      }
      case 'badge': {
        const fam = familyOf(theme, e.color);
        const r = e.text.length > 2 ? 12 : 10;
        // A square of clear hit area around the badge, so a finger can take it at a phone's zoom.
        out.push(`<g class="v-badge-step" data-id="${esc(e.id)}"><rect x="${r2(e.at.x - BADGE_HIT / 2)}" y="${r2(e.at.y - BADGE_HIT / 2)}" width="${BADGE_HIT}" height="${BADGE_HIT}" fill="transparent"/><circle cx="${r2(e.at.x)}" cy="${r2(e.at.y)}" r="${r}" fill="${theme.canvas}" stroke="${fam.stroke}" stroke-width="1.75"/><text x="${r2(e.at.x)}" y="${r2(e.at.y + 3.6)}" font-size="10.5" font-weight="600" text-anchor="middle" fill="${fam.stroke}">${esc(e.text)}</text></g>`);
        break;
      }
      case 'text': {
        const color = e.color ? familyOf(theme, e.color).stroke : e.role === 'heading' ? theme.containerTitle : e.role === 'axis' ? theme.containerTitle : e.role === 'caption' ? theme.muted : theme.ink;
        out.push(`<g class="v-text v-${e.role}" data-id="${esc(e.id)}">${text(e.text, color)}</g>`);
        break;
      }
      case 'legend': {
        // The layout chose the columns that fit the view; a narrow view stacks the items.
        const cols = Math.max(1, e.cols);
        const colW = (e.rect.w - 16) / cols;
        const rows = e.items.map((it, i) => {
          const x = e.rect.x + 8 + (i % cols) * colW, y = e.rect.y + 8 + Math.floor(i / cols) * 20 + 10;
          const color = it.color === 'edge' ? theme.edge : familyOf(theme, it.color).stroke;
          const dash = it.edgeKind ? EDGE_STYLE[it.edgeKind].dash : undefined;
          const swatch = it.swatch === 'arrow'
            ? `<line x1="${r2(x)}" y1="${r2(y)}" x2="${r2(x + 28)}" y2="${r2(y)}" stroke="${color}" stroke-width="1.5"${dash ? ` stroke-dasharray="${dash}"` : ''} marker-end="url(#arrow-legend-${i})"/><defs><marker id="arrow-legend-${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1L9 5L1 9Z" fill="${color}"/></marker></defs>`
            : `<rect x="${r2(x)}" y="${r2(y - 6)}" width="28" height="12" rx="3" fill="none" stroke="${color}" stroke-width="1.5"/>`;
          return `${swatch}<text x="${r2(x + 36)}" y="${r2(y + 3.5)}" font-size="10.5" fill="${theme.ink}">${esc(it.label)}</text>`;
        });
        out.push(`<g class="v-legend" data-id="${esc(e.id)}"><rect x="${r2(e.rect.x)}" y="${r2(e.rect.y)}" width="${r2(e.rect.w)}" height="${r2(e.rect.h)}" rx="6" fill="${theme.containerFills[0]}" stroke="${theme.containerStroke}" stroke-width="1"/>${rows.join('')}</g>`);
        break;
      }
      case 'line': {
        const dash = e.style === 'divider' ? ' stroke-dasharray="6 5"' : '';
        const color = e.style === 'divider' ? theme.containerStroke : theme.muted;
        out.push(`<line class="v-line v-${e.style}" data-id="${esc(e.id)}" x1="${r2(e.from.x)}" y1="${r2(e.from.y)}" x2="${r2(e.to.x)}" y2="${r2(e.to.y)}" stroke="${color}" stroke-width="${e.style === 'divider' ? 1.5 : 1}"${dash}/>`);
        break;
      }
      case 'panel':
        out.push(`<rect class="v-panel" data-id="${esc(e.id)}" x="${r2(e.rect.x)}" y="${r2(e.rect.y)}" width="${r2(e.rect.w)}" height="${r2(e.rect.h)}" rx="12" fill="${theme.containerFills[0]}" stroke="${theme.containerStroke}" stroke-width="1"/>`);
        break;
      case 'note':
        out.push(`<g class="v-note" data-id="${esc(e.id)}"><path d="M${r2(e.rect.x)} ${r2(e.rect.y)}H${r2(e.rect.x + e.rect.w - 8)}L${r2(e.rect.x + e.rect.w)} ${r2(e.rect.y + 8)}V${r2(e.rect.y + e.rect.h)}H${r2(e.rect.x)}Z" fill="${theme.families.amber.fill}" stroke="${theme.families.amber.stroke}" stroke-width="1"/>${text(e.text, theme.families.amber.text, e.rect.x, e.rect.y)}</g>`);
        break;
      default:
        break;
    }
  }
  return out.join('');
}

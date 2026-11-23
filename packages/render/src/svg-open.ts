/**
 * The open item badge: a count on a bound box's top right corner, colored
 * by the worst severity open against it, dimmed when every item is stale.
 * Drawn inside the box's group, so it moves with the box.
 */
import { DEFAULT_STYLE, type LayoutBox } from '@vantage/layout/core';
import { worstSeverity } from '@vantage/model/open';
import type { Theme } from './theme.ts';
import { esc } from './svg.ts';

const r2 = (n: number): string => String(Math.round(n * 100) / 100);

/** Width of the count badge a box already carries on its corner, so the open badge sits beside it. */
function countBadgeWidth(label: string): number {
  return label.length * 6.4 + 14;
}

/** The badge for a box, in the box's own coordinates, or nothing when nothing is open against it. */
export function openBadge(b: LayoutBox, theme: Theme): string {
  const items = b.node.openItems ?? [];
  const worst = worstSeverity(items);
  if (worst === undefined) return '';
  const r = DEFAULT_STYLE.openBadgeRadius;
  const label = items.length > 99 ? '99+' : String(items.length);
  const w = Math.max(r * 2, label.length * DEFAULT_STYLE.openBadgeText * 0.62 + 8);
  // A leaf's count badge sits outside its top right corner and a container's inside it; the open badge goes to its left.
  const right = b.badge === undefined ? b.w + r * 0.4 : b.kind === 'container' ? b.w - 14 - countBadgeWidth(b.badge) : b.w + 2 - countBadgeWidth(b.badge);
  const cy = -r * 0.4;
  const stale = items.every((i) => i.stale) ? ' v-open-stale' : '';
  const kinds = new Set(items.map((i) => i.kind));
  const title = `${items.length} open (${[...kinds].join(', ')}), worst ${worst}`;
  return `<g class="v-open${stale}" data-open="${items.length}" data-severity="${worst}"><title>${esc(title)}</title>` +
    `<rect x="${r2(right - w)}" y="${r2(cy - r)}" width="${r2(w)}" height="${r * 2}" rx="${r}" fill="${theme.open[worst]}" stroke="${theme.canvas}" stroke-width="1.5"/>` +
    `<text x="${r2(right - w / 2)}" y="${r2(cy + DEFAULT_STYLE.openBadgeText * 0.36)}" font-size="${DEFAULT_STYLE.openBadgeText}" font-weight="700" text-anchor="middle" fill="${theme.openText}">${label}</text></g>`;
}

/** Puts the badge inside a box group's closing tag. */
export function withOpenBadge(group: string, b: LayoutBox, theme: Theme): string {
  const badge = openBadge(b, theme);
  return badge ? `${group.slice(0, -'</g>'.length)}${badge}</g>` : group;
}

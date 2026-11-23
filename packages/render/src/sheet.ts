/** A contact sheet: several rendered views side by side, each captioned, in one SVG. Used to compare layout candidates. */
import { esc } from './svg.ts';
import { THEMES, type ThemeName } from './theme.ts';

export interface SheetItem {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly caption: string;
}

export function contactSheet(items: readonly SheetItem[], opts: { theme?: ThemeName; columns?: number; fontCss?: string } = {}): string {
  const theme = THEMES[opts.theme ?? 'light'];
  const cols = opts.columns ?? Math.min(2, items.length);
  const pad = 24, cap = 30;
  const cellW = Math.max(...items.map((i) => i.width));
  const rows: number[] = [];
  items.forEach((it, i) => {
    const r = Math.floor(i / cols);
    rows[r] = Math.max(rows[r] ?? 0, it.height);
  });
  const width = pad + cols * (cellW + pad);
  const height = pad + rows.reduce((a, h) => a + h + cap + pad, 0);
  const parts: string[] = [];
  let y = pad;
  items.forEach((it, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    if (c === 0 && i > 0) y += rows[r - 1]! + cap + pad;
    const x = pad + c * (cellW + pad);
    const inner = it.svg.replace(/<svg /, `<svg x="${x}" y="${y + cap}" `).replace(/<\/svg>\s*$/, '</svg>');
    parts.push(`<rect x="${x - 6}" y="${y + cap - 6}" width="${it.width + 12}" height="${it.height + 12}" rx="8" fill="${theme.containerFills[0]}" stroke="${theme.containerStroke}"/>`);
    parts.push(`<text x="${x}" y="${y + 18}" font-size="14" font-weight="600" fill="${theme.ink}">${esc(it.caption)}</text>`);
    parts.push(inner);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${opts.fontCss ?? ''}text{font-family:${theme.fontFamily};}</style><rect width="${width}" height="${height}" fill="${theme.canvas}"/>${parts.join('')}</svg>`;
}

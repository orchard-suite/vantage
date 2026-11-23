/** Shared pieces of the export formats: XML escaping, number formatting, and the page inputs. */
import type { Layout } from '@vantage/layout';
import type { TitleBlock } from '@vantage/render';

export type ExportTheme = 'light' | 'dark' | 'print' | 'colorblind';

/** One page of a multi-view export: a laid out view and the header it carries. */
export interface ExportPage {
  readonly layout: Layout;
  readonly titleBlock?: TitleBlock;
}

export function xmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Numbers with at most four decimals and no trailing zeros, for tidy XML. */
export function num(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}

/** Pixels to inches at the 96 dpi the layout assumes. */
export function inches(px: number): number {
  return px / 96;
}

/** Hex color with alpha mixed against a background, for formats without opacity. */
export function mix(fg: string, bg: string, alpha: number): string {
  const p = (h: string): [number, number, number] => {
    const f = h.replace('#', '');
    const full = f.length === 3 ? f.split('').map((c) => c + c).join('') : f.slice(0, 6);
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const a = p(fg), b = p(bg);
  const c = a.map((v, i) => Math.round(v * alpha + b[i]! * (1 - alpha)));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

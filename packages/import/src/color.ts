/**
 * Foreign colors to our palette families by hue. A fill whose hue sits
 * near a family's hue takes the family name; one that sits far from every
 * family keeps its exact hex beside the nearest family, so the picture
 * keeps its look and the author still gets a palette word to edit.
 */

export type Family = 'slate' | 'blue' | 'violet' | 'emerald' | 'amber' | 'red' | 'teal' | 'pink';

/** Hue of each family's stroke in the light theme (packages/render/src/theme.ts). */
const FAMILY_HUES: readonly { readonly family: Exclude<Family, 'slate'>; readonly hue: number }[] = [
  { family: 'red', hue: 0 },
  { family: 'amber', hue: 36 },
  { family: 'emerald', hue: 153 },
  { family: 'teal', hue: 180 },
  { family: 'blue', hue: 221 },
  { family: 'violet', hue: 256 },
  { family: 'pink', hue: 329 },
];

/** Hue distance beyond which the exact hex is kept. */
const FAR = 24;
const GREY_SATURATION = 0.12;

export interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

export function parseHex(color: string): { r: number; g: number; b: number } | undefined {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color.trim());
  if (!m) return undefined;
  const hex = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!;
  const n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHsl(color: string): Hsl | undefined {
  const rgb = parseHex(color);
  if (!rgb) return undefined;
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: ((h * 60) + 360) % 360, s, l };
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export interface ColorMatch {
  readonly family: Family;
  /** The exact hex to keep in style.fill when the family is only an approximation. */
  readonly exact?: string;
}

/** White, black, and unset colors mean "no color": the type's default stands. */
export function isNeutral(color: string | undefined): boolean {
  if (!color || color === 'none' || color === 'default') return true;
  const hsl = toHsl(color);
  return !hsl || hsl.l > 0.97 || hsl.l < 0.08;
}

export function matchFamily(color: string): ColorMatch | undefined {
  const hsl = toHsl(color);
  if (!hsl || isNeutral(color)) return undefined;
  const hex = normalizeHex(color);
  if (hsl.s < GREY_SATURATION) return hsl.l > 0.6 ? { family: 'slate' } : { family: 'slate', exact: hex };
  let best = FAMILY_HUES[0]!, bestD = Infinity;
  for (const f of FAMILY_HUES) {
    const d = hueDistance(hsl.h, f.hue);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return bestD > FAR ? { family: best.family, exact: hex } : { family: best.family };
}

export function normalizeHex(color: string): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  return `#${[rgb.r, rgb.g, rgb.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

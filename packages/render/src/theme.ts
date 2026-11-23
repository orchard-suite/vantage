/**
 * The picture's visual system. Eight color families, each with a fill, a
 * stroke, and a text color, tuned for light and dark. Containers tint by
 * depth so nesting reads at a glance; leaves carry the family color. The
 * neutrals come from the shared tokens, so the picture and the chrome
 * around it are one surface.
 */
import type { ItemSeverity } from '@vantage/model/open';
import { DARK, FONT, LIGHT } from './tokens.ts';

export type ColorFamily = 'slate' | 'blue' | 'violet' | 'emerald' | 'amber' | 'red' | 'teal' | 'pink';

export interface FamilyColors {
  readonly fill: string;
  readonly stroke: string;
  readonly text: string;
  readonly soft: string;
  readonly softStroke: string;
}

export interface Theme {
  readonly name: 'light' | 'dark' | 'print' | 'colorblind';
  readonly canvas: string;
  readonly ink: string;
  readonly muted: string;
  readonly edge: string;
  readonly edgeMuted: string;
  readonly labelHalo: string;
  readonly containerFills: readonly string[];
  readonly containerStroke: string;
  readonly containerTitle: string;
  readonly lane: string;
  readonly laneAlt: string;
  /** Stroke for the hovered or pinned box and edge in the viewer. */
  readonly hi: string;
  readonly families: Readonly<Record<ColorFamily, FamilyColors>>;
  /** The open item badge per worst severity, and the figure on it. */
  readonly open: Readonly<Record<ItemSeverity, string>>;
  readonly openText: string;
  readonly fontFamily: string;
}

const light: Theme = {
  name: 'light',
  canvas: LIGHT.bg,
  ink: LIGHT.ink,
  muted: LIGHT.muted,
  edge: '#4a4944',
  edgeMuted: '#bcb9b1',
  labelHalo: LIGHT.bg,
  containerFills: ['#fbfbfa', '#f0efeb', '#e8e7e2', '#e0dfd9', '#d8d6cf'],
  containerStroke: '#c7c4bc',
  containerTitle: '#2e2d29',
  lane: '#fbfbfa',
  laneAlt: '#efeeea',
  hi: LIGHT.hi,
  open: LIGHT.severity,
  openText: '#ffffff',
  fontFamily: FONT,
  families: {
    slate: { fill: '#eeedea', stroke: '#8a8982', text: '#2a2925', soft: '#f4f3f0', softStroke: '#c7c4bc' },
    blue: { fill: '#e8f0fe', stroke: '#3b6fd6', text: '#173a7a', soft: '#eef4ff', softStroke: '#a9c1f0' },
    violet: { fill: '#efe9fd', stroke: '#7c5cd6', text: '#3d2a7a', soft: '#f4f0fe', softStroke: '#c2b3ee' },
    emerald: { fill: '#e6f6ee', stroke: '#2f9e6a', text: '#155239', soft: '#edf9f3', softStroke: '#a6dcc1' },
    amber: { fill: '#fdf2df', stroke: '#d6912a', text: '#6b4410', soft: '#fff7e8', softStroke: '#efcf93' },
    red: { fill: '#fde9e9', stroke: '#d64545', text: '#7a1f1f', soft: '#fef1f1', softStroke: '#efb0b0' },
    teal: { fill: '#e3f5f5', stroke: '#2a9d9d', text: '#145252', soft: '#ecf9f9', softStroke: '#a2dada' },
    pink: { fill: '#fce9f3', stroke: '#d64a93', text: '#7a1f4f', soft: '#fdf1f7', softStroke: '#efb3d2' },
  },
};

const dark: Theme = {
  name: 'dark',
  canvas: DARK.bg,
  ink: DARK.ink,
  muted: DARK.muted,
  edge: '#c4c2bb',
  edgeMuted: '#4c4b47',
  labelHalo: DARK.bg,
  containerFills: ['#1e1e1d', '#252524', '#2c2c2a', '#333331', '#3a3a38'],
  containerStroke: '#45443f',
  containerTitle: '#dcdad3',
  lane: '#1b1b1a',
  laneAlt: '#212120',
  hi: DARK.hi,
  open: DARK.severity,
  openText: '#121211',
  fontFamily: FONT,
  families: {
    slate: { fill: '#2a2a28', stroke: '#8f8e86', text: '#ecebe6', soft: '#232322', softStroke: '#4c4b47' },
    blue: { fill: '#1b2a4a', stroke: '#6b9cf5', text: '#dbe7ff', soft: '#172238', softStroke: '#3b5998' },
    violet: { fill: '#2a2250', stroke: '#a68cf5', text: '#ece6ff', soft: '#221c40', softStroke: '#5e4ca8' },
    emerald: { fill: '#163626', stroke: '#4cc38a', text: '#dbf5e8', soft: '#132c20', softStroke: '#2f7a55' },
    amber: { fill: '#3d2d12', stroke: '#e5a84b', text: '#fdebcf', soft: '#312410', softStroke: '#8a6327' },
    red: { fill: '#3f1d1d', stroke: '#e86a6a', text: '#fde0e0', soft: '#331818', softStroke: '#8f3b3b' },
    teal: { fill: '#13343a', stroke: '#4cc3c3', text: '#dbf5f5', soft: '#102a2e', softStroke: '#2f7f7f' },
    pink: { fill: '#3d1a2e', stroke: '#e86aa8', text: '#fde0ee', soft: '#311525', softStroke: '#8f3b66' },
  },
};

/** White paper, strong strokes, no tinted canvas: for PDF and print. */
const print: Theme = {
  ...light,
  name: 'print',
  canvas: '#ffffff',
  labelHalo: '#ffffff',
  edge: '#1f1f1d',
  containerFills: ['#ffffff', '#fafafa', '#f4f4f5', '#eeeeef', '#e8e8ea'],
  containerStroke: '#9ca3af',
};

/** Okabe and Ito palette: eight hues that stay apart for every common color vision deficiency. */
const colorblind: Theme = {
  ...light,
  name: 'colorblind',
  open: { critical: '#b34a00', high: '#a35f00', medium: '#a8457d', low: '#0072b2', info: '#6b6a64' },
  families: {
    slate: light.families.slate,
    blue: { fill: '#e3effa', stroke: '#0072b2', text: '#0b3d63', soft: '#edf5fc', softStroke: '#8fbfe0' },
    violet: { fill: '#f1e6f3', stroke: '#cc79a7', text: '#5c2a4d', soft: '#f7eff8', softStroke: '#e3b8d3' },
    emerald: { fill: '#e2f3ee', stroke: '#009e73', text: '#064d3a', soft: '#ecf8f4', softStroke: '#8fd4bd' },
    amber: { fill: '#fdf1dc', stroke: '#e69f00', text: '#5f4000', soft: '#fff7e8', softStroke: '#f2cf80' },
    red: { fill: '#fbe6dc', stroke: '#d55e00', text: '#612a00', soft: '#fdf0e8', softStroke: '#ebaf80' },
    teal: { fill: '#e0f3fb', stroke: '#56b4e9', text: '#174a63', soft: '#ecf8fd', softStroke: '#a8d8f3' },
    pink: { fill: '#fdf6dc', stroke: '#f0e442', text: '#5a5300', soft: '#fefbe9', softStroke: '#f6ef9a' },
  },
};

export type ThemeName = 'light' | 'dark' | 'print' | 'colorblind';
export const THEMES: Record<ThemeName, Theme> = { light, dark, print, colorblind };

export function familyOf(theme: Theme, color: string): FamilyColors {
  const f = theme.families[color as ColorFamily];
  if (f) return f;
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return { fill: color, stroke: shade(color, -0.35), text: theme.ink, soft: color, softStroke: shade(color, -0.2) };
  return theme.families.slate;
}

function shade(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(v + (amount < 0 ? v * amount : (255 - v) * amount))));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * The design tokens: one palette for the chrome and the picture, in light
 * and dark, so the viewer, the hub pages, and the rendered SVG read as one
 * surface.
 *
 * The look is a drafting room. Stone neutrals instead of blue greys, so the
 * canvas reads as paper and the colored families stay the only hue in the
 * picture. One ink accent, a Prussian blue, used for the selected thing and
 * the primary action and nowhere else. Technical values (facts, counts,
 * eyebrows, keys) set in monospace, like the title block on a drawing.
 * Hairlines and soft shadows for depth; motion short and eased.
 *
 * Light and dark are each tuned by hand: dark is warm graphite, not an
 * inversion, and keeps the same family hues at higher luminance.
 */

export interface Surfaces {
  /** The canvas behind the picture and the page behind the hub. */
  readonly bg: string;
  /** Chrome: sidebar, header, dock, cards. */
  readonly panel: string;
  /** Floating things: the inspector, menus, the story card, dialogs. */
  readonly raise: string;
  /** Inputs and wells. */
  readonly sunken: string;
  /** The tray a miniature picture sits in: card thumbnails and list minis. Deeper than the page, so a picture's white boxes still read at a tenth of their size. */
  readonly well: string;
  readonly hover: string;
  readonly press: string;
  readonly ink: string;
  readonly ink2: string;
  readonly muted: string;
  readonly faint: string;
  readonly line: string;
  readonly line2: string;
  /** The plus marks on the canvas. */
  readonly grid: string;
  readonly accent: string;
  readonly accentHover: string;
  /** The accent as text on panel. */
  readonly accentInk: string;
  readonly accentSoft: string;
  readonly onAccent: string;
  /** The highlight stroke in the picture: hovered or pinned boxes and edges. */
  readonly hi: string;
  readonly warn: Tone;
  readonly bad: Tone;
  readonly ok: Tone;
  /** Resting depth for a bordered card or tile: a soft drop and no ring, since the card's own border draws its edge. */
  readonly lift: string;
  readonly shadow1: string;
  readonly shadow2: string;
  readonly shadow3: string;
  /** Scrim behind drawers and dialogs. */
  readonly scrim: string;
  /** Open item severities, worst first: the badge on a box and the dot beside an item in the panel. */
  readonly severity: Readonly<Record<'critical' | 'high' | 'medium' | 'low' | 'info', string>>;
}

export interface Tone {
  readonly bg: string;
  readonly ink: string;
  readonly line: string;
}

export const LIGHT: Surfaces = {
  bg: '#f4f3f0',
  panel: '#ffffff',
  raise: '#ffffff',
  sunken: '#f1f0ec',
  well: '#ebe9e4',
  hover: '#edece8',
  press: '#e5e3de',
  ink: '#1c1c1a',
  ink2: '#45443f',
  muted: '#5c5b54',
  faint: '#6b6963',
  line: '#e2dfd8',
  line2: '#cdcac2',
  grid: '#d7d5cf',
  accent: '#2b4f9c',
  accentHover: '#234283',
  accentInk: '#223f7d',
  accentSoft: '#e7ecf6',
  onAccent: '#ffffff',
  hi: '#2b4f9c',
  warn: { bg: '#fbf1dc', ink: '#5e4208', line: '#e8cf95' },
  bad: { bg: '#fbe7e4', ink: '#7f2218', line: '#efb3ab' },
  ok: { bg: '#e4f3ea', ink: '#1b5636', line: '#a8d8bb' },
  lift: '0 1px 2px rgba(28,28,26,.05), 0 1px 3px rgba(28,28,26,.04)',
  shadow1: '0 0 0 1px rgba(28,28,26,.06), 0 1px 2px rgba(28,28,26,.06)',
  shadow2: '0 0 0 1px rgba(28,28,26,.07), 0 2px 4px rgba(28,28,26,.05), 0 12px 32px rgba(28,28,26,.10)',
  shadow3: '0 0 0 1px rgba(28,28,26,.08), 0 4px 10px rgba(28,28,26,.08), 0 28px 64px rgba(28,28,26,.18)',
  scrim: 'rgba(28,28,26,.42)',
  severity: { critical: '#c62828', high: '#d35400', medium: '#a16207', low: '#2f5fbf', info: '#6b6a64' },
};

export const DARK: Surfaces = {
  bg: '#151514',
  panel: '#1c1c1b',
  raise: '#242423',
  sunken: '#121211',
  well: '#151514',
  hover: '#282827',
  press: '#30302e',
  ink: '#ecebe6',
  ink2: '#c8c6bf',
  muted: '#aba9a1',
  faint: '#8d8b83',
  line: '#2d2d2b',
  line2: '#41403d',
  grid: '#2c2c2a',
  accent: '#8fb0ee',
  accentHover: '#a6c1f3',
  accentInk: '#b7cbf5',
  accentSoft: '#222d45',
  onAccent: '#121211',
  hi: '#a9c4fa',
  warn: { bg: '#3a2d12', ink: '#f4dfb0', line: '#7a5d22' },
  bad: { bg: '#40201c', ink: '#f6c9c2', line: '#8a3f36' },
  ok: { bg: '#16331f', ink: '#bfe6cc', line: '#2f6b45' },
  lift: '0 1px 2px rgba(0,0,0,.35)',
  shadow1: '0 0 0 1px rgba(0,0,0,.5), 0 1px 2px rgba(0,0,0,.4)',
  shadow2: '0 0 0 1px rgba(0,0,0,.6), 0 2px 4px rgba(0,0,0,.4), 0 12px 32px rgba(0,0,0,.45)',
  shadow3: '0 0 0 1px rgba(0,0,0,.7), 0 4px 10px rgba(0,0,0,.5), 0 28px 64px rgba(0,0,0,.65)',
  scrim: 'rgba(0,0,0,.55)',
  severity: { critical: '#e5484d', high: '#ec6a2c', medium: '#d1971f', low: '#5b8def', info: '#8a8982' },
};

/** The path and family stroke colors the chrome reuses for chips, badges, and diff stories. */
export const PATH_COLORS = {
  light: { slate: '#8b95a5', blue: '#3b6fd6', violet: '#7c5cd6', emerald: '#2f9e6a', amber: '#d6912a', red: '#d64545', teal: '#2a9d9d', pink: '#d64a93' },
  dark: { slate: '#9aa3b2', blue: '#6b9cf5', violet: '#a68cf5', emerald: '#4cc38a', amber: '#e5a84b', red: '#e86a6a', teal: '#4cc3c3', pink: '#e86aa8' },
} as const;

/** Syntax colors for the YAML editor: keys, strings, numbers, true and false and null, comments, anchors, and punctuation. */
export const CODE_COLORS = {
  light: { key: '#223f7d', string: '#1b5e3f', number: '#8a4b0f', atom: '#7a2f8f', comment: '#6b6963', meta: '#9a3412', punct: '#5c5b54' },
  dark: { key: '#b7cbf5', string: '#9bd8b4', number: '#f2c08a', atom: '#d6b4f0', comment: '#8d8b83', meta: '#f0a27a', punct: '#aba9a1' },
} as const;

export const FONT = 'Inter, "Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
/** The brand voice: site, onboarding, empty states. Never in a diagram, a button or a menu. */
export const DISPLAY = '"Bricolage Grotesque", "Avenir Next", system-ui, sans-serif';

/** Brand only: the cover, sign in, social cards and the logo's own colors. Never in the app chrome or a diagram. */
export const BRAND = {
  blueprint: { light: '#16264a', dark: '#1f3566' },
  onBlueprint: { light: '#f4f3f0', dark: '#ecebe6' },
  coral: '#f0645f',
  amber: '#fcae3d',
  blue: '#4a7ef0',
} as const;

/** The plus mark the canvas draws every 48px, as a tile in the given grid color. */
export function plusTile(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><path d="M24 19.5v9M19.5 24h9" stroke="${color}" stroke-linecap="round" fill="none"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** The theme-independent tokens: type, radius, motion. */
const STATIC = [
  `--font:${FONT}`,
  `--mono:${MONO}`,
  `--display:${DISPLAY}`,
  '--fs-xs:11px', '--fs-s:12px', '--fs-m:13px', '--fs-l:14px', '--fs-xl:16px', '--fs-2xl:20px', '--fs-3xl:26px',
  '--caps:600 10.5px/1.2 var(--mono)', '--caps-track:.08em',
  '--tight:-.012em',
  '--r-xs:4px', '--r-s:6px', '--r-m:8px', '--r-node:10px', '--r-l:12px', '--r-xl:16px', '--r-2xl:24px', '--r-pill:999px',
  '--control-h:32px', '--grid-pitch:48px',
  `--logo-coral:${BRAND.coral}`, `--logo-amber:${BRAND.amber}`, `--logo-blue:${BRAND.blue}`,
  '--ease:cubic-bezier(.2,.7,.2,1)', '--ease-in:cubic-bezier(.4,0,.6,1)',
  '--d-1:120ms', '--d-2:180ms', '--d-3:260ms',
  // Nothing repaints forever: a spinner turns a set number of times and rests as an open ring, a skeleton shines a few passes and rests, the sign-in art settles once.
  '--d-spin:.7s', '--spin-turns:8', '--d-shine:1.4s', '--shine-passes:3', '--d-art:900ms',
  '--ring:0 0 0 2px var(--panel),0 0 0 4px var(--accent)',
  '--knob:#ffffff',
].join(';');

function declarations(s: Surfaces, paths: Record<string, string>, brand: 'light' | 'dark'): string {
  const code = CODE_COLORS[brand];
  return [
    `--blueprint:${BRAND.blueprint[brand]}`, `--on-blueprint:${BRAND.onBlueprint[brand]}`, `--plus:${plusTile(s.grid)}`,
    `--bg:${s.bg}`, `--panel:${s.panel}`, `--raise:${s.raise}`, `--sunken:${s.sunken}`, `--well:${s.well}`, `--hover:${s.hover}`, `--press:${s.press}`,
    `--ink:${s.ink}`, `--ink2:${s.ink2}`, `--muted:${s.muted}`, `--faint:${s.faint}`,
    `--line:${s.line}`, `--line2:${s.line2}`, `--grid:${s.grid}`,
    `--accent:${s.accent}`, `--accent-hover:${s.accentHover}`, `--accent-ink:${s.accentInk}`, `--accent-soft:${s.accentSoft}`, `--on-accent:${s.onAccent}`, `--hi:${s.hi}`,
    `--warn-bg:${s.warn.bg}`, `--warn-ink:${s.warn.ink}`, `--warn-line:${s.warn.line}`,
    `--bad-bg:${s.bad.bg}`, `--bad-ink:${s.bad.ink}`, `--bad-line:${s.bad.line}`,
    `--ok-bg:${s.ok.bg}`, `--ok-ink:${s.ok.ink}`, `--ok-line:${s.ok.line}`,
    `--lift:${s.lift}`, `--shadow:${s.shadow1}`, `--shadow2:${s.shadow2}`, `--shadow3:${s.shadow3}`, `--scrim:${s.scrim}`,
    ...Object.entries(s.severity).map(([k, v]) => `--sev-${k}:${v}`),
    ...Object.entries(paths).map(([k, v]) => `--path-${k}:${v}`),
    ...Object.entries(code).map(([k, v]) => `--code-${k}:${v}`),
  ].join(';');
}

/**
 * The CSS custom properties. `dark` names how dark mode is selected: by the
 * viewer's `data-theme` attribute alone, or, for the hub pages, by the
 * reader's system setting unless the root names the look they picked
 * (`data-theme` light or dark).
 */
export function tokenCss(dark: 'attribute' | 'system'): string {
  const light = `:root{color-scheme:light;${STATIC};${declarations(LIGHT, PATH_COLORS.light, 'light')}}`;
  const darkDecl = `color-scheme:dark;${declarations(DARK, PATH_COLORS.dark, 'dark')}`;
  return dark === 'attribute' ? `${light}[data-theme=dark]{${darkDecl}}` : `${light}${systemDark(darkDecl)}`;
}

/** Dark declarations for a page that follows the system setting unless its root names the reader's pick. */
export function systemDark(decl: string): string {
  return `@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${decl}}}:root[data-theme=dark]{${decl}}`;
}

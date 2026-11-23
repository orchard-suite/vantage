/**
 * The look of the hub's own pages: the same tokens and kit as the viewer,
 * light or dark as the reader picked, else by their system setting, so a reader moving from
 * the list to a diagram never feels a seam. The app frame and the home
 * library are in look-app.ts; the sign in and message cards are here.
 */
import { chromeFontCss, kitCss, markSvg, tokenCss } from '@vantage/render';
import { APP_CSS } from './look-app.ts';
import { API_CSS } from './look-api.ts';
import { BRAND_CSS } from './look-brand.ts';
import { NEW_CSS } from './look-new.ts';
import { DECISIONS_CSS } from './look-decisions.ts';
import { WORK_CSS } from './work-page.ts';
import { ADMIN_CSS } from './look-admin.ts';

/** Where the hub serves the font and brand files (see pages.ts). */
export const FONT_BASE = '/assets/fonts/';
export const BRAND_BASE = '/assets/brand/';

/**
 * Tokens, then the faces, then the shared interface kit (buttons, fields,
 * choices, menus: packages/render/src/kit.ts), then what only these pages
 * need. A part that two surfaces use belongs in the kit, not here.
 */
export const SHELL_CSS = `${tokenCss('system')}${chromeFontCss(FONT_BASE)}${kitCss('system')}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--ink);font:var(--fs-l)/1.5 var(--font);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;font-feature-settings:"cv11","ss01"}
a{color:inherit}
::selection{background:var(--accent-soft);color:var(--accent-ink)}
:focus-visible{outline:none;box-shadow:var(--ring)}
.brand{display:flex;align-items:center;text-decoration:none;border-radius:var(--r-s)}
.brand img{display:block;height:23px;width:auto}
.lockup-paper{display:none!important}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .lockup-ink{display:none!important}:root:not([data-theme=light]) .lockup-paper{display:block!important}}
:root[data-theme=dark] .lockup-ink{display:none!important}:root[data-theme=dark] .lockup-paper{display:block!important}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
${APP_CSS}${ADMIN_CSS}${API_CSS}${NEW_CSS}${DECISIONS_CSS}${WORK_CSS}${BRAND_CSS}
`;

/** The color mark, for places too small for the lockup. */
export const MARK = markSvg(24, 'hm');

/** The color lockup: ink on light grounds, paper on dark, by the same rule as the tokens. The wordmark is outlined in the file, never retyped. */
export const LOCKUP = `<img class="lockup-ink" src="${BRAND_BASE}vantage-lockup-color-ink.svg" alt="Vantage" width="104" height="23"><img class="lockup-paper" src="${BRAND_BASE}vantage-lockup-color-paper.svg" alt="" width="104" height="23">`;

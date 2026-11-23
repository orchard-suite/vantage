/**
 * The interface kit: the parts every Vantage screen is built from, as one
 * stylesheet the hub pages and the viewer both load. It sits on the tokens
 * (tokens.ts) and the picture's color families (theme.ts), so a button in
 * the hub and a button over the canvas are the same button.
 *
 * Rules the kit keeps, from the Vantage design system: one blue, one meaning;
 * hairlines first, then soft shadows; motion 120, 180 and 260ms on one
 * ease; focus is a solid two-ring; disabled is 40% with no hover; state
 * colors always travel with a word or an icon. State is read from ARIA
 * where it exists (aria-pressed, aria-checked, aria-selected,
 * aria-current), so markup that is accessible is also styled.
 */
import { THEMES, type ColorFamily } from './theme.ts';
import { systemDark } from './tokens.ts';

const FAMILIES: readonly ColorFamily[] = ['slate', 'blue', 'violet', 'emerald', 'amber', 'red', 'teal', 'pink'];

function familyVars(theme: 'light' | 'dark'): string {
  return FAMILIES.map((f) => {
    const c = THEMES[theme].families[f];
    return `--${f}-fill:${c.fill};--${f}-stroke:${c.stroke};--${f}-text:${c.text};--${f}-soft:${c.soft};--${f}-soft-stroke:${c.softStroke}`;
  }).join(';');
}

/** `.fam-blue` and friends point the generic `--f-*` slots at one family. */
const FAMILY_HELPERS = FAMILIES.map((f) => `.fam-${f}{--f-fill:var(--${f}-fill);--f-stroke:var(--${f}-stroke);--f-text:var(--${f}-text)}`).join('');

const PARTS = `
.caps{font:var(--caps);letter-spacing:var(--caps-track);text-transform:uppercase;color:var(--muted)}
.mono{font-family:var(--mono)}
.display{font-family:var(--display);letter-spacing:-.02em;font-weight:700}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.plus{background-color:var(--bg);background-image:var(--plus);background-size:var(--grid-pitch) var(--grid-pitch)}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:var(--control-h);padding:0 11px;border-radius:var(--r-m);border:1px solid var(--line);background:var(--panel);color:var(--ink);font:500 var(--fs-m)/1 var(--font);cursor:pointer;text-decoration:none;white-space:nowrap;transition:background-color var(--d-1) var(--ease),border-color var(--d-1) var(--ease),color var(--d-1) var(--ease),transform var(--d-1) var(--ease)}
.btn:hover{background:var(--hover);border-color:var(--line2)}
.btn:active{background:var(--press);transform:translateY(.5px)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent);box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 1px 2px rgba(28,28,26,.14)}
.btn.primary:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
.btn.primary:active{background:var(--accent-ink)}
.btn.soft{background:var(--accent-soft);border-color:transparent;color:var(--accent-ink)}
.btn.ghost{background:transparent;border-color:transparent;color:var(--ink2)}
.btn.ghost:hover{background:var(--hover);color:var(--ink)}
.btn.danger{background:var(--bad-bg);border-color:var(--bad-line);color:var(--bad-ink)}
.btn.icon{width:var(--control-h);padding:0}
.btn.sm{height:28px;padding:0 9px;font-size:12.5px}
.btn.sm.icon{width:28px;padding:0}
.btn.lg{height:40px;padding:0 16px;font-size:var(--fs-l);border-radius:10px}
.btn.wide{width:100%}
.btn:disabled,.btn[aria-disabled=true]{opacity:.4;pointer-events:none}
.btn svg{flex:none}
.split{display:inline-flex}
.split>.btn:first-child{border-radius:var(--r-m) 0 0 var(--r-m)}
.split>.btn:last-child{border-radius:0 var(--r-m) var(--r-m) 0;width:28px;padding:0;border-left-color:rgba(255,255,255,.22)}

.field{display:block;height:var(--control-h);padding:0 11px;border:1px solid var(--line);border-radius:var(--r-m);background:var(--sunken);color:var(--ink);font:400 var(--fs-m) var(--font);width:100%;min-width:0;transition:border-color var(--d-1) var(--ease),box-shadow var(--d-1) var(--ease),background-color var(--d-1) var(--ease)}
.field:hover{border-color:var(--line2)}
.field:focus{outline:none;border-color:var(--accent);background:var(--raise);box-shadow:0 0 0 3px var(--accent-soft)}
.field[aria-invalid=true]{border-color:var(--bad-line);background:var(--raise);box-shadow:0 0 0 3px var(--bad-bg)}
.field::placeholder{color:var(--faint)}
.field.lg{height:44px;padding:0 14px;font-size:var(--fs-l);border-radius:10px}
.field.code{font-family:var(--mono);letter-spacing:.14em;text-transform:uppercase}
textarea.field{height:auto;padding:9px 11px;line-height:19px;resize:vertical}
select.field{appearance:none;padding-right:30px;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 16 16' fill='none' stroke='%235c5b54' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4.5 6.5 8 10l3.5-3.5'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center}
.f-row{display:flex;flex-direction:column;gap:6px}
.f-label{font-size:12.5px;font-weight:500;color:var(--ink)}
.f-hint{font-size:var(--fs-s);color:var(--muted)}
.f-error{font-size:var(--fs-s);color:var(--bad-ink);display:flex;align-items:center;gap:6px}
.well{display:flex;align-items:center;gap:10px;height:40px;padding:0 8px 0 12px;border:1px solid var(--line);border-radius:10px;background:var(--sunken);color:var(--faint);transition:border-color var(--d-1) var(--ease),box-shadow var(--d-1) var(--ease),background-color var(--d-1) var(--ease)}
.well:hover{border-color:var(--line2)}
.well:focus-within{border-color:var(--accent);background:var(--raise);box-shadow:0 0 0 3px var(--accent-soft)}
.well input{flex:1;min-width:0;height:100%;border:none;background:none;outline:none;font:400 13.5px var(--font);color:var(--ink)}
.well input::placeholder{color:var(--faint)}

.check,.radio{appearance:none;margin:0;width:16px;height:16px;flex:none;border:1.5px solid var(--line2);background:var(--raise);cursor:pointer;display:inline-grid;place-content:center;transition:background-color var(--d-1) var(--ease),border-color var(--d-1) var(--ease),border-width var(--d-1) var(--ease)}
.check{border-radius:4px}
.check:checked,.check:indeterminate{background:var(--accent);border-color:var(--accent)}
.check:checked::after{content:"";width:8px;height:4px;border-left:1.75px solid var(--on-accent);border-bottom:1.75px solid var(--on-accent);transform:translateY(-1px) rotate(-45deg)}
.check:indeterminate::after{content:"";width:8px;height:1.75px;background:var(--on-accent)}
.radio{border-radius:999px}
.radio:checked{border:5px solid var(--accent)}
.choice{display:flex;align-items:center;gap:10px;font-size:var(--fs-m);cursor:pointer}
.switch{width:34px;height:20px;flex:none;padding:0;border:none;border-radius:999px;background:var(--line2);position:relative;cursor:pointer;transition:background-color var(--d-2) var(--ease)}
.switch::after{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:999px;background:var(--knob);box-shadow:var(--shadow);transition:transform var(--d-2) var(--ease)}
.switch[aria-checked=true]{background:var(--accent)}
.switch[aria-checked=true]::after{transform:translateX(14px)}
.seg{display:inline-flex;flex-wrap:wrap;gap:2px;padding:2px;border-radius:9px;background:var(--sunken);border:1px solid var(--line)}
.seg>button,.seg>a{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border:none;border-radius:7px;background:transparent;color:var(--muted);font:500 12.5px var(--font);text-decoration:none;cursor:pointer;transition:background-color var(--d-1) var(--ease),color var(--d-1) var(--ease)}
.seg>button:hover,.seg>a:hover{color:var(--ink)}
.seg>button[aria-pressed=true],.seg>button[aria-checked=true],.seg>a[aria-current=page]{background:var(--raise);color:var(--ink);box-shadow:var(--shadow)}
.chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:var(--r-pill);border:1px solid var(--line);background:var(--panel);color:var(--ink2);font:500 var(--fs-s) var(--font);white-space:nowrap;cursor:pointer;transition:background-color var(--d-1) var(--ease),border-color var(--d-1) var(--ease)}
.chip:hover{border-color:var(--line2);background:var(--hover)}
.chip[aria-pressed=true]{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-ink)}
.chip .dot{width:8px;height:8px;border-radius:999px;background:var(--f-stroke,var(--faint))}
.steps{display:inline-flex;align-items:center;gap:8px}
.steps>button{width:22px;height:8px;padding:0;border:none;border-radius:3px;background:var(--line2);cursor:pointer}
.steps>button.on{background:var(--accent)}

.pill{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:var(--r-pill);border:1px solid var(--line);background:var(--raise);color:var(--muted);font:600 var(--fs-xs) var(--font);white-space:nowrap}
.pill::before{content:"";width:6px;height:6px;border-radius:999px;background:currentColor}
.pill.ok{background:var(--ok-bg);color:var(--ok-ink);border-color:var(--ok-line)}
.pill.warn{background:var(--warn-bg);color:var(--warn-ink);border-color:var(--warn-line)}
.pill.bad{background:var(--bad-bg);color:var(--bad-ink);border-color:var(--bad-line)}
.pill.info{background:var(--accent-soft);color:var(--accent-ink);border-color:transparent}
.pill.busy::before{width:9px;height:9px;background:none;border:1.5px solid currentColor;border-right-color:transparent;animation:kit-spin .7s linear infinite}
.count{display:inline-block;min-width:18px;height:18px;padding:0 5px;border-radius:var(--r-pill);background:var(--accent);color:var(--on-accent);font:600 10.5px/18px var(--mono);text-align:center}
.tally{font:600 var(--fs-xs) var(--mono);color:var(--muted);background:var(--hover);border-radius:var(--r-pill);padding:2px 7px}
.more{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:var(--r-pill);background:var(--panel);border:1px solid var(--line2);font:500 var(--fs-xs) var(--font);color:var(--muted)}
.id{font:600 var(--fs-s) var(--mono);padding:3px 7px;border-radius:5px;background:var(--sunken);border:1px solid var(--line)}
.kbd,kbd{display:inline-block;min-width:20px;text-align:center;font:500 var(--fs-xs)/1 var(--mono);padding:3px 6px;border-radius:var(--r-xs);background:var(--panel);border:1px solid var(--line);border-bottom-width:2px;color:var(--muted)}
.swatch{display:inline-flex;align-items:center;height:30px;padding:0 12px;border-radius:var(--r-m);border:1.25px solid var(--f-stroke);background:var(--f-fill);color:var(--f-text);font:600 12.5px var(--font)}
.avatar{width:28px;height:28px;flex:none;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:var(--f-fill,var(--hover));color:var(--f-text,var(--muted));font:600 10.5px var(--font);box-shadow:0 0 0 2px var(--panel)}
.avatar.here{box-shadow:0 0 0 2px var(--panel),0 0 0 3.5px var(--f-stroke,var(--accent))}
.avatars{display:inline-flex}
.avatars>.avatar+.avatar{margin-left:-5px}

.tabs{display:flex;flex-wrap:wrap;border-bottom:1px solid var(--line)}
.tabs>[role=tab],.tabs>a{position:relative;display:inline-flex;align-items:center;gap:7px;height:40px;margin-right:22px;padding:0;border:none;background:none;color:var(--muted);font:500 var(--fs-m) var(--font);text-decoration:none;cursor:pointer}
.tabs>[role=tab]:hover,.tabs>a:hover{color:var(--ink)}
.tabs>[aria-selected=true],.tabs>[aria-current=page]{color:var(--ink)}
.tabs>[aria-selected=true]::after,.tabs>[aria-current=page]::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px;background:var(--accent)}
.nav{display:flex;flex-direction:column;gap:2px}
.nav>a,.nav>button{display:flex;align-items:center;gap:10px;height:34px;padding:0 10px;border:none;border-radius:var(--r-m);background:none;color:var(--ink2);font:500 var(--fs-m) var(--font);text-align:left;text-decoration:none;cursor:pointer;width:100%;transition:background-color var(--d-1) var(--ease),color var(--d-1) var(--ease)}
.nav>a:hover,.nav>button:hover{background:var(--hover);color:var(--ink)}
.nav>[aria-current=page]{background:var(--accent-soft);color:var(--accent-ink)}
.nav .n{margin-left:auto;font:600 var(--fs-xs) var(--mono);color:var(--faint)}
.nav>[aria-current=page] .n{color:var(--accent-ink)}
.crumbs{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted);flex-wrap:wrap}
.crumbs a{color:inherit;text-decoration:none;border-radius:var(--r-xs)}
.crumbs a:hover{color:var(--ink)}
.crumbs [aria-current=page]{color:var(--ink);font-weight:500}
.link{color:var(--accent-ink);font-weight:500;text-decoration:none;border-radius:var(--r-xs)}
.link:hover{text-decoration:underline;text-underline-offset:2px}

.menu{min-width:220px;padding:6px;border-radius:var(--r-l);background:var(--raise);box-shadow:var(--shadow3)}
.menu [role=menuitem]{display:flex;align-items:center;gap:10px;width:100%;height:32px;padding:0 10px;border:none;border-radius:var(--r-s);background:none;color:var(--ink);font:400 var(--fs-m) var(--font);text-align:left;text-decoration:none;cursor:pointer}
.menu [role=menuitem]:hover,.menu [role=menuitem]:focus-visible{background:var(--hover);box-shadow:none}
.menu [role=menuitem].bad{color:var(--bad-ink)}
.menu .k{margin-left:auto;font:500 var(--fs-xs) var(--mono);color:var(--faint)}
.menu [role=separator]{height:1px;margin:6px 4px;background:var(--line)}
.menu .group{padding:8px 10px 4px}
.tip{display:inline-flex;align-items:center;gap:8px;padding:5px 8px;border-radius:var(--r-s);background:var(--ink);color:var(--bg);font:500 var(--fs-s) var(--font);white-space:nowrap}
.tip .k{font:500 10.5px var(--mono);opacity:.7}
.toast{display:flex;align-items:center;gap:12px;padding:10px 10px 10px 14px;border-radius:var(--r-l);background:var(--ink);color:var(--bg);box-shadow:var(--shadow3);font-size:var(--fs-m)}
.toast button{height:26px;padding:0 9px;border:none;border-radius:var(--r-s);background:rgba(255,255,255,.12);color:inherit;font:500 12.5px var(--font);cursor:pointer}
.banner{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink2);font-size:12.5px;line-height:18px}
.banner svg{flex:none;margin-top:1px}
.banner.ok{background:var(--ok-bg);border-color:var(--ok-line);color:var(--ok-ink)}
.banner.warn{background:var(--warn-bg);border-color:var(--warn-line);color:var(--warn-ink)}
.banner.bad{background:var(--bad-bg);border-color:var(--bad-line);color:var(--bad-ink)}
.banner a{color:inherit;font-weight:600}
.scrim{position:fixed;inset:0;background:var(--scrim)}
.dialog{width:100%;max-width:560px;background:var(--raise);border-radius:var(--r-xl);box-shadow:var(--shadow3);overflow:hidden;animation:kit-rise var(--d-3) var(--ease)}
.dialog>header{display:flex;align-items:flex-start;gap:16px;padding:20px 22px 16px;border-bottom:1px solid var(--line)}
.dialog>header h2{margin:0;font-size:17px;line-height:22px;font-weight:600;letter-spacing:var(--tight)}
.dialog>footer{display:flex;align-items:center;gap:8px;padding:14px 22px;border-top:1px solid var(--line);background:var(--panel)}

.doc-card{position:relative;display:flex;flex-direction:column;overflow:hidden;border-radius:var(--r-l);border:1px solid var(--line);background:var(--panel);box-shadow:var(--lift);color:var(--ink);text-decoration:none;transition:border-color var(--d-2) var(--ease),box-shadow var(--d-2) var(--ease),transform var(--d-2) var(--ease)}
.doc-card:hover,.doc-card:focus-within{border-color:var(--line2);box-shadow:var(--shadow2);transform:translateY(-2px)}
.doc-card .thumb{height:156px;border-bottom:1px solid var(--line);background-color:var(--well);background-image:var(--plus);background-size:16px 16px;overflow:hidden;position:relative}
.doc-card .thumb img,.doc-card .thumb svg{display:block;width:100%;height:100%;object-fit:contain;transition:transform var(--d-3) var(--ease)}
.doc-card:hover .thumb img,.doc-card:hover .thumb svg{transform:scale(1.03)}
.doc-card .body{display:flex;flex-direction:column;gap:8px;padding:12px 14px}
.doc-card .name{font-size:13.5px;font-weight:600;line-height:19px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.doc-card .meta{font-size:var(--fs-s);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.doc-card .when{font:500 var(--fs-xs) var(--mono);color:var(--faint)}
.doc-card .acts{position:absolute;top:10px;right:10px;display:flex;gap:6px;opacity:0;transition:opacity var(--d-1) var(--ease);z-index:2}
.doc-card:hover .acts,.doc-card:focus-within .acts{opacity:1}
.doc-card .cover{position:absolute;inset:0;z-index:1;border-radius:inherit}
.tile{display:flex;flex-direction:column;gap:12px;padding:14px;border-radius:var(--r-l);border:1px solid var(--line);background:var(--panel);box-shadow:var(--lift);color:var(--ink);text-decoration:none;text-align:left;cursor:pointer;transition:border-color var(--d-2) var(--ease),box-shadow var(--d-2) var(--ease),transform var(--d-2) var(--ease)}
.tile:hover{border-color:var(--line2);box-shadow:var(--shadow2);transform:translateY(-2px)}
.empty-state{display:flex;align-items:center;gap:18px;padding:24px;border:1.5px dashed var(--line2);border-radius:var(--r-l)}
.empty-state .title{font:700 18px/22px var(--display);letter-spacing:-.01em}
.empty-state p{margin:4px 0 0;font-size:var(--fs-m);color:var(--muted)}
.shapes{position:relative;width:70px;height:52px;flex:none}
.shapes i{position:absolute;display:block}
.shapes i:nth-child(1){left:0;top:4px;width:32px;height:26px;border-radius:8px;background:var(--logo-coral);transform:rotate(-8deg)}
.shapes i:nth-child(2){left:36px;top:0;width:30px;height:30px;border-radius:8px;background:var(--logo-amber);transform:rotate(8deg)}
.shapes i:nth-child(3){left:22px;top:28px;width:22px;height:22px;border-radius:999px;background:var(--accent)}

.progress{height:6px;border-radius:var(--r-pill);background:var(--line);overflow:hidden}
.progress>i{display:block;height:100%;border-radius:inherit;background:var(--accent);transition:width var(--d-3) var(--ease)}
.progress.ok>i{background:var(--emerald-stroke)}
.spinner{display:inline-block;width:14px;height:14px;flex:none;border-radius:999px;border:2px solid currentColor;border-right-color:transparent;animation:kit-spin .7s linear infinite}
.skeleton{border-radius:6px;background:linear-gradient(90deg,var(--hover) 0%,var(--sunken) 50%,var(--hover) 100%);background-size:200% 100%;animation:kit-shine 1.4s ease-in-out infinite}
@keyframes kit-spin{to{transform:rotate(360deg)}}
@keyframes kit-shine{from{background-position:100% 0}to{background-position:-100% 0}}
@keyframes kit-rise{from{opacity:0;transform:translateY(8px) scale(.99)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.btn,.field,.chip,.switch,.switch::after,.doc-card,.tile,.dialog,.spinner,.skeleton,.pill.busy::before{transition:none!important;animation:none!important}}
`;

/**
 * The kit stylesheet. `dark` follows tokenCss: the viewer selects dark by
 * its data-theme attribute, the hub by the reader's system setting unless
 * the root names their pick. Load it after tokenCss.
 */
export function kitCss(dark: 'attribute' | 'system'): string {
  const light = `:root{${familyVars('light')}}`;
  const darkVars = familyVars('dark');
  const darkRule = dark === 'attribute' ? `[data-theme=dark]{${darkVars}}` : systemDark(darkVars);
  return light + darkRule + FAMILY_HELPERS + PARTS;
}

/**
 * The full color mark (the Sunrise palette): a coral node and an amber node
 * whose links meet in the blue vantage point. Gradient ids carry `id` so two
 * marks can share a page. Never recolored; one-color marks live with the
 * brand files.
 */
export function markSvg(size: number, id = 'vm'): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 128 128" aria-hidden="true"><defs><linearGradient id="${id}L" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF8A7A"/><stop offset="1" stop-color="#E0435A"/></linearGradient><linearGradient id="${id}R" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFCB5C"/><stop offset="1" stop-color="#F0901E"/></linearGradient><linearGradient id="${id}La" x1="31" y1="35" x2="64" y2="99" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#E8505F"/><stop offset="1" stop-color="#FF8C80"/></linearGradient><linearGradient id="${id}Ra" x1="97" y1="35" x2="64" y2="99" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#F5A12E"/><stop offset="1" stop-color="#FFD07A"/></linearGradient><radialGradient id="${id}D" cx=".34" cy=".28" r=".82"><stop offset="0" stop-color="#9CC0FF"/><stop offset=".55" stop-color="#4A7EF0"/><stop offset="1" stop-color="#2448B8"/></radialGradient><linearGradient id="${id}H" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".36"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient><filter id="${id}S" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="2.5" stdDeviation="2.5" flood-color="#0b1a3a" flood-opacity=".3"/></filter></defs><path d="M31 35 64 99" stroke="url(#${id}La)" stroke-width="22" stroke-linecap="round"/><path d="M97 35 64 99" stroke="url(#${id}Ra)" stroke-width="22" stroke-linecap="round"/><g filter="url(#${id}S)"><rect x="9" y="13" width="44" height="44" rx="14" fill="url(#${id}L)"/><rect x="75" y="13" width="44" height="44" rx="14" fill="url(#${id}R)"/><circle cx="64" cy="99" r="23" fill="url(#${id}D)"/></g><rect x="9" y="13" width="44" height="44" rx="14" fill="url(#${id}H)"/><rect x="75" y="13" width="44" height="44" rx="14" fill="url(#${id}H)"/><circle cx="64" cy="99" r="23" fill="url(#${id}H)"/></svg>`;
}

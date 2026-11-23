/**
 * The viewer's stylesheet. The tokens come from packages/render, so the
 * chrome, the hub pages, and the picture share one palette; this file is
 * the base, the shell, the sidebar, and the header, laid over the shared
 * interface kit (render/src/kit.ts). The stage, the
 * collaboration dock, the dialogs, and presence follow in their own files.
 */
import { tokenCss } from '../../render/src/tokens.ts';
import { kitCss } from '../../render/src/kit.ts';
import { STAGE_STYLES } from './styles-stage.ts';
import { OPEN_STYLES } from './open-items.ts';
import { DOCK_STYLES } from './styles-dock.ts';
import { DIALOG_STYLES } from './styles-dialogs.ts';
import { PRESENCE_STYLES } from './styles-presence.ts';
import { EDIT_STYLES } from './styles-edit.ts';
import { TALK_STYLES } from './styles-talk.ts';
import { REVIEW_STYLES } from './styles-review.ts';
import { READ_STYLES } from './styles-read.ts';
import { OVERVIEW_STYLES } from './styles-overview.ts';

const BASE = `
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font:var(--fs-m)/1.45 var(--font);overscroll-behavior:none;overflow:hidden;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;font-feature-settings:"cv11","ss01"}
#vantage{height:100%}
::selection{background:var(--accent-soft);color:var(--accent-ink)}
button{font:inherit;color:inherit}
:focus-visible{outline:none;box-shadow:var(--ring)}
*{scrollbar-width:thin;scrollbar-color:var(--line2) transparent}
kbd{font:500 var(--fs-xs)/1 var(--mono);color:var(--muted);background:var(--sunken);border:1px solid var(--line);border-bottom-width:2px;border-radius:var(--r-xs);padding:3px 5px;min-width:20px;text-align:center;display:inline-block}
.v-ico{flex:none;display:block}
.v-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}

.v-app{display:grid;grid-template-columns:272px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);height:100vh;height:100dvh;background:var(--bg)}
.v-app.v-side-hidden{grid-template-columns:0 minmax(0,1fr)}
.v-hub.v-dock-shown{grid-template-columns:272px minmax(0,1fr) 360px}
.v-hub.v-dock-shown.v-side-hidden{grid-template-columns:0 minmax(0,1fr) 360px}
.v-app.v-side-hidden .v-side,.v-hub:not(.v-dock-shown) .v-dock{display:none}

.v-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 11px;border:1px solid var(--line);border-radius:var(--r-m);background:var(--panel);color:var(--ink);font-weight:500;cursor:pointer;white-space:nowrap;transition:background-color var(--d-1) var(--ease),border-color var(--d-1) var(--ease),color var(--d-1) var(--ease),box-shadow var(--d-1) var(--ease)}
.v-btn:hover{background:var(--hover);border-color:var(--line2)}
.v-btn:active{background:var(--press)}
.v-btn:disabled{opacity:.4;cursor:default;background:var(--panel);border-color:var(--line)}
.v-icon-btn{width:32px;padding:0}
.v-quiet{border-color:transparent;background:transparent}
.v-quiet:hover{border-color:transparent}
.v-quiet:disabled{background:transparent;border-color:transparent}
.v-btn-primary{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.v-btn-primary:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
.v-btn-primary:active{background:var(--accent-ink)}
.v-btn-primary:disabled{background:var(--accent);border-color:var(--accent)}
.v-btn-soft{background:var(--accent-soft);border-color:transparent;color:var(--accent-ink);text-decoration:none}
.v-btn-soft:hover{background:var(--accent-soft);border-color:var(--accent)}
.v-link{background:none;border:none;padding:0;color:var(--accent-ink);font-size:var(--fs-s);font-weight:500;cursor:pointer;text-align:left;display:inline-flex;align-items:center;gap:4px;border-radius:var(--r-xs)}
.v-link:hover{text-decoration:underline;text-underline-offset:2px}
.v-count{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--accent);color:var(--on-accent);font:600 var(--fs-xs)/1 var(--font);font-variant-numeric:tabular-nums}
.v-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font-size:var(--fs-s);font-weight:500;text-decoration:none;cursor:pointer;white-space:nowrap;flex:none;transition:background-color var(--d-1) var(--ease),border-color var(--d-1) var(--ease),box-shadow var(--d-1) var(--ease)}
.v-chip:hover{background:var(--hover);border-color:var(--line2)}
.v-chips .v-chip::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--chip);box-shadow:0 0 0 1px var(--panel) inset}
.v-chip[aria-pressed=true]{border-color:var(--chip,var(--accent));background:color-mix(in srgb,var(--chip,var(--accent)) 12%,var(--panel));color:var(--ink)}
`;

const SIDEBAR = `
.v-side{grid-column:1;grid-row:2;border-right:1px solid var(--line);background:var(--panel);display:flex;flex-direction:column;min-height:0;position:relative}
.v-side-close{position:absolute;top:12px;right:10px;display:none}
.v-searchbox{display:flex;align-items:center;gap:8px;margin:12px 12px 6px;height:34px;padding:0 8px 0 10px;border:1px solid var(--line);border-radius:var(--r-m);background:var(--sunken);color:var(--faint);cursor:text;transition:border-color var(--d-1) var(--ease),box-shadow var(--d-1) var(--ease),background-color var(--d-1) var(--ease)}
.v-searchbox:hover{border-color:var(--line2)}
.v-searchbox:focus-within{border-color:var(--accent);background:var(--raise);box-shadow:0 0 0 3px var(--accent-soft)}
.v-search{flex:1;min-width:0;border:none;background:none;color:var(--ink);font:inherit;outline:none;height:100%}
.v-search::placeholder{color:var(--faint)}
.v-searchbox.has .v-search-key,.v-searchbox:focus-within .v-search-key{display:none}
.v-picker{overflow:auto;flex:1;padding:2px 8px 16px}
.v-group{font:var(--caps);letter-spacing:var(--caps-track);text-transform:uppercase;color:var(--muted);padding:16px 8px 6px;display:flex;align-items:center;gap:6px}
.v-fold{margin-left:calc(var(--depth,0) * 10px)}
.v-fold>summary{list-style:none;cursor:pointer;user-select:none;border-radius:var(--r-s)}
.v-fold>summary::-webkit-details-marker{display:none}
.v-fold>summary::before{content:'';width:5px;height:5px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform var(--d-2) var(--ease);flex:none;margin:0 4px 0 2px;opacity:.8}
.v-fold[open]>summary::before{transform:rotate(45deg) translate(-2px,-1px)}
.v-fold>summary:hover{color:var(--ink)}
.v-fold>summary .n{margin-left:auto;font-weight:500;letter-spacing:0;color:var(--faint);font-variant-numeric:tabular-nums}
.v-item{display:flex;align-items:center;gap:8px;min-height:32px;padding:6px 10px;border-radius:var(--r-m);cursor:pointer;color:var(--ink);text-decoration:none;flex-wrap:wrap;position:relative;transition:background-color var(--d-1) var(--ease),color var(--d-1) var(--ease)}
.v-item:hover{background:var(--hover)}
.v-item.active{background:var(--accent-soft);color:var(--accent-ink);font-weight:600}
.v-item.active::before{content:'';position:absolute;left:0;top:9px;bottom:9px;width:2px;border-radius:1px;background:var(--accent)}
.v-item-title{flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.v-kind{color:var(--faint);flex:none;display:inline-flex}
.v-item.active .v-kind{color:var(--accent-ink)}
.v-item.part{color:var(--muted)}
.v-item .hit{flex-basis:100%;font-size:var(--fs-s);font-weight:400;color:var(--muted);margin-top:-4px}
.v-picker-empty{color:var(--muted);padding:16px 10px;margin:0}
.v-parts{display:flex;align-items:center;gap:10px;padding:12px 18px;border-top:1px solid var(--line);font-size:var(--fs-s);color:var(--muted);cursor:pointer}
.v-parts input{appearance:none;-webkit-appearance:none;margin:0;width:28px;height:16px;border-radius:8px;background:var(--line2);position:relative;cursor:pointer;flex:none;transition:background-color var(--d-2) var(--ease)}
.v-parts input::after{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--knob);box-shadow:var(--shadow);transition:transform var(--d-2) var(--ease)}
.v-parts input:checked{background:var(--accent)}
.v-parts input:checked::after{transform:translateX(12px)}
`;

const HEADER = `
.v-head{grid-column:1/-1;grid-row:1;position:relative;z-index:6;display:flex;align-items:center;gap:10px;height:56px;padding:0 12px 0 10px;background:var(--panel);border-bottom:1px solid var(--line)}
.v-brand{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;flex:none;border-radius:9px;transition:background-color var(--d-1) var(--ease)}
a.v-brand:hover{background:var(--hover)}
.v-brand svg{display:block}
.v-docbar{flex:1;min-width:0;display:flex;align-items:baseline;gap:10px}
.v-view-line{display:none}
.v-doc-title{margin:0;font-size:15px;line-height:20px;font-weight:600;letter-spacing:var(--tight);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.v-doc-meta{flex:none;color:var(--muted);font-size:var(--fs-s);white-space:nowrap}
.v-doc-status{flex:none;align-self:center;color:var(--muted);font-size:var(--fs-s);line-height:18px;white-space:nowrap;padding:0 8px;border:1px solid var(--line);border-radius:999px}
.v-doc-status[hidden]{display:none}
.v-main{grid-column:2;grid-row:2;display:flex;flex-direction:column;min-width:0;min-height:0}
.v-tools{display:flex;align-items:center;gap:8px;flex:none}
.v-present-btn{background:var(--accent);color:var(--on-accent);border-color:var(--accent);box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 1px 2px rgba(28,28,26,.14)}
.v-present-btn:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
.v-present-btn.on{background:var(--raise);color:var(--ink);border-color:var(--line);box-shadow:var(--shadow)}
.v-dock-btn{display:none}
.v-hub .v-dock-btn{display:inline-flex}
.v-dock-btn[aria-pressed=true]{background:var(--accent-soft);color:var(--accent-ink);border-color:transparent}

.v-viewcard{position:absolute;left:16px;top:16px;z-index:5;max-width:min(560px,calc(100% - 32px));padding:12px 16px 13px;background:var(--raise);border-radius:var(--r-l);box-shadow:var(--shadow2);animation:v-in var(--d-2) var(--ease)}
.v-inspecting .v-viewcard{max-width:min(560px,calc(100% - 388px))}
.v-titles{min-width:0}
.v-crumb{display:none;align-items:center;gap:6px;font-size:var(--fs-s);color:var(--muted);margin-bottom:2px;min-width:0}
.v-crumb.show{display:flex}
.v-crumb-back{display:inline-flex;align-items:center;gap:4px;color:var(--accent-ink);text-decoration:none;font-weight:500;white-space:nowrap;border-radius:var(--r-xs)}
.v-crumb-back:hover{text-decoration:underline;text-underline-offset:2px}
.v-crumb-sep{color:var(--faint)}
.v-title{font-size:var(--fs-xl);line-height:21.6px;font-weight:600;margin:0;letter-spacing:var(--tight);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.v-lede{display:flex;flex-wrap:wrap;align-items:center;column-gap:14px;row-gap:2px;margin-top:3px}
.v-lede.empty{display:none}
.v-question{flex-basis:100%;margin:0;color:var(--ink2);font-size:13.5px;line-height:20px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.v-question.full{display:block}
.v-notes{position:absolute;left:0;top:calc(100% + 8px);width:min(600px,calc(100vw - 32px));max-height:55vh;overflow:auto;background:var(--raise);border-radius:var(--r-l);box-shadow:var(--shadow3);padding:14px 18px;display:none}
.v-notes.show{display:block;animation:v-pop var(--d-2) var(--ease)}
.v-notes-body{white-space:pre-wrap;font-size:13.5px;line-height:1.6;color:var(--ink2);overflow-wrap:anywhere}

.v-toolbar{position:absolute;left:16px;bottom:calc(16px + var(--lift,0px));z-index:4;display:flex;align-items:center;gap:2px;padding:4px;border-radius:var(--r-l);background:var(--raise);box-shadow:var(--shadow2);transition:bottom var(--d-3) var(--ease)}
.v-toolbar .v-btn{height:30px}
.v-toolbar .v-icon-btn{width:30px}
.v-toolbar .v-quiet:hover{background:var(--hover)}
.v-zoom{display:inline-flex;align-items:center;gap:2px}
.v-sep{width:1px;height:18px;margin:0 4px;background:var(--line);flex:none}
.v-detail:not(.show)+.v-sep-detail{display:none}
.v-detail{display:none;align-items:center;gap:8px;height:30px;padding:0 4px 0 8px}
.v-detail.show{display:inline-flex}
.v-detail .l{font:var(--caps);letter-spacing:var(--caps-track);text-transform:uppercase;color:var(--muted)}
.v-detail-steps{display:flex;align-items:flex-end;gap:1px;height:100%}
.v-detail-step{display:flex;align-items:flex-end;justify-content:center;width:16px;height:100%;padding:0 0 8px;border:none;background:none;cursor:pointer;border-radius:var(--r-xs)}
.v-detail-step i{display:block;width:6px;border-radius:1.5px;background:var(--line2);transition:background-color var(--d-2) var(--ease)}
.v-detail-step.lit i{background:var(--accent)}
.v-detail-step:hover i{background:var(--accent-hover)}

.v-more{position:relative}
.v-menu{position:absolute;right:0;top:calc(100% + 6px);min-width:232px;background:var(--raise);border-radius:var(--r-l);padding:6px;display:none;flex-direction:column;gap:1px;box-shadow:var(--shadow3);z-index:8;transform-origin:top right}
.v-menu.show{display:flex;animation:v-pop var(--d-2) var(--ease)}
.v-menu-item{display:flex;align-items:center;gap:10px;height:34px;padding:0 10px;border:none;border-radius:var(--r-s);background:none;color:var(--ink);text-align:left;cursor:pointer;width:100%}
.v-menu-item:hover,.v-menu-item:focus-visible{background:var(--hover);box-shadow:none}
.v-menu-item .v-ico{color:var(--muted)}
.v-menu-item kbd{margin-left:auto}
.v-menu-sep{height:1px;margin:4px 2px;background:var(--line)}
.v-menu-item.v-bad,.v-menu-item.v-bad .v-ico{color:var(--bad-ink)}
.v-narrow-only{display:none}
.v-menu-info{display:flex;justify-content:space-between;align-items:center;margin-top:4px;padding:9px 10px 5px;border-top:1px solid var(--line);color:var(--muted);font-size:var(--fs-s);cursor:help}
.v-menu-info b{font:600 var(--fs-s) var(--mono);color:var(--ink);font-variant-numeric:tabular-nums}
`;

/** The kit comes before the viewer's own rules, so a v- class always wins where the two meet. */
export const STYLES = tokenCss('attribute') + kitCss('attribute') + BASE + SIDEBAR + HEADER + STAGE_STYLES + OPEN_STYLES + DOCK_STYLES + DIALOG_STYLES + PRESENCE_STYLES + EDIT_STYLES + TALK_STYLES + REVIEW_STYLES + READ_STYLES + OVERVIEW_STYLES;

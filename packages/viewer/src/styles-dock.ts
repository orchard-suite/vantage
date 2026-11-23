/** The collaboration dock (comments, steer, history, visual diff), the compact layout, the sideways phone, and print. */
import { COMPACT, SHORT } from './compact.ts';
export const DOCK_STYLES = `
.v-dock{grid-column:3;grid-row:2;border-left:1px solid var(--line);background:var(--panel);display:flex;flex-direction:column;min-height:0;min-width:0}
.v-tabs-bar{display:flex;align-items:center;gap:4px;padding:0 10px;height:49px;border-bottom:1px solid var(--line)}
.v-tabs{display:flex;gap:2px;flex:1;min-width:0;height:100%}
.v-tab{height:100%;padding:0 10px;border:none;border-radius:0;background:none;color:var(--muted);font-weight:500;cursor:pointer;position:relative;transition:color var(--d-1) var(--ease)}
.v-tab:hover{color:var(--ink)}
.v-tab:focus-visible{box-shadow:inset var(--ring)}
.v-tab::after{content:'';position:absolute;left:10px;right:10px;bottom:-1px;height:2px;border-radius:var(--r-2xs);background:transparent;transition:background-color var(--d-2) var(--ease)}
.v-tab.active{color:var(--ink);font-weight:600}
.v-tab.active::after{background:var(--accent)}
.v-dock-body{display:none;overflow:auto;flex:1;padding:16px 16px 20px;min-height:0}
.v-dock-body.show{display:block;animation:v-fade var(--d-2) var(--ease)}
.v-dock h3{font:var(--caps);letter-spacing:var(--caps-track);text-transform:uppercase;color:var(--muted);margin:22px 0 8px}
.v-dock h3:first-child,.v-steer-head h3{margin-top:0}
.v-steer-head{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}
.v-steer-head h3{font:600 15px/1.3 var(--font);letter-spacing:var(--tight);text-transform:none;color:var(--ink);overflow-wrap:anywhere}
.v-muted{color:var(--muted);font-size:var(--fs-s);line-height:1.5;margin:4px 0}
.v-row{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.v-field{display:flex;flex-direction:column;gap:6px;margin:14px 0}
.v-field label{font-size:var(--fs-s);font-weight:500;color:var(--muted)}
.v-field .v-btn{align-self:flex-start}
.v-text,.v-input,.v-select{width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:var(--r-m);background:var(--sunken);color:var(--ink);font:inherit;resize:vertical;transition:border-color var(--d-1) var(--ease),box-shadow var(--d-1) var(--ease),background-color var(--d-1) var(--ease)}
.v-text::placeholder,.v-input::placeholder{color:var(--faint)}
.v-text:hover,.v-input:hover,.v-select:hover{border-color:var(--line2)}
.v-select{width:auto;height:32px;padding:0 8px;background:var(--panel)}
.v-text:focus,.v-input:focus,.v-select:focus{outline:none;border-color:var(--accent);background:var(--raise);box-shadow:var(--halo)}
.v-order{margin:0;padding:0;list-style:none;border:1px solid var(--line);border-radius:var(--r-m);overflow:hidden;background:var(--panel)}
.v-order li{display:flex;align-items:center;gap:2px;padding:3px 4px 3px 10px;font-size:var(--fs-s)}
.v-order li+li{border-top:1px solid var(--line)}
.v-order li span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.v-order .v-btn{height:26px;width:26px;padding:0;font-size:10px;border-color:transparent;background:none}
.v-status{border-top:1px solid var(--line);padding:9px 16px;font-size:var(--fs-s);color:var(--muted);min-height:38px}
.v-status:empty{display:none}
.v-status.ok{color:var(--ok-ink);background:var(--ok-bg)}
.v-status.warn{color:var(--warn-ink);background:var(--warn-bg)}
.v-status.error{color:var(--bad-ink);background:var(--bad-bg)}
.v-thread{margin-bottom:22px}
.v-comment{display:grid;grid-template-columns:28px minmax(0,1fr);gap:0 10px;padding:10px 0;border-top:1px solid var(--line)}
.v-avatar{grid-row:1/3;width:28px;height:28px;border-radius:50%;background:var(--accent-soft);color:var(--accent-ink);font:600 10.5px/28px var(--mono);text-align:center;text-transform:uppercase;letter-spacing:.02em}
.v-comment .meta{display:flex;align-items:baseline;gap:8px;font-size:var(--fs-s);color:var(--muted)}
.v-comment .meta .who{font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.v-comment .meta .v-link{margin-left:auto;font-size:var(--fs-s)}
.v-comment p{margin:3px 0 0;white-space:pre-wrap;font-size:var(--fs-m);line-height:1.5;overflow-wrap:anywhere}
.v-comment.done p{color:var(--muted)}
.v-comment.done .v-avatar{background:var(--hover);color:var(--muted)}
.v-comment .meta input{margin:0;accent-color:var(--accent)}
.v-comment-body p{margin-top:3px}
.v-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.v-chip{display:inline-flex;align-items:center;gap:2px;max-width:100%;padding:1px 8px;border-radius:var(--r-pill);background:var(--accent-soft);color:var(--accent-ink);font-size:var(--fs-xs);font-weight:600;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.v-chip-x{border:none;background:none;color:inherit;font:inherit;padding:0 0 0 4px;cursor:pointer;opacity:.7}
.v-chip-x:hover{opacity:1}
.v-about{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.v-about .v-chips{margin-top:0}
.v-about .v-btn{margin-left:auto;height:28px}
.v-compose{padding-top:12px;border-top:1px solid var(--line)}
.v-revise{margin-top:18px;padding-top:4px;border-top:1px solid var(--line)}
.v-revise-summary{margin:6px 0;font-size:var(--fs-m);line-height:1.5;white-space:pre-wrap}
.v-revise-warn{margin:6px 0;padding:8px 10px;border-radius:var(--r-m);color:var(--warn-ink);background:var(--warn-bg);font-size:var(--fs-s)}
.v-revise-error{margin:6px 0;padding:8px 10px;border-radius:var(--r-m);color:var(--bad-ink);background:var(--bad-bg);font-size:var(--fs-s)}
.v-resolved{margin:6px 0}
.v-resolved summary{font-size:var(--fs-s);color:var(--muted);cursor:pointer;padding:4px 0;border-radius:var(--r-xs)}
.v-versions{list-style:none;margin:0 -8px;padding:0}
.v-versions li{padding:9px 8px;border-radius:var(--r-m);position:relative;transition:background-color var(--d-1) var(--ease)}
.v-versions li+li{margin-top:2px}
.v-versions li:hover{background:var(--hover)}
.v-versions li.picked{background:var(--accent-soft)}
.v-versions .top{display:flex;align-items:center;gap:8px}
.v-versions .msg{color:var(--ink);font-size:var(--fs-m);font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.v-versions .k{font:600 10px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;padding:4px 6px;border-radius:var(--r-xs);background:var(--ink);color:var(--bg)}
.v-versions .k.side{background:var(--accent);color:var(--on-accent)}
.v-versions .score{font:500 var(--fs-xs) var(--mono);color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.v-versions .meta{display:flex;gap:8px;font-size:var(--fs-s);color:var(--muted);margin-top:2px}
.v-versions .meta .v-link{margin-left:auto;font-size:var(--fs-s)}
.v-diffview{position:absolute;inset:0;z-index:5;background:var(--bg);display:none;flex-direction:column;overflow:auto}
.v-diffview.show{display:flex;animation:v-fade var(--d-2) var(--ease)}
.v-diffview .bar{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--panel);font-weight:600;position:sticky;top:0}
.v-diffview .bar span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.v-diffview img{display:block;max-width:calc(100% - 32px);margin:16px;background:var(--panel);border-radius:var(--r-l);box-shadow:var(--shadow1)}
.v-story-list{margin:14px 0 0;padding:12px 0 0 18px;font-size:var(--fs-s);line-height:1.5;border-top:1px solid var(--line)}
.v-story-list li{padding:2px 0}
.v-story-list .appeared,.v-story-list .edge-appeared{color:var(--path-emerald)}
.v-story-list .vanished,.v-story-list .edge-vanished{color:var(--path-red)}
.v-story-list .moved{color:var(--path-amber)}
.v-story-list .relabelled{color:var(--path-violet)}

@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
@media (hover:none){.v-tip{display:none!important}.v-item{min-height:40px}.v-btn{height:38px}.v-icon-btn{width:38px}.v-seg .v-btn{height:36px}.v-menu-item{height:42px}.v-rel{padding:10px 8px}}
@media ${COMPACT}{
.v-app,.v-hub,.v-app.v-side-hidden,.v-hub.v-dock-shown,.v-hub.v-dock-shown.v-side-hidden{grid-template-columns:minmax(0,1fr)}
.v-main{grid-column:1}
.v-app.v-side-hidden .v-side,.v-hub:not(.v-dock-shown) .v-dock{display:flex}
.v-side{position:fixed;left:0;top:0;bottom:0;width:min(320px,86vw);z-index:9;transform:translateX(-104%);transition:transform var(--d-3) var(--ease);box-shadow:var(--shadow3);padding-top:env(safe-area-inset-top);border-right:none}
.v-side.open{transform:none}
.v-side-close{display:inline-flex}
.v-doc{padding-right:52px}
.v-head{height:auto;min-height:52px;padding:6px 8px 6px 6px;padding-top:calc(6px + env(safe-area-inset-top));gap:6px}
.v-doc-meta{display:none}
.v-docbar{flex-direction:column;align-items:stretch;gap:0}
.v-doc-title{font-size:11px;line-height:14px;font-weight:500;color:var(--muted)}
.v-view-line{display:flex;align-items:center;gap:4px;min-width:0}
.v-view-back{display:inline-flex;flex:none;align-items:center;justify-content:center;width:24px;height:24px;margin-left:-4px;color:var(--accent-ink);border-radius:var(--r-xs)}
.v-view-name{font-size:15px;line-height:20px;font-weight:600;letter-spacing:var(--tight);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.v-viewcard,.v-inspecting .v-viewcard{left:8px;top:8px;right:8px;max-width:none;padding:8px 12px;transition:opacity var(--d-2) var(--ease)}
.v-app:not(.v-present) .v-viewcard .v-crumb,.v-app:not(.v-present) .v-viewcard .v-title{display:none}
.v-app:not(.v-present).v-inspecting .v-viewcard,.v-app:not(.v-present) .v-viewcard:has(.v-lede.empty){display:none}
.v-canvas.moving~.v-viewcard{opacity:0;pointer-events:none}
.v-title{font-size:15px}
.v-lede{flex-wrap:nowrap;column-gap:8px}
.v-question{flex:1 1 0;min-width:0;font-size:var(--fs-s);display:block;white-space:nowrap;text-overflow:ellipsis}
.v-question.full{white-space:normal}
.v-lede:has(.v-question.full){flex-wrap:wrap}
.v-tools{gap:4px}
.v-detail,.v-zoom .v-btn:not(.v-keep),.v-btn-label,.v-sep,.v-help-btn{display:none!important}
.v-toolbar{display:none}
.v-present-btn{display:none}
.v-present .v-present-btn{display:inline-flex;width:38px;padding:0}
.v-narrow-only{display:flex}
.v-dock-btn{width:38px;padding:0;position:relative}
.v-dock-btn .v-count{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;font-size:10px;padding:0 4px;box-shadow:0 0 0 2px var(--panel)}
.v-notes{left:0;right:0;width:auto}
.v-panel{left:0;right:0;top:auto;bottom:0;width:auto;max-height:calc(100% - 8px);border-radius:var(--r-xl) var(--r-xl) 0 0;padding:0 18px calc(18px + env(safe-area-inset-bottom));box-shadow:var(--shadow3);transition:height var(--d-3) var(--ease)}
.v-panel.show{animation:v-in var(--d-3) var(--ease)}
.v-panel.peek{overflow:hidden}
.v-panel.dragging{transition:none;overflow:hidden;user-select:none}
.v-panel .grip{display:block;position:sticky;top:0;z-index:1;width:calc(100% + 36px);height:24px;margin:0 -18px 2px;padding:0;border:none;background:var(--raise);cursor:grab;touch-action:none}
.v-panel .grip::before{content:'';display:block;width:40px;height:4px;margin:10px auto 0;border-radius:var(--r-2xs);background:var(--line2)}
.v-panel-head{margin-right:-10px;touch-action:none}
.v-story,.v-inspecting .v-story{left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));width:auto}
.v-story-body{padding:6px 14px 13px 12px}
.v-minimap{display:none!important}
.v-diag{left:8px;right:8px;top:8px;max-width:none}
.v-dock{position:fixed;left:0;right:0;bottom:0;top:auto;height:72%;z-index:9;border-left:none;border-top:none;border-radius:var(--r-xl) var(--r-xl) 0 0;transform:translateY(104%);transition:transform var(--d-3) var(--ease);box-shadow:var(--shadow3);padding-bottom:env(safe-area-inset-bottom)}
.v-dock.open{transform:none}
.v-present .v-viewcard{left:12px;right:12px;top:calc(12px + env(safe-area-inset-top))}
.v-present .v-question{font-size:17px;-webkit-line-clamp:3}
.v-present .v-story{left:8px;right:8px;width:auto}
}
@media ${SHORT}{
.v-head{position:fixed;top:0;left:0;right:0;z-index:6;height:auto;min-height:0;padding:6px calc(8px + env(safe-area-inset-right)) 0 calc(8px + env(safe-area-inset-left));background:none;border:none;pointer-events:none}
.v-head>*{pointer-events:auto}
.v-brand,.v-docbar,.v-tools>:not(.v-dock-btn):not(.v-more){display:none!important}
.v-tools{margin-left:auto}
.v-head .v-btn{height:34px;width:34px;padding:0;border-color:transparent;background:color-mix(in srgb,var(--raise) 88%,transparent);box-shadow:var(--shadow1)}
.v-app:not(.v-present) .v-viewcard{display:none}
.v-story,.v-inspecting .v-story,.v-present .v-story{left:calc(8px + env(safe-area-inset-left));right:calc(8px + env(safe-area-inset-right));bottom:calc(6px + env(safe-area-inset-bottom))}
.v-side{padding-left:env(safe-area-inset-left)}
.v-dock{height:88%;padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}
}
@media print{.v-side,.v-head,.v-viewcard,.v-toolbar,.v-panel,.v-story,.v-minimap,.v-dock,.v-tip,.v-slide,.v-scrim,.v-help,.v-diag{display:none!important}.v-app{display:block;height:auto}.v-main,.v-area{overflow:visible;display:block}.v-canvas{position:static}.v-canvas::before{display:none}.v-stage{position:static;transform:none!important}.v-stage svg{max-width:100%;height:auto}}
`;

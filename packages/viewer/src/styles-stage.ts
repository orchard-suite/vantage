/** The stage: canvas, picture states, inspector, story card, overlays, present mode, help. */
const PLUS = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Cpath d='M24 20.5v7M20.5 24h7' stroke='%23000' stroke-width='1'/%3E%3C/svg%3E")`;

export const STAGE_STYLES = `
@keyframes v-in{from{opacity:0;transform:translateY(6px)}}
@keyframes v-side-in{from{opacity:0;transform:translateX(10px)}}
@keyframes v-pop{from{opacity:0;transform:translateY(-4px) scale(.98)}}
@keyframes v-fade{from{opacity:0}}

.v-area{flex:1;position:relative;overflow:clip;min-height:0}
.v-canvas{position:absolute;inset:0;cursor:grab;touch-action:none;overflow:clip;overscroll-behavior:none}
/* The head and foot bands: the drawing and its prose pass under the view card and end above the story card and toolbar, instead of showing through round them. */
.v-area::before{content:'';position:absolute;left:0;right:0;top:0;height:var(--head,0px);background:linear-gradient(to top,transparent,var(--bg) 20px);pointer-events:none;z-index:2}
.v-area::after{content:'';position:absolute;left:0;right:0;bottom:0;height:var(--foot,0px);background:linear-gradient(to bottom,transparent,var(--bg) 20px);pointer-events:none;z-index:2}
.v-canvas::before{content:'';position:absolute;inset:0;background-color:var(--grid);-webkit-mask:${PLUS} 0 0/48px 48px;mask:${PLUS} 0 0/48px 48px;pointer-events:none}
.v-canvas.dragging{cursor:grabbing}
.v-stage{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
.v-stage svg{display:block}
[data-theme=dark] .v-app[data-pic=light] .v-stage svg,[data-theme=light] .v-app[data-pic=dark] .v-stage svg{filter:invert(.92) hue-rotate(180deg)}
.v-stage svg .v-box{transition:opacity var(--d-3) var(--ease),transform .45s var(--ease)}
.v-stage svg .v-edge,.v-stage svg .v-badge-step{transition:opacity var(--d-3) var(--ease)}
.v-stage svg .v-shape,.v-stage svg .v-edge-line{transition:stroke var(--d-1) var(--ease),stroke-width var(--d-1) var(--ease)}
.v-stage svg .dim{opacity:.16}
[data-theme=dark] .v-stage svg .dim{opacity:.22}
.v-stage svg .hi .v-shape{stroke:var(--hi);stroke-width:2.2px}
.v-stage svg .v-edge.hi .v-edge-line{stroke:var(--hi);stroke-width:2.4px;marker-end:url(#arrow-hi)}
.v-stage svg .v-badge-step.hi circle{stroke:var(--hi);stroke-width:2.5px}
.v-stage svg .v-box{cursor:pointer}
.v-stage svg .v-container .v-name{cursor:zoom-in}
.v-stage svg .v-edge-hit,.v-stage svg .v-badge-step{cursor:pointer}
.v-stage svg .v-box:focus,.v-stage svg .v-edge:focus,.v-stage svg .v-badge-step:focus{outline:none;box-shadow:none}
.v-stage svg .v-box:focus-visible .v-shape{stroke:var(--accent);stroke-width:3px;stroke-dasharray:none}
.v-stage svg .v-edge:focus-visible .v-edge-line{stroke:var(--accent);stroke-width:3px}
.v-stage svg .v-badge-step:focus-visible circle{stroke:var(--accent);stroke-width:3px}

.v-panel{position:absolute;top:12px;right:12px;bottom:12px;width:340px;overflow:auto;background:var(--raise);border:none;border-radius:var(--r-l);padding:16px 18px 22px;box-shadow:var(--shadow2);display:none;z-index:4;overscroll-behavior:contain}
.v-panel.show{display:block;animation:v-side-in var(--d-2) var(--ease)}
.v-panel .grip{display:none}
.v-panel-head{display:flex;align-items:flex-start;gap:8px;margin:-4px -8px 0 0}
.v-panel-titles{flex:1;min-width:0;padding-top:4px}
.v-eyebrow{font:var(--caps);letter-spacing:var(--caps-track);text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.v-panel-name{font-size:17px;line-height:1.3;font-weight:600;margin:0;letter-spacing:var(--tight);overflow-wrap:anywhere}
.v-panel-sub{color:var(--muted);font-size:var(--fs-m);margin-top:2px;overflow-wrap:anywhere}
.v-panel-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.v-value{font:500 var(--fs-3xl)/1.2 var(--mono);margin:14px 0 0;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.v-desc{margin:12px 0 0;font-size:13.5px;line-height:1.55;color:var(--ink2);white-space:pre-wrap;overflow-wrap:anywhere}
.v-note{background:var(--warn-bg);color:var(--warn-ink);border:1px solid var(--warn-line);border-radius:var(--r-m);padding:9px 12px;font-size:var(--fs-s);line-height:1.5;margin:12px 0 0}
.v-sec{margin-top:22px}
.v-sec-h{font:var(--caps);letter-spacing:var(--caps-track);text-transform:uppercase;color:var(--muted);margin:0 0 9px;display:flex;align-items:center;gap:6px}
.v-sec-h .n{font-weight:500;letter-spacing:0;color:var(--faint);font-variant-numeric:tabular-nums}
.v-facts{display:grid;grid-template-columns:minmax(84px,max-content) minmax(0,1fr);gap:7px 14px;margin:0;font-size:var(--fs-s)}
.v-facts dt{color:var(--muted);max-width:140px;overflow-wrap:anywhere}
.v-facts dd{margin:0;font-family:var(--mono);font-size:var(--fs-s);line-height:1.5;color:var(--ink);overflow-wrap:anywhere}
.v-facts dd.wide{grid-column:1/-1;font-family:inherit;font-size:var(--fs-s)}
.v-bullets{margin:0;padding-left:18px;font-size:var(--fs-s);line-height:1.55;color:var(--ink2)}
.v-callout{margin:0 0 6px;font-size:var(--fs-s);line-height:1.5;color:var(--ink2)}
.v-rels{list-style:none;margin:0 -8px;padding:0}
.v-rel{display:flex;align-items:flex-start;gap:10px;width:100%;padding:7px 8px;border:none;border-radius:var(--r-m);background:none;text-align:left;cursor:pointer;transition:background-color var(--d-1) var(--ease)}
.v-rel:hover{background:var(--hover)}
.v-rel-dir{font:600 var(--fs-m)/1.4 var(--mono);color:var(--faint);width:14px;flex:none}
.v-rel-dir.out{color:var(--accent)}
.v-rel-words{display:flex;flex-direction:column;min-width:0}
.v-rel-name{font-weight:500;color:var(--ink);overflow-wrap:anywhere}
.v-rel-label{font-size:var(--fs-s);color:var(--muted)}
.v-also{display:flex;flex-wrap:wrap;gap:6px}
.v-source{margin:0;font-size:var(--fs-s);color:var(--ink2)}
.v-source time{font-family:var(--mono);font-size:var(--fs-s)}

.v-story{position:absolute;left:0;right:0;margin-inline:auto;bottom:16px;width:min(680px,calc(100% - 32px));background:var(--raise);border:none;border-radius:var(--r-l);box-shadow:var(--shadow2);display:none;z-index:3;overflow:hidden}
.v-story.show{display:block;animation:v-in var(--d-2) var(--ease)}
.v-inspecting .v-story{right:364px;width:min(680px,calc(100% - 396px))}
.v-story-rule{height:2px;background:var(--line)}
.v-story-rule i{display:block;height:100%;background:var(--story);transition:width var(--d-3) var(--ease)}
.v-story-head{display:flex;align-items:center;gap:6px;padding:8px 8px 0 14px;min-width:0}
.v-story-label{flex:1;min-width:0;font:var(--caps);letter-spacing:var(--caps-track);text-transform:uppercase;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.v-chips{flex:1;min-width:0;display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:2px 0}
.v-chips::-webkit-scrollbar{display:none}
.v-story-count{font:500 var(--fs-s) var(--mono);color:var(--muted);padding:0 6px;white-space:nowrap;font-variant-numeric:tabular-nums}
.v-start{width:auto;padding:0 8px 0 12px;flex-direction:row-reverse;background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.v-start:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
.v-story-body{display:flex;gap:12px;align-items:flex-start;padding:8px 18px 15px 14px}
.v-story-badge{flex:none;min-width:26px;height:26px;padding:0 6px;border-radius:13px;background:var(--story);color:var(--on-accent);font:600 var(--fs-s)/26px var(--font);text-align:center;margin-top:-2px;font-variant-numeric:tabular-nums}
.v-story-words{min-width:0}
.v-story-title{font-size:var(--fs-l);font-weight:600;line-height:1.4;overflow-wrap:anywhere;letter-spacing:-.005em}
.v-story-text{margin:3px 0 0;font-size:13.5px;line-height:1.55;color:var(--ink2);overflow-wrap:anywhere}
.v-story.folded .v-story-body{display:none}
.v-story.folded .v-story-head{padding-bottom:8px}

.v-empty{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--muted);font-size:var(--fs-l);text-align:center;padding:24px;pointer-events:none}
.v-empty.show{display:flex;animation:v-fade var(--d-3) var(--ease)}
.v-empty .v-ico{color:var(--faint);width:36px;height:36px;padding:8px;border:1px dashed var(--line2);border-radius:var(--r-m);box-sizing:content-box}
.v-empty p{margin:0;max-width:340px;line-height:1.5}
.v-empty-link{pointer-events:auto;color:var(--accent);font-size:var(--fs-m);text-decoration:none;border-bottom:1px solid currentColor}
.v-diag{position:absolute;right:16px;top:16px;max-width:min(560px,calc(100% - 24px));display:flex;gap:10px;align-items:flex-start;background:var(--bad-bg);color:var(--bad-ink);border:1px solid var(--bad-line);border-radius:var(--r-l);padding:10px 6px 10px 12px;z-index:5;box-shadow:var(--shadow2);animation:v-in var(--d-2) var(--ease)}
.v-diag>.v-ico{margin-top:2px}
.v-diag-words{flex:1;min-width:0;font-size:var(--fs-m)}
.v-diag ul{margin:4px 0 0;padding-left:18px;font-size:var(--fs-s);line-height:1.5;max-height:30vh;overflow:auto;overflow-wrap:anywhere}
.v-diag ul li{font-family:var(--mono);font-size:var(--fs-xs)}
.v-diag .v-btn{color:inherit;margin-top:-4px}
.v-diag .v-btn:hover{background:color-mix(in srgb,currentColor 8%,transparent)}
.v-tip{position:absolute;pointer-events:none;background:var(--ink);color:var(--bg);padding:6px 10px;border-radius:var(--r-s);font-size:var(--fs-s);line-height:1.45;max-width:320px;display:none;z-index:7;white-space:pre-wrap;box-shadow:var(--shadow2)}
.v-tip.show{display:block;animation:v-fade var(--d-1) var(--ease)}
.v-minimap{position:absolute;right:16px;bottom:16px;width:180px;height:126px;background:var(--raise);border:none;border-radius:var(--r-m);display:none;cursor:crosshair;box-shadow:var(--shadow2);z-index:2}
.v-minimap.show{display:block}
.v-inspecting .v-minimap{display:none}
.v-slide{position:absolute;right:20px;bottom:20px;font:500 var(--fs-s) var(--mono);color:var(--muted);display:none;font-variant-numeric:tabular-nums}
.v-scrim{position:fixed;inset:0;background:var(--scrim);display:none;z-index:8}
.v-scrim.show{display:block;animation:v-fade var(--d-2) var(--ease)}

.v-help{position:fixed;inset:0;z-index:10;display:none;align-items:center;justify-content:center;background:var(--scrim);padding:16px}
.v-help.show{display:flex;animation:v-fade var(--d-2) var(--ease)}
.v-help-card{background:var(--raise);border:none;border-radius:var(--r-xl);padding:16px 20px 18px;width:min(460px,100%);max-height:100%;overflow:auto;box-shadow:var(--shadow3);animation:v-in var(--d-2) var(--ease)}
.v-help-card:focus{outline:none;box-shadow:var(--shadow3)}
.v-help-head{display:flex;align-items:center;justify-content:space-between;margin:0 -8px 4px 0}
.v-help h2{margin:0;font-size:15px;font-weight:600;letter-spacing:var(--tight)}
.v-help h3{margin:16px 0 8px;font:var(--caps);letter-spacing:var(--caps-track);text-transform:uppercase;color:var(--muted)}
.v-help dl{display:grid;grid-template-columns:150px 1fr;gap:7px 16px;margin:0;align-items:center}
.v-help dt{display:flex;gap:4px;flex-wrap:wrap}
.v-help dd{margin:0;color:var(--ink2)}
.v-help .v-gesture{font-size:var(--fs-s);color:var(--muted)}

.v-present,.v-hub.v-present,.v-present.v-side-hidden,.v-hub.v-present.v-dock-shown{grid-template-columns:minmax(0,1fr);grid-template-rows:0 minmax(0,1fr)}
.v-present .v-main{grid-column:1}
.v-present .v-side,.v-present .v-dock,.v-present .v-diffview,.v-present .v-toolbar{display:none}
.v-present .v-head{position:fixed;top:calc(14px + env(safe-area-inset-top));right:16px;height:auto;padding:0;background:none;border:none}
.v-present .v-head>:not(.v-tools){display:none}
.v-present .v-viewcard{left:28px;top:22px;max-width:min(880px,calc(100% - 180px));padding:0;background:none;box-shadow:none}
.v-present .v-title{font:var(--caps);letter-spacing:var(--caps-track);text-transform:uppercase;color:var(--muted);line-height:1.6}
.v-present .v-question{font-size:22px;line-height:1.35;color:var(--ink);font-weight:600;letter-spacing:-.015em;-webkit-line-clamp:3}
.v-present .v-tools>:not(.v-present-btn){display:none}
.v-present .v-minimap{display:none}
.v-present .v-slide{display:block;top:14px;bottom:auto}
.v-present .v-story{width:min(760px,calc(100% - 48px));bottom:24px}
.v-present .v-story-title{font-size:var(--fs-xl)}
.v-present .v-story-text{font-size:15px}
`;

/**
 * The overview: the document's page over the stage, with its description
 * and a card per view. The stage's own cards and the zoom tools step aside
 * while it shows; the theme and help stay.
 */
import { COMPACT } from './compact.ts';
export const OVERVIEW_STYLES = `
.v-ov{position:absolute;inset:0;z-index:4;display:none;overflow:auto;overscroll-behavior:contain;background:var(--bg);outline:none}
.v-overviewing .v-ov{display:block}
.v-overviewing .v-viewcard,.v-overviewing .v-minimap,.v-overviewing .v-story,.v-overviewing .v-panel{display:none!important}
.v-overviewing .v-canvas{visibility:hidden}
.v-overviewing .v-zoom,.v-overviewing .v-zoom+.v-sep,.v-overviewing .v-detail,.v-overviewing .v-sep-detail{display:none}
.v-present .v-ov{display:none}
.v-ov-page{max-width:1180px;margin:0 auto;padding:36px 40px 120px}
.v-ov-head{margin-bottom:14px}
.v-ov-title{font-size:var(--fs-3xl);line-height:1.2;font-weight:650;letter-spacing:var(--tight);margin:0}
.v-ov-meta{color:var(--muted);font-size:var(--fs-m);margin:6px 0 0}
.v-ov-desc{max-width:760px;color:var(--ink2);padding-bottom:22px;border-bottom:1px solid var(--line)}
.v-ov-count{font:var(--caps);letter-spacing:var(--caps-track);text-transform:uppercase;color:var(--muted);margin:22px 0 4px}
.v-ov-section{margin-top:18px}
.v-ov-group{font-size:var(--fs-xl);font-weight:600;letter-spacing:var(--tight);margin:0 0 12px}
.v-ov-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.v-ov-card{display:flex;flex-direction:column;min-width:0;border:1px solid var(--line);border-radius:var(--r-l);background:var(--panel);overflow:hidden;color:var(--ink);text-decoration:none;box-shadow:var(--shadow);transition:border-color var(--d-1) var(--ease),box-shadow var(--d-1) var(--ease)}
.v-ov-card:hover{border-color:var(--accent);box-shadow:var(--shadow2)}
.v-ov-card:focus-visible{outline:none;box-shadow:var(--ring)}
.v-ov-thumb{height:168px;display:flex;align-items:center;justify-content:center;padding:12px;background:var(--sunken);border-bottom:1px solid var(--line);color:var(--faint)}
.v-ov-thumb img{display:block;max-width:100%;max-height:100%;object-fit:contain}
[data-theme=dark] .v-app[data-pic=light] .v-ov-thumb img,[data-theme=light] .v-app[data-pic=dark] .v-ov-thumb img{filter:invert(.92) hue-rotate(180deg)}
.v-ov-words{padding:12px 14px 14px;min-width:0}
.v-ov-name{display:flex;align-items:baseline;gap:8px;font-weight:600;font-size:var(--fs-l);line-height:1.35}
.v-ov-name>span:first-child{flex:1;min-width:0;overflow-wrap:anywhere}
.v-ov-kind{flex:none;display:inline-flex;align-items:center;gap:4px;font-size:var(--fs-xs);font-weight:500;color:var(--muted);text-transform:capitalize}
.v-ov-q{margin:4px 0 0;color:var(--ink2);font-size:var(--fs-m);line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.v-item-home{margin:6px 8px 0}
@media ${COMPACT}{.v-ov-page{padding:22px 16px 120px}.v-ov-title{font-size:var(--fs-2xl)}.v-ov-grid{grid-template-columns:1fr}}
@media print{.v-ov{position:static;overflow:visible}}
`;

/** The hub dialogs (Export, Share) and the document actions beside Present. They sit on the kit's parts. */
import { COMPACT } from './compact.ts';
export const DIALOG_STYLES = `
.v-hub .v-present-btn:not(.on){background:var(--panel);color:var(--ink);border-color:var(--line);box-shadow:none}
.v-hub .v-present-btn:not(.on):hover{background:var(--hover);border-color:var(--line2)}
.v-share-btn{box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 1px 2px rgba(28,28,26,.14)}
.v-present .v-export-btn,.v-present .v-share-btn{display:none}

.v-dlg-wrap{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--scrim);animation:v-fade var(--d-2) var(--ease)}
.v-dlg-wrap[hidden]{display:none}
.v-dlg{width:100%;max-width:880px;max-height:100%;display:flex;flex-direction:column;background:var(--raise);border-radius:var(--r-xl);box-shadow:var(--shadow3);overflow:hidden;animation:kit-rise var(--d-3) var(--ease)}
.v-dlg-head{display:flex;align-items:flex-start;gap:16px;padding:18px 18px 14px 22px;border-bottom:1px solid var(--line)}
.v-dlg-words{flex:1;min-width:0}
.v-dlg-words h2{margin:0;font-size:17px;line-height:22px;font-weight:600;letter-spacing:var(--tight);overflow-wrap:anywhere}
.v-dlg-words p{margin:3px 0 0;font-size:var(--fs-m);color:var(--muted)}
.v-dlg-body{overflow:auto;min-height:0}
.v-dlg-foot{display:flex;align-items:center;gap:8px;padding:12px 18px 12px 22px;border-top:1px solid var(--line);background:var(--panel)}
.v-dlg-foot-note{margin-right:auto}
.v-dlg-field{display:flex;flex-direction:column;gap:8px;padding:12px 0;border-top:1px solid var(--line)}
.v-dlg-field:first-child{border-top:none;padding-top:0}
.v-dlg-field>.seg{align-self:flex-start}
.v-dlg-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--line)}
.v-dlg-row-words{flex:1;display:flex;flex-direction:column;gap:2px}
.v-dlg-row-label{font-size:var(--fs-m);font-weight:500}

.v-exp{display:grid;grid-template-columns:minmax(220px,260px) minmax(0,1fr)}
.v-exp-formats{display:flex;flex-direction:column;gap:2px;padding:14px 12px;background:var(--panel);border-right:1px solid var(--line)}
.v-exp-group{padding:10px 10px 6px}
.v-exp-group:first-child{padding-top:0}
.v-exp-fmt{display:flex;align-items:center;gap:11px;width:100%;padding:8px 10px;border:1px solid transparent;border-radius:10px;background:none;color:var(--ink);text-align:left;cursor:pointer;transition:background-color var(--d-1) var(--ease),border-color var(--d-1) var(--ease)}
.v-exp-fmt:hover{background:var(--hover)}
.v-exp-fmt[aria-checked=true]{background:var(--raise);border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.v-exp-ext{width:38px;height:36px;flex:none;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;font:600 10px var(--mono);background:var(--sunken);border:1px solid var(--line);color:var(--muted)}
.v-exp-fmt[aria-checked=true] .v-exp-ext{background:var(--accent-soft);border-color:transparent;color:var(--accent-ink)}
.v-exp-fmt-words{display:flex;flex-direction:column;gap:1px;min-width:0}
.v-exp-fmt-words b{font-size:var(--fs-m);font-weight:600}
.v-exp-fmt-words span{font-size:11.5px;line-height:15px;color:var(--muted)}
.v-exp-opts{padding:16px 22px 18px}
.v-exp-note{margin:4px 0 0;padding:10px 12px;border-radius:var(--r-m);background:var(--bg);border:1px solid var(--line);font-size:12.5px;line-height:18px;color:var(--ink2)}

.v-dlg:has(.v-share-tabs){max-width:520px}
.v-share-tabs{padding:0 22px}
.v-share-panel{padding:16px 22px 18px;display:flex;flex-direction:column;gap:12px}
.v-share-lede{margin:0;font-size:13px;line-height:19px;color:var(--ink2)}
.v-share-form{display:flex;flex-direction:column}
.v-share-form .v-dlg-row{border-top:none;padding-top:0}
.v-share-form>.btn{align-self:flex-start;margin-top:6px}
.v-share-url{display:flex;align-items:center;gap:8px;padding:6px 6px 6px 12px;border:1px solid var(--line);border-radius:10px;background:var(--sunken);color:var(--muted)}
.v-share-url code{flex:1;min-width:0;font:500 12px var(--mono);color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.v-share-links{display:flex;flex-direction:column;gap:6px;padding-top:12px;border-top:1px solid var(--line)}
.v-share-link{display:flex;align-items:center;gap:10px;padding:8px 8px 8px 12px;border-radius:var(--r-m);background:var(--panel);border:1px solid var(--line)}
.v-share-link-words{flex:1;display:flex;flex-direction:column;min-width:0}
.v-share-link-words b{font-size:12.5px;font-weight:600}
.v-share-link-words span{font-size:var(--fs-s);color:var(--muted)}
.v-revoke{color:var(--bad-ink)}
.v-revoke:hover{background:var(--bad-bg)}
.v-share-code{margin:0;padding:12px;border-radius:10px;background:var(--sunken);border:1px solid var(--line);font:400 11.5px/18px var(--mono);color:var(--ink2);white-space:pre-wrap;overflow-wrap:anywhere}
.v-share-acts{display:flex;gap:8px}

@media ${COMPACT}{
.v-export-btn{width:38px;padding:0}
.v-share-btn{width:38px;padding:0}
.v-dlg-wrap{align-items:flex-end;padding:0}
.v-dlg{max-width:none;max-height:92%;border-radius:var(--r-xl) var(--r-xl) 0 0}
.v-exp{grid-template-columns:1fr}
.v-exp-formats{border-right:none;border-bottom:1px solid var(--line)}
}
`;

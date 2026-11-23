/** The YAML editor beside the picture: it takes the view list's column, wider, while an author edits; a bottom sheet on a phone. */
export const EDIT_STYLES = `
.v-app.v-editing{grid-template-columns:minmax(360px,40%) minmax(0,1fr)}
.v-hub.v-editing.v-dock-shown{grid-template-columns:minmax(340px,36%) minmax(0,1fr) 360px}
.v-app.v-editing .v-side{display:none}
.v-edit{grid-column:1;grid-row:2;display:flex;flex-direction:column;min-height:0;min-width:0;border-right:1px solid var(--line);background:var(--panel)}
.v-edit-head{display:flex;align-items:center;gap:8px;padding:8px 10px 8px 14px;border-bottom:1px solid var(--line);min-height:48px}
.v-edit-head b{font:var(--caps);letter-spacing:var(--caps-track);text-transform:uppercase;color:var(--muted)}
.v-edit-view{max-width:180px;height:28px}
.v-edit-state{margin-left:auto;font-size:var(--fs-s);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.v-edit-state[data-tone=warn]{color:var(--warn-ink)}
.v-edit-state[data-tone=error]{color:var(--bad-ink)}
.v-edit-score{font:600 var(--fs-xs) var(--mono);padding:3px 7px;border-radius:var(--r-pill);background:var(--sunken);color:var(--muted);white-space:nowrap}
.v-edit-score:empty{display:none}
.v-edit-score[data-tone=ok]{background:var(--ok-bg);color:var(--ok-ink)}
.v-edit-score[data-tone=warn]{background:var(--warn-bg);color:var(--warn-ink)}
.v-edit-score[data-tone=bad]{background:var(--bad-bg);color:var(--bad-ink)}
.v-edit-banner{display:none;padding:10px 14px;border-bottom:1px solid var(--warn-line);background:var(--warn-bg);color:var(--warn-ink);font-size:var(--fs-s)}
.v-edit-banner.show{display:block}
.v-edit-banner p{margin:0 0 8px}
.v-edit-banner p:last-child{margin:0}
.v-edit-code{flex:1;min-height:0;display:flex}
.v-edit-code>.cm-editor{flex:1;min-width:0}
.v-edit-notes{display:flex;flex-direction:column;gap:4px;max-height:28%;overflow:auto;padding:8px 10px;border-top:1px solid var(--line)}
.v-edit-note{display:flex;gap:8px;align-items:baseline;padding:5px 8px;border:none;border-radius:var(--r-s);background:none;color:var(--muted);font:inherit;font-size:var(--fs-s);text-align:left}
button.v-edit-note{cursor:pointer}
button.v-edit-note:hover{background:var(--hover)}
.v-edit-note.bad{color:var(--bad-ink)}
.v-edit-note.warn{color:var(--warn-ink)}
.v-edit-line{font:600 var(--fs-xs) var(--mono);flex:none}
.v-edit-foot{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line)}
.v-edit-message{flex:1;min-width:0;height:32px}
.v-edit-btn[aria-pressed=true]{background:var(--accent-soft);color:var(--accent-ink);border-color:transparent}
@media (max-width:760px){
.v-app.v-editing,.v-hub.v-editing.v-dock-shown{grid-template-columns:minmax(0,1fr)}
.v-edit{position:fixed;left:0;right:0;bottom:0;height:58%;z-index:8;border-right:none;border-top:1px solid var(--line);border-radius:var(--r-xl) var(--r-xl) 0 0;box-shadow:var(--shadow3);padding-bottom:env(safe-area-inset-bottom)}
}
.v-present .v-edit{display:none}
.v-app.v-present.v-editing,.v-hub.v-present.v-editing.v-dock-shown{grid-template-columns:minmax(0,1fr)}
`;

/** Review in the hub viewer: the `@` mention list, the reaction bar and summary in the Comments panel, and the count badges on the stage. */
export const REVIEW_STYLES = `
.v-mention-wrap{position:relative}
.v-mention-wrap .v-text{width:100%}
.v-mention-list{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:5;margin:0;padding:4px;list-style:none;background:var(--panel);border:1px solid var(--line2);border-radius:var(--r-m);box-shadow:var(--shadow2);max-height:220px;overflow:auto}
.v-mention-item{padding:6px 8px;border-radius:var(--r-s);font-size:var(--fs-s);color:var(--ink);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v-mention-item.active,.v-mention-item:hover{background:var(--accent-soft);color:var(--accent-ink)}
.v-mention{font-weight:600;color:var(--accent-ink)}
.v-react{margin-top:10px}
.v-react h3{margin-top:14px}
.v-react-bar{display:flex;gap:6px;flex-wrap:wrap}
.v-react-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px}
.v-react-btn span:empty{display:none}
.v-react-btn[aria-pressed=true]{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-ink)}
.v-react-btn.wrong[aria-pressed=true]{border-color:var(--bad-line);background:var(--bad-bg);color:var(--bad-ink)}
.v-react-btn.question[aria-pressed=true]{border-color:var(--warn-line);background:var(--warn-bg);color:var(--warn-ink)}
.v-react-ask{display:flex;gap:6px;margin-top:6px}
.v-react-ask .v-text{flex:1;min-width:0;height:28px}
.v-react-sum{list-style:none;margin:0;padding:0}
.v-react-sum li{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--line);font-size:var(--fs-s)}
.v-react-sum li:first-child{border-top:none}
.v-react-name{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.v-react-sum li.orphaned .v-react-name{color:var(--muted);text-decoration:line-through}
.v-react-gone{font-size:var(--fs-xs)}
.v-react-counts{display:inline-flex;gap:8px;margin-left:auto}
.v-react-n{display:inline-flex;align-items:center;gap:3px;font:600 var(--fs-xs)/1 var(--font);color:var(--accent-ink)}
.v-react-n.wrong{color:var(--bad-ink)}
.v-react-n.question{color:var(--warn-ink)}
.v-react-layer{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none}
.v-react-badge{position:absolute;transform:translate(calc(-100% - 6px),-50%);pointer-events:auto;display:inline-flex;align-items:center;height:20px;padding:0 7px;border:1px solid var(--line2);border-radius:var(--r-pill);background:var(--panel);box-shadow:var(--shadow);cursor:pointer;white-space:nowrap}
.v-react-badge .v-react-counts{margin-left:0;gap:6px}
.v-react-badge:focus-visible{box-shadow:var(--ring)}
.v-present .v-react-layer{display:none}
@media print{.v-react-layer,.v-dec-layer{display:none}}
.v-dec-layer{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none}
.v-dec-badge{position:absolute;transform:translate(6px,-50%);pointer-events:auto;display:inline-flex;align-items:center;gap:3px;height:20px;padding:0 7px;border:1px solid var(--line2);border-radius:var(--r-pill);background:var(--panel);box-shadow:var(--shadow);color:var(--ink2);font-size:var(--fs-xs);font-weight:600;cursor:pointer;white-space:nowrap}
.v-dec-badge:focus-visible{box-shadow:var(--ring)}
.v-present .v-dec-layer{display:none}
.v-plan-layer{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none}
.v-plan-frame{position:absolute;border-radius:var(--r-m);pointer-events:none}
.v-plan-frame.add{outline:2px dashed var(--accent);outline-offset:3px}
.v-plan-frame.retire{background:repeating-linear-gradient(135deg,transparent 0 7px,color-mix(in srgb,var(--ink2) 14%,transparent) 7px 9px)}
.v-plan-badge{position:absolute;transform:translate(-100%,-50%);pointer-events:auto;height:20px;padding:0 7px;border:1px dashed var(--accent);border-radius:var(--r-pill);background:var(--panel);color:var(--ink2);font-size:var(--fs-xs);font-weight:600;cursor:pointer;white-space:nowrap}
.v-plan-badge:focus-visible{box-shadow:var(--ring)}
.v-plan-switch{position:absolute;right:16px;top:16px;display:inline-flex;gap:2px;padding:2px;border:1px solid var(--line2);border-radius:var(--r-pill);background:var(--panel);box-shadow:var(--shadow);z-index:2}
.v-plan-switch button{height:24px;padding:0 10px;border:0;border-radius:var(--r-pill);background:none;color:var(--ink2);font-size:var(--fs-xs);font-weight:600;cursor:pointer}
.v-plan-switch button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent-ink)}
svg g.v-box.v-ghost{opacity:.28}
.v-plan-count{position:absolute;transform:translate(-50%,-50%);min-width:22px;height:22px;padding:0 6px;border-radius:var(--r-pill);background:var(--accent);color:var(--panel);font:700 var(--fs-xs)/22px var(--mono);text-align:center;box-shadow:var(--shadow)}
.v-plan-count.none{background:var(--sunken);color:var(--muted)}
a.v-work-ref[data-item]{display:inline;text-decoration:none;color:var(--accent-ink)}
a.v-work-ref .v-item-state{margin-left:6px;padding:1px 6px;border-radius:var(--r-pill);background:var(--sunken);font-size:var(--fs-xs);font-weight:600;color:var(--ink2)}
a.v-work-ref[data-class=done] .v-item-state{background:var(--ok-bg);color:var(--ok-ink)}
.v-present .v-plan-layer,.v-present .v-plan-switch{display:none}
@media print{.v-plan-layer,.v-plan-switch{display:none}}
.v-decs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.v-dec{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:baseline;padding:6px 8px;border-radius:var(--r-s);color:inherit;text-decoration:none}
.v-dec:hover{background:var(--sunken)}
.v-dec-ref{font:600 var(--fs-xs) var(--mono);color:var(--muted)}
.v-dec-title{font-size:var(--fs-s);line-height:18px}
.v-dec-status{font-size:var(--fs-xs);color:var(--faint)}
.v-decs .gone .v-dec-title{color:var(--muted);text-decoration:line-through}
a.v-decision[href]{color:var(--accent-ink);text-decoration:underline;text-decoration-color:var(--accent-soft)}
`;

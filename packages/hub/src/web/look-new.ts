/** The ways in on the home page (start tiles, examples, filters) and the new diagram page (new-page.ts). */
export const NEW_CSS = `
.starts{display:flex;flex-direction:column;gap:12px}
.starts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:12px}
.tile .art{height:84px;border-radius:var(--r-m);border:1px solid var(--line);background:var(--sunken);position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;gap:10px}
.tile .words{display:flex;flex-direction:column;gap:2px}
.tile .words b{font-size:13.5px;font-weight:600}
.tile .words span{font-size:12px;line-height:17px;color:var(--muted)}
.art .dash{width:54px;height:34px;border-radius:var(--r-m);border:1.5px dashed var(--line2);display:inline-flex;align-items:center;justify-content:center;color:var(--muted);background:var(--raise)}
.art.code{flex-direction:column;align-items:flex-start;justify-content:flex-start;gap:4px;padding:10px 12px;background:var(--sunken);font:500 10.5px/14px var(--mono);color:var(--muted)}
.art.code .ln{display:block;white-space:nowrap}
.art.code .k{color:var(--violet-stroke)}.art.code .v{color:var(--ink)}.art.code .t{color:var(--emerald-stroke)}
.art.code .caret{display:inline-block;width:6px;height:12px;background:var(--accent);vertical-align:-2px;margin-left:2px}
.art .ext{font:600 10.5px var(--mono);padding:6px 7px;border-radius:var(--r-s);border:1px solid var(--line);background:var(--f-fill);color:var(--f-text)}
.art .ext:first-child{transform:rotate(-6deg)}.art .ext:last-child{transform:rotate(6deg)}
.art .node{width:34px;height:34px;border-radius:var(--r-m);display:inline-flex;align-items:center;justify-content:center;font:600 10px var(--font);background:var(--f-fill);border:1.25px solid var(--f-stroke);color:var(--f-text)}
.art .wire{width:30px;border-top:1.25px dashed var(--edge, var(--line2))}
.art .s{position:absolute;border-radius:var(--r-m);border:1.25px solid var(--f-stroke);background:var(--f-fill)}
.examples{display:flex;flex-direction:column;gap:14px}
.examples .lib-head span{font-size:12.5px;color:var(--muted)}
.ex-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:16px}
.ex-card .art{height:132px}
.ex-card .art{background:var(--bg)}
.ex-card .art img{width:100%;height:100%;object-fit:contain}
.ex-card .words span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ex-card .views{font:500 11px var(--mono);color:var(--faint);margin-top:4px}
.filters{display:flex;gap:8px;flex-wrap:wrap}
.filters select.field{height:28px;border-radius:var(--r-pill);padding:0 28px 0 10px;font-size:var(--fs-s);font-weight:500;background-color:var(--panel);color:var(--ink2);width:auto;max-width:200px}
.filters select.field.on{border-color:var(--accent);color:var(--accent-ink);background-color:var(--accent-soft)}
.new{display:flex;flex-direction:column;gap:18px}
.new [hidden]{display:none!important}
.new-head h1{margin:0;font:700 30px/34px var(--display);letter-spacing:-.02em}
.new-head p{margin:6px 0 0;color:var(--muted);max-width:620px}
.new-from{display:flex;gap:8px;flex-wrap:wrap}
.new-from a{text-decoration:none}
.new-grid{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:16px;align-items:stretch}
.new-edit,.new-prev{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--line);border-radius:var(--r-xl);background:var(--panel)}
.new-meta{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.new-yaml{flex:1;min-height:420px;font:500 12.5px/19px var(--mono);tab-size:2;white-space:pre;overflow:auto}
.new-prev{padding:0;overflow:hidden}
.new-prev .bar2{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line)}
.new-prev .bar2 b{font-size:13px}
.new-prev .bar2 .state{margin-left:auto;font-size:12px;color:var(--muted)}
.new-prev .bar2 select.field{width:auto;max-width:240px;height:28px;font-size:var(--fs-s)}
.new-canvas{flex:1;min-height:420px;display:flex;align-items:center;justify-content:center;padding:16px}
.new-canvas img{max-width:100%;max-height:560px;display:block}
.new-canvas.busy img{opacity:.55;transition:opacity var(--d-2) var(--ease)}
.new-canvas .none-here{text-align:center;max-width:280px}
.new-code{flex:1;min-height:420px;max-height:640px;border:1px solid var(--line);border-radius:var(--r-m);overflow:hidden;display:flex}
.new-code>.cm-editor{flex:1;min-width:0}
.new-code:focus-within{border-color:var(--accent);box-shadow:var(--halo)}
.new-prev .bar2 .score{font:600 11px var(--mono);padding:3px 7px;border-radius:var(--r-pill);background:var(--sunken);color:var(--muted)}
.new-prev .bar2 .score:empty{display:none}
.new-prev .bar2 .score[data-tone=ok]{background:var(--ok-bg);color:var(--ok-ink)}
.new-prev .bar2 .score[data-tone=warn]{background:var(--warn-bg);color:var(--warn-ink)}
.new-prev .bar2 .score[data-tone=bad]{background:var(--bad-bg);color:var(--bad-ink)}
.new-notes button.banner{font:inherit;text-align:left;cursor:pointer;width:100%}
.new-notes .ln{font:600 11px var(--mono);flex:none;padding-top:1px}
.new-notes .note{font-size:12px;color:var(--muted);padding:0 2px}
.new>.seg{align-self:flex-start}
.new-describe{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--line);border-radius:var(--r-xl);background:var(--panel)}
.new-desc{min-height:120px;resize:vertical;font:inherit;line-height:1.5}
.new-paste>summary{cursor:pointer;font-size:12.5px;font-weight:500;color:var(--accent-ink);width:max-content}
.new-paste textarea{min-height:140px;resize:vertical;margin-top:8px}
.new-gen-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.new-gen-row select.field{width:auto;max-width:260px}
.new-gen-row .f-hint{margin:0}
.f-hint.bad{color:var(--bad-ink)}.f-hint.warn{color:var(--warn-ink)}
#new-draft:empty{display:none}
.new-notes{display:flex;flex-direction:column;gap:6px;padding:0 12px 12px}
.new-notes:empty{display:none}
.new-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.new-foot .f-hint{margin-right:auto}
.card-acts{position:absolute;top:8px;right:8px;z-index:2;display:flex;gap:4px;align-items:center}
.star-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:var(--r-pill);border:1px solid var(--line);background:var(--raise);color:var(--faint);cursor:pointer;opacity:0;transition:opacity var(--d-1) var(--ease),color var(--d-1) var(--ease)}
.doc-card:hover .star-btn,.doc-card:focus-within .star-btn,.star-btn[aria-pressed=true],.lrow-wrap .star-btn{opacity:1}
.star-btn:hover{color:var(--ink)}
.star-btn[aria-pressed=true]{color:var(--star);border-color:color-mix(in srgb,var(--star) 40%,var(--line))}
.star-btn[aria-pressed=true] svg{fill:currentColor}
.card-more{position:relative;opacity:0;transition:opacity var(--d-1) var(--ease)}
.doc-card:hover .card-more,.doc-card:focus-within .card-more,.card-more[open]{opacity:1}
.card-more>summary{list-style:none;background:var(--raise);border:1px solid var(--line);width:28px;height:28px;border-radius:var(--r-pill)}
.card-more>summary::-webkit-details-marker{display:none}
.card-more .menu{position:absolute;right:0;top:34px;z-index:5}
.lrow-wrap{display:flex;align-items:center;border-top:1px solid var(--line)}
.lrow-wrap .lrow{flex:1;min-width:0;border-top:none}
.lrow-wrap:hover{background:var(--hover)}
.lrow-wrap .star-btn{flex:none;margin-right:10px;border-color:transparent;background:none}
.lrow-wrap .card-more{flex:none;opacity:1}
.lrow-wrap .card-more>summary{border-color:transparent;background:none}
.del-ask{width:240px;padding:8px 10px;font-size:var(--fs-s);color:var(--ink)}
.del-ask p{margin:0 0 10px}
.del-acts{display:flex;justify-content:flex-end;gap:6px}
.rows>.lrow.head{padding-right:54px}
.folders{display:flex;flex-direction:column;gap:10px;margin-bottom:-12px}
.folder-chips{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.folder-chips .chip{text-decoration:none}
.folder-chips .chip .n{font:500 var(--fs-xs) var(--mono);color:var(--faint)}
.new-folder{position:relative}
.new-folder>summary{list-style:none;border-style:dashed}
.new-folder>summary::-webkit-details-marker{display:none}
.new-folder .inline-form{position:absolute;left:0;top:34px;z-index:5;padding:10px;border-radius:var(--r-l);background:var(--raise);box-shadow:var(--shadow3);width:300px}
.inline-form{display:flex;gap:8px;align-items:center}
.inline-form .field{height:30px}
.folder-manage{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.folder-manage .inline-form .field{width:220px}
.invite{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.invite input.field{flex:1 1 260px;max-width:380px}
.invite select.field{width:auto}
.sub-head{margin:24px 0 8px;font-size:14px;font-weight:600}
.mem-row .btn{flex:none}
.mem-row select.field{flex:none;width:auto}
@media (max-width:640px){.star-btn,.card-more{opacity:1}.starts-grid{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:168px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:4px;margin:0 -16px;padding-left:16px;padding-right:16px}.starts-grid .tile{scroll-snap-align:start}.starts-grid .tile:hover{transform:none}.tile .art{height:68px}}
@media (max-width:900px){.new-grid{grid-template-columns:1fr}.new-yaml,.new-code{min-height:300px}.new-canvas{min-height:280px}.new-meta{grid-template-columns:1fr}}
`;

/**
 * The admin console's look: the deployment map, the disk bar, the ranked
 * lists that turn into cards on a phone, the access grid, and the rows for
 * connectors and publications. Colors come from the tokens: a workspace's
 * kind sets its tile, a kind of byte sets its stripe of the disk bar.
 */
export const ADMIN_CSS = `
.wrap:has(>.adm){max-width:1440px}
.adm{display:flex;flex-direction:column;gap:20px;min-width:0}
.adm .crumbs a::after{content:"/";margin-left:6px;color:var(--faint)}
.adm-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px 24px;flex-wrap:wrap}
.adm-head h1{margin:0;font-size:var(--fs-3xl);line-height:1.15;font-weight:600;letter-spacing:var(--tight);display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.adm-head h1 .pill{font-size:var(--fs-s);letter-spacing:0}
.adm-meta{margin:6px 0 0;color:var(--muted);font-size:var(--fs-m)}
.adm-sum{margin:0;font-size:var(--fs-xl);line-height:1.55;color:var(--ink2);max-width:76ch}
.adm-head .adm-sum{margin-top:6px}
.adm-sum b{color:var(--ink);font-weight:600}
.adm-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.adm-find{display:flex;gap:6px}
.adm-find .field{width:300px;max-width:100%}
.adm-person{display:flex;align-items:center;gap:14px}
.avatar.big{width:48px;height:48px;font-size:15px;margin:0}
.a-num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.bad-ink{color:var(--bad-ink);font-weight:600}
.dk-renders{background:var(--path-blue)}.dk-history{background:var(--path-violet)}.dk-observed{background:var(--path-teal)}.dk-audio{background:var(--path-amber)}.dk-icons{background:var(--path-slate)}
.disk{display:flex;height:8px;border-radius:var(--r-pill);overflow:hidden;background:var(--well);min-width:40px}
.disk>i{display:block;height:100%;min-width:2px}
.disk>i+i{box-shadow:inset 1px 0 0 var(--panel)}
.adm-disk .disk{height:12px}
.disk-key{display:flex;flex-wrap:wrap;gap:4px 18px;margin:8px 0 0;font-size:var(--fs-s);color:var(--muted)}
.disk-key i{display:inline-block;width:9px;height:9px;border-radius:var(--r-2xs);margin-right:6px;vertical-align:-1px}
.disk-key b{font:500 var(--fs-s) var(--mono);color:var(--ink2)}
.attn{display:flex;flex-wrap:wrap;gap:8px;margin:0}
.attn a.pill{text-decoration:none;font-size:var(--fs-s);padding:3px 10px}
.adm-sec{display:flex;flex-direction:column;gap:8px;min-width:0}
.sec{margin:8px 0 0;font-size:var(--fs-xl);font-weight:600;letter-spacing:var(--tight);display:flex;align-items:center;gap:8px}
.sec-note{margin:0 0 4px;color:var(--muted);font-size:var(--fs-m);max-width:80ch}
.none-line{margin:0;padding:12px 14px;border:1px dashed var(--line2);border-radius:var(--r-m);color:var(--muted);font-size:var(--fs-m)}

.tone-team{--tone:var(--path-blue)}
.tone-personal{--tone:var(--path-slate)}
.tone-off{--tone:var(--bad-ink)}
.tone-doc{--tone:var(--path-violet)}
.a-dot{display:inline-block;flex:none;width:8px;height:8px;border-radius:50%;background:var(--tone)}
.a-map{position:relative;width:100%;border-radius:var(--r-l);background:var(--well);overflow:hidden}
.a-tile{position:absolute;display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:10px 12px;border:2px solid var(--bg);border-radius:var(--r-ml);overflow:hidden;color:var(--ink);text-decoration:none;font-size:var(--fs-s);line-height:1.35}
.a-tile.team{background:color-mix(in srgb,var(--path-blue) 20%,var(--panel))}
.a-tile.personal{background:color-mix(in srgb,var(--path-slate) 18%,var(--panel))}
.a-tile.off{background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--bad-bg) 70%,var(--panel)) 0 3px,var(--panel) 3px 12px)}
.a-tile.doc{background:color-mix(in srgb,var(--path-violet) 16%,var(--panel))}
.a-tile:hover{box-shadow:inset 0 0 0 2px var(--accent)}
.a-tile:focus-visible{box-shadow:inset 0 0 0 2px var(--accent)}
.t-name{font-size:var(--fs-m);font-weight:600;line-height:1.3}
.t-line{color:var(--ink2);white-space:nowrap}
.t-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:auto;padding-top:4px}
.map-tall{display:none}
.map-key{display:flex;flex-wrap:wrap;gap:4px 16px;margin:0;font-size:var(--fs-s);color:var(--muted)}
.map-key i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:0;background:var(--tone)}

.a-table{border:1px solid var(--line);border-radius:var(--r-l);background:var(--panel)}
.a-table>.a-head{border-radius:var(--r-l) var(--r-l) 0 0}
.a-rows>li:first-child>.a-row{border-radius:var(--r-l) var(--r-l) 0 0}
.a-head+.a-rows>li:first-child>.a-row{border-radius:0}
.a-rows>li:last-child>.a-row{border-radius:0 0 var(--r-l) var(--r-l)}
.a-rows{list-style:none;margin:0;padding:0}
.a-rows>li+li{border-top:1px solid var(--line)}
.a-head{padding:8px 16px;border-bottom:1px solid var(--line);font:var(--caps);letter-spacing:var(--caps-track);text-transform:uppercase;color:var(--faint)}
.a-head>span:not(:first-child):not(:nth-child(2)){text-align:right}
.a-row,.drow{display:grid;align-items:center;gap:6px 16px;padding:12px 16px;color:inherit;text-decoration:none}
a.a-row:hover{background:var(--hover)}
.ws-cols,.p-cols{display:grid;grid-template-columns:minmax(0,2.6fr) minmax(150px,1.3fr) repeat(3,minmax(64px,.45fr)) minmax(96px,.6fr);column-gap:16px}
.p-cols{grid-template-columns:minmax(0,2.6fr) minmax(150px,1.3fr) repeat(4,minmax(64px,.45fr))}
.d-cols{display:grid;grid-template-columns:minmax(0,2.4fr) minmax(130px,1.1fr) repeat(4,minmax(58px,.4fr)) minmax(130px,.9fr) minmax(84px,.5fr) 84px;column-gap:18px}
.m-cols{grid-template-columns:minmax(0,2.4fr) auto minmax(0,1.4fr) minmax(80px,.5fr)}
.a-row>.a-num,.drow>.a-num,.a-row>.l-when,.drow>.l-when,.drow>[data-k=reaches]{text-align:right}
.drow>[data-k=reaches]{font-size:var(--fs-s);color:var(--ink2)}
.drow>.a-num{white-space:nowrap}
.l-name{display:flex;flex-direction:column;gap:2px;min-width:0}
.l-name b{font-weight:600;display:flex;align-items:center;gap:8px;overflow-wrap:anywhere}
.l-person{flex-direction:row;align-items:center;gap:12px}
.l-person>span{display:flex;flex-direction:column;gap:2px;min-width:0}
.l-person .avatar{margin:0}
.l-sub{font-size:var(--fs-s);color:var(--muted);overflow-wrap:anywhere}
.l-marks{display:flex;flex-wrap:wrap;gap:4px}
.l-marks:empty{display:none}
.l-disk{display:grid;grid-template-columns:1fr auto;align-items:center;gap:10px}
.l-disk .a-num{font-size:var(--fs-s);min-width:56px;text-align:right}
.l-when{font-size:var(--fs-s);color:var(--muted);white-space:nowrap}
.row-menu{position:relative;justify-self:end}
.row-menu>summary{list-style:none}
.row-menu>summary::-webkit-details-marker{display:none}
.row-pop{position:absolute;right:0;top:calc(100% + 6px);z-index:5;display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:12px;border-radius:var(--r-m);background:var(--raise);box-shadow:var(--shadow2);width:280px}
.admin-move{display:flex;flex-wrap:wrap;gap:6px;align-items:center;width:100%}
.admin-move label{flex-basis:100%;font-size:var(--fs-s);color:var(--muted)}
.admin-move select.field{flex:1;min-width:0;height:28px;font-size:var(--fs-s)}

.flow-cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}
.flow-cols>section{display:flex;flex-direction:column;gap:8px;min-width:0}
.flows{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:var(--r-l);background:var(--panel)}
.flow{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;padding:14px 16px}
.flow+.flow{border-top:1px solid var(--line)}
.flow .src-badge{width:36px;height:36px;grid-row:span 2}
.flow-what{display:flex;flex-direction:column;gap:2px;min-width:0;font-size:var(--fs-m)}
.flow-what>span{color:var(--muted);overflow-wrap:anywhere}
.flow-what code,.access code{font:500 var(--fs-s) var(--mono);color:var(--ink2)}
.flow-side{grid-column:2;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px}
.flow-acts{display:flex;gap:6px;margin-left:auto}
.flow-set summary{cursor:pointer;color:var(--accent-ink);font-size:var(--fs-s);font-weight:500;margin-top:4px;width:max-content}
.flow-set dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:2px 10px;margin:6px 0 0;font-size:var(--fs-s)}
.flow-set dt{color:var(--muted)}
.flow-set dd{margin:0;overflow-wrap:anywhere}

.rules{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:0;border:1px solid var(--line);border-radius:var(--r-l);overflow:hidden;background:var(--panel)}
.rules>div{padding:12px 14px;box-shadow:0 0 0 .5px var(--line)}
.rules dt{font:var(--caps);letter-spacing:var(--caps-track);text-transform:uppercase;color:var(--faint);margin-bottom:4px}
.rules dd{margin:0;font-size:var(--fs-m)}
.grid-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--r-l);background:var(--panel)}
.access{width:100%;border-collapse:collapse;font-size:var(--fs-m)}
.access th,.access td{padding:10px 14px;border-bottom:1px solid var(--line);text-align:center;vertical-align:middle}
.access tbody tr:last-child>*{border-bottom:0}
.access thead th{font:var(--caps);letter-spacing:var(--caps-track);text-transform:uppercase;color:var(--faint);font-weight:600;line-height:1.35}
.access th:first-child{text-align:left}
.access tbody th{font-weight:400}
.a-who{display:flex;align-items:center;gap:10px}
.a-who .avatar{margin:0}
.a-who>span{display:flex;flex-direction:column}
.can{font-size:var(--fs-s);font-weight:600}
.can.yes{color:var(--ok-ink)}.can.no{color:var(--faint);font-weight:400}.can.own{color:var(--warn-ink)}
.recent,.found{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:var(--r-l);background:var(--panel)}
.recent>li,.found>li{display:grid;grid-template-columns:110px minmax(0,1fr) auto;gap:4px 16px;padding:10px 16px;font-size:var(--fs-m);align-items:baseline}
.found>li{grid-template-columns:minmax(0,1fr);gap:2px}
.found>li>span{color:var(--muted);font-size:var(--fs-s)}
.recent>li+li,.found>li+li{border-top:1px solid var(--line)}
.admin-pub{align-items:flex-start}
.admin-pub .pub-what span{display:block}
.admin-acts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;margin-left:auto}

@media (max-width:1100px){
.d-cols{grid-template-columns:minmax(0,2fr) minmax(120px,1fr) repeat(3,minmax(48px,.4fr)) 84px}
.d-cols>[data-k=score],.d-cols>[data-k=reaches],.d-cols>.l-when{display:none}
.flow-cols{grid-template-columns:1fr}
}
@media (max-width:820px){
.rules{grid-template-columns:1fr}
.a-head{display:none}
.a-row,.drow{grid-template-columns:repeat(4,minmax(0,1fr));gap:8px 12px}
.a-row>.l-name,.drow>.l-name,.a-row>.l-disk,.drow>.l-disk{grid-column:1/-1}
.a-row>.a-num,.drow>.a-num,.a-row>.l-when,.drow>.l-when,.drow>[data-k=reaches]{display:flex!important;flex-direction:column;text-align:left;font-size:var(--fs-m)}
.a-row>[data-k]::before,.drow>[data-k]::before{content:attr(data-k);font:var(--caps);letter-spacing:var(--caps-track);text-transform:uppercase;color:var(--faint);margin-bottom:2px}
.drow>.row-menu{grid-column:1/-1;justify-self:start}
.row-pop{left:0;right:auto}
.m-cols{grid-template-columns:auto minmax(0,1fr)}
.m-cols>.l-name{grid-column:1/-1}
.recent>li{grid-template-columns:1fr}
.adm-find,.adm-find .field{width:100%;flex:1}
.adm-tools{width:100%}
.access thead{display:none}
.access,.access tbody,.access tr{display:block}
.access tr{padding:10px 14px;border-bottom:1px solid var(--line)}
.access tbody tr:last-child{border-bottom:0}
.access th,.access td{display:flex;justify-content:space-between;gap:12px;padding:4px 0;border:0;text-align:left}
.access td::before{content:attr(data-k);color:var(--muted);font-size:var(--fs-s)}
.access tbody th{padding-bottom:8px}
}
@media (max-width:600px){
.adm-head h1{font-size:var(--fs-2xl)}
.adm-sum{font-size:var(--fs-l)}
.map-wide{display:none}.map-tall{display:block}
.a-row,.drow{grid-template-columns:repeat(2,minmax(0,1fr))}
.flow-acts{margin-left:0}
.attn a.pill,.adm-tools .btn,.flow-acts .btn,.row-menu .btn{min-height:36px}
.adm .crumbs a,.adm .link{display:inline-flex;align-items:center;min-height:24px}
}
`;

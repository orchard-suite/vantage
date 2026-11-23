/** The decision records: the registry list on the workspace page and the page of one record (decisions-page.ts). */
export const DECISIONS_CSS = `
.reg-bar{display:flex;flex-direction:column;gap:10px;margin-bottom:14px}
.reg-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.reg-filters .chip{text-decoration:none}
.reg-filters .chip .n{font:500 var(--fs-xs) var(--mono);color:var(--faint)}
.reg-filters .sep{width:1px;height:20px;background:var(--line);margin:0 4px}
.reg-search{display:flex;gap:8px;align-items:center;max-width:420px}
.reg-search .field{flex:1;height:30px}
.dec-row{display:grid;grid-template-columns:92px 1fr auto auto;align-items:center;gap:14px;padding:11px 16px;border-top:1px solid var(--line);color:inherit;text-decoration:none}
.dec-row:first-child{border-top:none}
.dec-row:hover{background:var(--sunken)}
.dec-row .ref{font:600 var(--fs-s) var(--mono);color:var(--muted)}
.dec-row .t{display:flex;flex-direction:column;gap:2px;min-width:0}
.dec-row .t b{font-weight:600;font-size:13.5px}
.dec-row .t span{font-size:12px;color:var(--muted)}
.dec-row time{font:500 var(--fs-xs) var(--mono);color:var(--faint)}
.dec-row.gone .t b{color:var(--muted)}
@media (max-width:640px){.dec-row{grid-template-columns:80px 1fr}.dec-row time,.dec-row .pill{grid-column:2}}
.dec-page{display:flex;flex-direction:column;gap:18px;max-width:860px}
.dec-head{display:flex;flex-direction:column;gap:10px}
.dec-head h1{margin:0;font-size:22px;line-height:28px;letter-spacing:var(--tight)}
.dec-head .ref{font:600 var(--fs-s) var(--mono);color:var(--muted)}
.dec-meta{display:flex;flex-wrap:wrap;gap:1px;border:1px solid var(--line);border-radius:var(--r-l);background:var(--line);overflow:hidden}
.dec-meta div{flex:1 1 190px;display:flex;flex-direction:column;gap:3px;padding:10px 14px;background:var(--panel)}
.dec-meta .caps{color:var(--faint)}
.dec-meta b{font-weight:500;font-size:13px;overflow-wrap:anywhere}
.dec-meta code{font:500 var(--fs-xs) var(--mono);overflow-wrap:anywhere}
.dec-body{max-width:760px;font-size:14px;line-height:22px}
.dec-body>h2:first-child{margin-top:4px}
.dec-body h2{margin:26px 0 8px;font-size:16px;font-weight:600;letter-spacing:var(--tight)}
.dec-body h3{margin:18px 0 6px;font-size:14px;font-weight:600}
.dec-body p,.dec-body ul,.dec-body ol{margin:0 0 10px}
.dec-body code{font:500 0.92em var(--mono);padding:1px 4px;border-radius:var(--r-xs);background:var(--sunken)}
.dec-body pre{padding:10px 12px;border-radius:var(--r-m);background:var(--sunken);overflow:auto}
.dec-body pre code{padding:0;background:none}
.dec-body .v-table{overflow-x:auto}
.dec-body table{border-collapse:collapse;font-size:13px}
.dec-body th,.dec-body td{border:1px solid var(--line);padding:6px 10px;text-align:left}
.dec-body .none{color:var(--faint)}
.dec-body a{color:var(--accent)}
.dec-alt{border-left:2px solid var(--line2);padding-left:14px;margin:0 0 14px}
.dec-links{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.dec-links a{color:var(--accent);text-decoration:none}
`;

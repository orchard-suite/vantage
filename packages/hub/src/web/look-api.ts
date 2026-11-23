/**
 * The API page (api-page.ts): the head with the addresses to copy, three
 * short facts, then the groups beside a sticky list of them. Each endpoint
 * is a row that opens to its fields. Parts shared with other pages come
 * from the kit; this is layout only.
 */
export const API_CSS = `
.api-head{display:flex;flex-wrap:wrap;align-items:flex-end;gap:24px;margin-bottom:-8px}
.api-words{flex:1 1 min(420px,100%);min-width:0;display:flex;flex-direction:column;gap:8px}
.api-words h1{margin:0;font:700 32px/36px var(--display);letter-spacing:-.02em}
.api-words p{margin:0;max-width:620px;font-size:var(--fs-l);line-height:21px;color:var(--muted)}
.api-ver{font-size:var(--fs-xs);color:var(--faint)}
.api-links{flex:1 1 min(380px,100%);min-width:0;max-width:520px;display:flex;flex-direction:column;gap:10px}
.api-url{display:flex;flex-direction:column;gap:5px}
.api-url .url{display:flex;align-items:center;gap:6px;padding:4px 4px 4px 10px;border-radius:var(--r-m);background:var(--sunken);border:1px solid var(--line)}
.api-url code{flex:1;min-width:0;font:500 var(--fs-s) var(--mono);color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.api-url .btn.sm:not(.icon){height:28px}
.api-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.api-facts>div{display:flex;flex-direction:column;gap:6px;padding:14px 16px;border:1px solid var(--line);border-radius:var(--r-l);background:var(--panel)}
.api-facts b{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600}
.api-facts b svg{color:var(--muted)}
.api-facts p{margin:0;font-size:var(--fs-m);line-height:19px;color:var(--ink2)}
.api-facts code,.api-fields code{font:500 var(--fs-s) var(--mono);padding:1px 5px;border-radius:var(--r-xs);background:var(--sunken);border:1px solid var(--line)}
.api-facts a{color:var(--accent-ink);text-underline-offset:2px}
.api-body{display:grid;grid-template-columns:220px minmax(0,1fr);gap:32px;align-items:start}
.api-toc{position:sticky;top:88px;display:flex;flex-direction:column;gap:12px;max-height:calc(100vh - 112px);overflow:auto}
.api-toc .well{height:36px}
.api-groups{display:flex;flex-direction:column;gap:36px;min-width:0}
.api-group{scroll-margin-top:84px;display:flex;flex-direction:column;gap:12px}
.api-group header h2{margin:0;font-size:var(--fs-xl);line-height:22px;font-weight:600;letter-spacing:var(--tight)}
.api-group header p{margin:3px 0 0;font-size:var(--fs-m);line-height:19px;color:var(--muted)}
.api-ops{border:1px solid var(--line);border-radius:var(--r-l);background:var(--panel);overflow:hidden}
.api-op{scroll-margin-top:84px;border-top:1px solid var(--line)}
.api-op:first-child{border-top:none}
.api-op>summary{list-style:none;display:grid;grid-template-columns:64px minmax(0,auto) auto minmax(0,1fr) 14px;align-items:center;gap:6px 12px;padding:11px 14px;cursor:pointer;transition:background-color var(--d-1) var(--ease)}
.api-op>summary::-webkit-details-marker{display:none}
.api-op>summary:hover{background:var(--hover)}
.api-op>summary>svg{color:var(--faint);transition:transform var(--d-2) var(--ease)}
.api-op[open]>summary>svg{transform:rotate(180deg)}
.api-op[open]>summary{background:var(--bg)}
.api-m{display:inline-flex;align-items:center;justify-content:center;height:22px;border-radius:var(--r-s);font:700 10.5px var(--mono);letter-spacing:.04em;background:var(--f-fill);color:var(--f-text);border:1px solid var(--f-stroke)}
.api-path{font:600 var(--fs-m) var(--mono);color:var(--ink);overflow-wrap:anywhere}
.api-var{color:var(--accent-ink)}
.api-role{background:var(--f-fill);color:var(--f-text);border-color:transparent}
.api-sum{font-size:var(--fs-m);line-height:19px;color:var(--ink2);min-width:0}
.api-detail{display:flex;flex-direction:column;gap:12px;padding:4px 14px 14px 90px;background:var(--bg)}
.api-detail .f-hint{margin:0}
.api-fields{display:flex;flex-direction:column;gap:6px}
.api-fields dl{display:grid;grid-template-columns:minmax(0,180px) minmax(0,1fr);gap:6px 14px;margin:0;font-size:var(--fs-m);line-height:19px}
.api-fields dt{min-width:0}
.api-fields dd{margin:0;color:var(--ink2);overflow-wrap:anywhere}
@media (max-width:1020px){.api-op>summary{grid-template-columns:64px minmax(0,1fr) auto 14px}.api-sum{grid-column:2/4}.api-op>summary>svg{grid-row:1;grid-column:4}}
@media (max-width:760px){.api-body{grid-template-columns:1fr}.api-toc{position:static;max-height:none}.api-toc .nav{display:none}.api-words h1{font-size:26px;line-height:30px}.api-detail{padding-left:14px}.api-fields dl{grid-template-columns:minmax(0,120px) minmax(0,1fr)}.api-op>summary{grid-template-columns:56px minmax(0,1fr) 14px}.api-role{grid-column:2;justify-self:start}.api-sum{grid-column:1/4}.api-op>summary>svg{grid-column:3}}
`;

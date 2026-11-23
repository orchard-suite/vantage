/**
 * The signed in app frame: the sidebar, the top bar, and the home page's
 * library (cards, list rows, search results, the first run state). Parts
 * shared with the viewer come from the kit; this is layout only.
 */
export const APP_CSS = `
.app{display:flex;flex-wrap:wrap;min-height:100vh;min-height:100dvh;background:var(--bg)}
.side{flex:0 0 256px;width:256px;position:sticky;top:0;height:100vh;height:100dvh;overflow:auto;display:flex;flex-direction:column;gap:18px;padding:18px 12px 14px;background:var(--panel);border-right:1px solid var(--line)}
.side-top{display:flex;align-items:center;justify-content:space-between}
.side .brand{padding:4px 8px}
.side-close,.menu-btn,.bar-brand,.scrim{display:none}
.side-sec{display:flex;flex-direction:column;gap:2px}
.side-sec>.caps{padding:0 10px 6px}
.new-ws>summary{list-style:none;display:flex;align-items:center;gap:10px;height:34px;padding:0 10px;border-radius:var(--r-m);color:var(--muted);font:500 var(--fs-m) var(--font);cursor:pointer}
.new-ws>summary::-webkit-details-marker{display:none}
.new-ws>summary:hover,.new-ws[open]>summary{background:var(--hover);color:var(--ink)}
.new-ws form{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:8px 10px 4px}
.new-ws .field{width:100%;height:30px}
.new-ws .f-hint{margin:0}
.ws-tile{width:18px;height:18px;flex:none;border-radius:var(--r-xs);display:inline-flex;align-items:center;justify-content:center;font:600 10px/1 var(--font);background:var(--f-fill);color:var(--f-text);border:1px solid var(--line)}
.nav .label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.agent{margin-top:auto;display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:var(--r-l);border:1px solid var(--line);background:var(--bg)}
.agent b{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600}
.agent b svg{color:var(--muted)}
.agent p{margin:0;font-size:var(--fs-s);line-height:17px;color:var(--muted)}
.agent .way{display:flex;flex-direction:column;gap:6px;padding-top:10px;border-top:1px solid var(--line)}
.agent .way-name{font-size:12.5px;font-weight:500;color:var(--ink)}
.agent .way .btn{align-self:flex-start}
.url{display:flex;align-items:center;gap:6px;padding:4px 4px 4px 8px;border-radius:var(--r-m);background:var(--sunken);border:1px solid var(--line)}
.url code{flex:1;min-width:0;font:500 11px var(--mono);color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.url.run code{white-space:normal;overflow-wrap:anywhere;line-height:16px;padding:3px 0}
.me-menu{position:relative}
.me{list-style:none;display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:var(--r-m);cursor:pointer;transition:background-color var(--d-1) var(--ease)}
.me::-webkit-details-marker{display:none}
.me:hover,.me-menu[open]>.me{background:var(--hover)}
.me .who{flex:1;display:flex;flex-direction:column;min-width:0}
.me .who b{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.me .who span{font-size:11.5px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.me>svg{flex:none;color:var(--faint)}
.me-pop{position:absolute;left:0;right:0;bottom:calc(100% + 6px);z-index:10}
.me-look{display:flex;flex-direction:column;gap:6px;padding:6px 10px 8px}
.theme-pick{display:flex}
.theme-pick>button{flex:1;justify-content:center;padding:0 6px}
.me-pop .release{margin:0;padding:6px 10px 2px;font:500 10.5px var(--mono);color:var(--faint)}
.acct-head{display:flex;align-items:center;gap:16px}
.acct-head .avatar.lg{width:56px;height:56px;font-size:18px}
.acct-head h1{margin:0;font:700 28px/32px var(--display);letter-spacing:-.02em}
.acct-head p{margin:4px 0 0;color:var(--muted)}
.acct-sec{display:flex;flex-direction:column;gap:14px;max-width:760px;padding:20px;border:1px solid var(--line);border-radius:var(--r-l);background:var(--panel)}
.acct-sec>header h2{margin:0;font-size:16px;line-height:22px;font-weight:600;letter-spacing:var(--tight)}
.acct-sec>header p{margin:4px 0 0;font-size:var(--fs-m);line-height:20px;color:var(--muted)}
.acct-sec>.url code{font-size:12px}
.tk-make{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.tk-make input{flex:1 1 260px;width:auto;height:32px}
.tk-make select{flex:none;width:auto;height:32px}
.tk-make .f-hint{flex-basis:100%;margin:0}
.tk-new{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:var(--r-m);background:var(--bg);border:1px solid var(--line)}
.tk-new b{display:flex;align-items:center;gap:8px;font-size:var(--fs-m);font-weight:500}
.tk-new .url code{white-space:normal;overflow-wrap:anywhere;font-size:12px}
.tk-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.tk-list li{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:2px 12px;padding:10px 0;border-top:1px solid var(--line)}
.tk-list li:first-child{border-top:none}
.tk-name{display:flex;align-items:center;gap:8px;min-width:0;font-size:var(--fs-m)}
.tk-name svg{flex:none;color:var(--muted)}
.tk-name b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tk-when{grid-column:1;font-size:var(--fs-s);color:var(--faint)}
.tk-list .btn{grid-column:2;grid-row:1/span 2}
.tk-list .btn.bad{color:var(--bad-ink)}
.app-main{flex:1 1 560px;min-width:0;display:flex;flex-direction:column}
.bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 40px;background:var(--panel);border-bottom:1px solid var(--line)}
.bar form{flex:1 1 320px;max-width:620px;display:flex}
.bar .well{flex:1}
.bar .tools{margin-left:auto;display:flex;align-items:center;gap:8px}
.wrap{width:100%;max-width:1240px;margin:0 auto;padding:32px 40px 64px;display:flex;flex-direction:column;gap:32px}
.hello h1{margin:0;font:700 32px/36px var(--display);letter-spacing:-.02em}
.hello p{margin:6px 0 0;font-size:var(--fs-l);line-height:21px;color:var(--muted)}
.lib{display:flex;flex-direction:column;gap:16px}
.lib-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.lib-head h2{margin:0;font-size:16px;line-height:22px;font-weight:600;letter-spacing:var(--tight)}
.lib-head .tools{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cards{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:16px}
.doc-card .thumb img{padding:10px;object-fit:contain}
.doc-card .thumb.none{display:flex;align-items:center;justify-content:center;color:var(--faint)}
.doc-card .thumb.none svg{width:auto;height:auto;opacity:.5}
.doc-card .thumb .pill{position:absolute;left:10px;bottom:10px;z-index:1}
.doc-card .foot{display:flex;align-items:center;gap:8px}
.doc-card .foot .when{margin-left:2px}
.doc-card .avatar{width:22px;height:22px;font-size:9.5px}
.rows{border:1px solid var(--line);border-radius:var(--r-l);background:var(--panel);overflow:hidden}
.lrow{position:relative;display:grid;grid-template-columns:minmax(0,2.4fr) minmax(0,1.4fr) 70px minmax(0,1.2fr) 110px;align-items:center;gap:16px;min-height:52px;padding:0 16px;border-top:1px solid var(--line);color:var(--ink);text-decoration:none;font-size:var(--fs-m);transition:background-color var(--d-1) var(--ease)}
.lrow:first-child{border-top:none}
.lrow:hover{background:var(--hover)}
.lrow.head{min-height:38px;background:var(--bg)}
.lrow.head span{font:var(--caps);letter-spacing:var(--caps-track);text-transform:uppercase;color:var(--muted)}
.lrow .nm{display:flex;align-items:center;gap:12px;min-width:0;font-weight:600}
.lrow .nm span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lrow .mini{width:44px;height:30px;flex:none;border-radius:var(--r-s);border:1px solid var(--line);background-color:var(--well);background-image:var(--plus);background-size:16px 16px;overflow:hidden}
.lrow .mini img{width:100%;height:100%;object-fit:contain;padding:2px}
.lrow .sub{color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lrow .num{font:500 var(--fs-s) var(--mono);color:var(--muted)}
.results{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:var(--r-l);background:var(--panel);overflow:hidden}
.results li+li{border-top:1px solid var(--line)}
.results a{display:block;padding:12px 16px;color:var(--ink);text-decoration:none;transition:background-color var(--d-1) var(--ease)}
.results a:hover{background:var(--hover)}
.results .name{font-weight:600}
.results .where{color:var(--muted);font:500 var(--fs-xs) var(--mono);margin-left:8px}
.results .snip{display:block;margin-top:4px;font:var(--fs-s)/1.55 var(--mono);color:var(--ink2);overflow-wrap:anywhere}
.results mark{background:var(--warn-bg);color:var(--warn-ink);border-radius:var(--r-xs);padding:0 2px}
.first{position:relative;overflow:hidden;display:flex;flex-wrap:wrap;align-items:center;gap:40px;padding:56px;border-radius:var(--r-2xl);border:1px solid var(--line)}
.first .copy{flex:1 1 360px;display:flex;flex-direction:column;gap:14px}
.first h1{margin:0;font:700 40px/44px var(--display);letter-spacing:-.02em}
.first p{margin:0;font:500 22px/30px var(--display);letter-spacing:-.01em;color:var(--ink2);max-width:480px}
.first .acts{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
.first ol{margin:6px 0 0;padding-left:20px;font-size:var(--fs-l);line-height:24px;color:var(--ink2)}
.first .art{flex:1 1 280px;height:240px;position:relative}
.first .art i{position:absolute;display:block}
.first .art i:nth-child(1){left:8%;top:8%;width:132px;height:86px;border-radius:var(--r-2xl);background:var(--art-coral);transform:rotate(-8deg);box-shadow:var(--art-shadow-coral)}
.first .art i:nth-child(2){left:52%;top:0;width:120px;height:120px;border-radius:var(--r-2xl);background:var(--art-amber);transform:rotate(10deg);box-shadow:var(--art-shadow-amber)}
.first .art i:nth-child(3){left:34%;top:56%;width:92px;height:92px;border-radius:var(--r-pill);background:var(--art-blue);box-shadow:var(--art-shadow-blue)}
.none-here{padding:18px 16px;border:1px dashed var(--line2);border-radius:var(--r-l);color:var(--muted);font-size:13.5px}
.none-here b{color:var(--ink);font-weight:600}
.ws-head{display:flex;flex-direction:column;gap:16px;margin-bottom:-8px}
.ws-title{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.ws-title h1{margin:0;font-size:var(--fs-2xl);line-height:26px;font-weight:600;letter-spacing:var(--tight)}
.ws-mark{width:52px;height:52px;flex:none;border-radius:var(--r-l);display:inline-flex;align-items:center;justify-content:center;background:var(--f-fill);color:var(--f-text);border:1px solid var(--line);font:700 22px var(--display)}
.ws-meta{display:flex;align-items:center;gap:10px;margin-top:4px;font-size:12.5px;color:var(--muted)}
.ws-acts{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
.tabs .tally{margin-left:2px}
.tab-intro{display:flex;flex-direction:column;gap:4px;max-width:680px;margin-bottom:16px}
.tab-intro h2{margin:0;font-size:16px;font-weight:600;letter-spacing:var(--tight)}
.tab-intro p{margin:0;font-size:var(--fs-m);line-height:20px;color:var(--muted)}
.tab-intro code,.src-runs code{font:500 var(--fs-s) var(--mono);padding:1px 5px;border-radius:var(--r-xs);background:var(--sunken);border:1px solid var(--line)}
.src-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.src-card{display:flex;flex-direction:column;gap:14px;padding:16px;border:1px solid var(--line);border-radius:var(--r-l);background:var(--panel);transition:border-color var(--d-2) var(--ease),box-shadow var(--d-2) var(--ease)}
.src-card:hover{border-color:var(--line2);box-shadow:var(--shadow2)}
.src-top{display:flex;align-items:center;gap:12px}
.src-badge{width:40px;height:40px;flex:none;border-radius:var(--r-ml);display:inline-flex;align-items:center;justify-content:center;font:600 10.5px var(--mono);background:var(--f-fill);color:var(--f-text);border:1px solid var(--line)}
.src-name,.pub-what{display:flex;flex-direction:column;min-width:0;flex:1}
.src-name b,.pub-what b{font-size:13.5px;font-weight:600}
.src-name span,.pub-what span{font-size:var(--fs-s);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.src-name span{font-family:var(--mono);font-size:var(--fs-xs)}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:10px 12px;border-radius:var(--r-m);background:var(--bg);border:1px solid var(--line)}
.stat{display:flex;flex-direction:column;gap:2px;min-width:0}
.stat .caps{font-size:10px}
.stat b{font:600 var(--fs-m) var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.src-runs{margin:0;font-size:12.5px;color:var(--ink2)}
.src-acts{display:flex;gap:8px;margin-top:auto}
.pub-row,.mem-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px 16px;border-top:1px solid var(--line)}
.pub-row:first-child,.mem-row:first-child{border-top:none}
.pub-row .src-badge{width:36px;height:36px}
.pub-what{flex:1 1 260px}
.pub-when{font:500 var(--fs-xs) var(--mono);color:var(--muted)}
.mem-row .avatar{width:32px;height:32px;font-size:11px}
.feed{list-style:none;margin:0;padding:0;max-width:760px;display:flex;flex-direction:column}
.feed li{position:relative;display:flex;gap:14px;padding:0 0 18px}
.feed li::before{content:"";position:absolute;left:4.5px;top:16px;bottom:0;width:1px;background:var(--line)}
.feed li:last-child::before{display:none}
.feed .dot{width:10px;height:10px;flex:none;margin-top:5px;border-radius:var(--r-pill);box-shadow:0 0 0 3px var(--bg)}
.feed div{display:flex;flex-direction:column;gap:2px;font-size:var(--fs-m)}
.feed b{font-weight:600}
.feed time{font:500 var(--fs-xs) var(--mono);color:var(--faint)}
.toast-float{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:20;max-width:min(520px,calc(100vw - 32px))}
.toast-float[hidden]{display:none}
.imp{max-width:860px;width:100%;margin:0 auto;animation:none}
.imp>header{display:flex;gap:16px;padding:22px 24px 18px}
.imp-words h1{margin:0;font:700 26px/30px var(--display);letter-spacing:-.02em}
.imp-words p{margin:6px 0 0;font-size:var(--fs-m);line-height:20px;color:var(--muted);max-width:600px}
.imp-steps{list-style:none;margin:0;padding:10px 24px;display:flex;gap:28px;background:var(--panel);border-bottom:1px solid var(--line);flex-wrap:wrap}
.imp-steps li{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:500;color:var(--muted)}
.imp-steps i{font-style:normal;width:22px;height:22px;border-radius:var(--r-pill);display:inline-flex;align-items:center;justify-content:center;font:600 11px var(--mono);background:var(--raise);border:1px solid var(--line2);color:var(--muted)}
.imp-steps li[data-state=now]{color:var(--ink)}
.imp-steps li[data-state=now] i{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.imp-steps li[data-state=done] i{background:var(--ok-bg);border-color:var(--ok-line);color:var(--ok-ink)}
.imp-body{padding:20px 24px;display:flex;flex-direction:column;gap:16px}
.imp-drop{display:flex;flex-direction:column;align-items:center;gap:10px;padding:36px 24px;border:1.5px dashed var(--line2);border-radius:var(--r-l);background:var(--bg);text-align:center;cursor:pointer;transition:border-color var(--d-1) var(--ease),background-color var(--d-1) var(--ease)}
.imp-drop:hover,.imp-drop.over,.imp-drop:focus-within{border-color:var(--accent);background:var(--accent-soft)}
.imp-drop[hidden]{display:none}
.imp-drop b{font-size:15px;font-weight:600}
.imp-drop u{color:var(--accent-ink);text-underline-offset:2px}
.imp-formats{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
.imp-drop:not([hidden])~.imp-formats{display:grid}
.imp-drop[hidden]~.imp-formats{display:none}
.imp-fmt{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-ml);background:var(--panel)}
.imp-fmt>span:last-child{display:flex;flex-direction:column}
.imp-fmt b{font-size:13px}
.imp-fmt span span{font-size:11.5px;color:var(--muted)}
.imp-ext{min-width:52px;height:26px;padding:0 7px;border-radius:var(--r-s);display:inline-flex;align-items:center;justify-content:center;font:600 10.5px var(--mono);background:var(--f-fill);color:var(--f-text);border:1px solid var(--line)}
.imp-report{display:flex;flex-direction:column;gap:12px}
.imp-report:empty{display:none}
.imp-file{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.imp-file b{font-size:13px;overflow-wrap:anywhere}
.imp-file span{font-size:var(--fs-s);color:var(--muted)}
.imp-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.imp-stat{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:var(--r-ml);border:1px solid var(--line);background:var(--panel)}
.imp-stat b{font:600 20px/24px var(--font);font-variant-numeric:tabular-nums}
.imp-stat span{font-size:11.5px;color:var(--muted)}
.imp-sec{display:flex;flex-direction:column;gap:8px}
.imp-sec-head{display:flex;align-items:baseline;gap:10px}
.imp-layout{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.imp-opt{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--line);border-radius:var(--r-ml);background:var(--panel);cursor:pointer}
.imp-opt:has(input:checked){border-color:var(--accent);background:var(--accent-soft)}
.imp-opt input{margin-top:3px;accent-color:var(--accent)}
.imp-opt>span{display:flex;flex-direction:column;gap:2px}
.imp-opt b{font-size:13px}.imp-opt>span>span{font-size:12px;line-height:17px;color:var(--muted)}
.imp-types{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:6px}
.imp-types li{display:flex;align-items:center;gap:8px;padding:4px 4px 4px 10px;border:1px solid var(--line);border-radius:var(--r-ml);background:var(--panel);font-size:13px}
.imp-types .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.imp-types select.field{width:136px;height:28px;font-size:var(--fs-s)}
@media (max-width:640px){.imp-layout{grid-template-columns:1fr}}
.imp-pages{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:var(--r-ml);overflow:hidden}
.imp-pages li{display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid var(--line);background:var(--panel);font-size:13px}
.imp-pages li:first-child{border-top:none}
.imp-pages .mono{font-size:var(--fs-s);color:var(--muted)}
.imp-arrow{font-size:var(--fs-xs);color:var(--faint)}
.imp>footer{flex-wrap:wrap}
.imp>footer .f-hint{margin-right:auto;max-width:420px}
.use-nav{display:flex;align-items:center;gap:8px;margin:0 0 8px}
.use-nav b{min-width:150px;text-align:center}
.use-nav a[download]{margin-left:auto}
.use-chart{display:block;width:100%;max-width:720px;height:auto;margin:6px 0 18px}
.use-chart rect{fill:var(--accent);opacity:.35}
.use-chart rect.now{opacity:1}
.use-chart text{font-size:11px;fill:var(--muted)}
.use-chart line.cap{stroke:var(--bad-ink);stroke-dasharray:4 4}
.use-chart text.cap{fill:var(--bad-ink)}
.use-limits,.use-add,.own form{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin:8px 0 18px}
.use-add{padding:12px 16px;border-top:1px solid var(--line)}
.cap{display:flex;flex-direction:column;gap:3px;font-size:var(--fs-xs);color:var(--muted)}
.cap.check{flex-direction:row;align-items:center;gap:6px;height:28px}
.own{position:relative}
.own summary{list-style:none;cursor:pointer}
.own summary::-webkit-details-marker{display:none}
.own[open] form{margin:8px 0 0}
@media (max-width:760px){.side{position:fixed;z-index:30;left:0;top:0;bottom:0;width:min(300px,86vw);height:auto;box-shadow:var(--shadow3);transform:translateX(-102%);visibility:hidden;transition:transform var(--d-3) var(--ease),visibility 0s linear var(--d-3)}.nav-open .side{transform:none;visibility:visible;transition:transform var(--d-3) var(--ease)}.side-close{display:inline-flex}.scrim{position:fixed;inset:0;z-index:29;background:var(--scrim)}.nav-open .scrim{display:block}body:has(.nav-open){overflow:hidden}.menu-btn{display:inline-flex;margin-left:-8px}.bar-brand{display:flex;min-height:28px;align-items:center}.bar{gap:8px 4px;padding:8px 16px 10px}.bar form{order:3;flex:1 1 100%;max-width:none}.bar .well{height:38px}.bar kbd{display:none}.bar .tools{gap:6px}.bar .tools .btn{width:34px;height:34px;padding:0}.bar .tools .label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.wrap{padding:24px 16px 48px}.lrow{grid-template-columns:minmax(0,1fr) 96px}.lrow .hide-s{display:none}.first{padding:32px 24px}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.ws-acts{margin-left:0}.ws-head .tabs{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.ws-head .tabs>a{flex:none}.imp-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.first h1{font-size:32px;line-height:36px}.first .art{display:none}}
`;

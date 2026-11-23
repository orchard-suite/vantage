/**
 * The reader: a doc view's page over the stage, or beside it when the page
 * names a view to read with. The page's contents list rides at its right,
 * or behind a button where there is no room.
 */
import { COMPACT } from './compact.ts';
export const READ_STYLES = `
.v-read{position:absolute;inset:0;z-index:3;display:none;background:var(--bg);min-width:0}
.v-reading .v-read{display:flex}
.v-reading .v-viewcard,.v-reading .v-minimap,.v-reading .v-story{display:none!important}
.v-reading:not(.v-reading-beside) .v-canvas{visibility:hidden}
.v-reading:not(.v-reading-beside) .v-zoom,.v-reading:not(.v-reading-beside) .v-zoom+.v-sep,.v-reading:not(.v-reading-beside) .v-detail,.v-reading:not(.v-reading-beside) .v-sep-detail{display:none}
.v-reading-beside .v-read{right:auto;width:min(580px,46%);border-right:1px solid var(--line);box-shadow:var(--shadow)}
.v-reading-beside .v-toolbar{left:calc(min(580px,46%) + 16px)}
.v-read-scroll{flex:1;min-width:0;overflow:auto;overscroll-behavior:contain}
.v-read-page{max-width:820px;margin:0 auto;padding:36px 40px 120px}
.v-reading-beside .v-read-page{padding:26px 28px 60vh}
.v-read-group{font:var(--caps);letter-spacing:var(--caps-track);text-transform:uppercase;color:var(--muted);margin:0 0 6px}
.v-read-title{font-size:var(--fs-3xl);line-height:1.2;font-weight:650;letter-spacing:var(--tight);margin:0}
.v-read-lede{color:var(--ink2);font-size:var(--fs-xl);line-height:1.55;margin:10px 0 0}
.v-read-head{padding-bottom:18px;margin-bottom:22px;border-bottom:1px solid var(--line)}
.v-read-tocbtn{display:none;margin-top:14px}
.v-prose{font-size:var(--fs-l);line-height:1.68;color:var(--ink);overflow-wrap:anywhere}
.v-prose>:first-child{margin-top:0}
.v-prose h1,.v-prose h2,.v-prose h3,.v-prose h4,.v-prose h5,.v-prose h6{position:relative;letter-spacing:var(--tight);line-height:1.3;margin:1.9em 0 .55em;scroll-margin-top:20px}
.v-prose h1{font-size:var(--fs-2xl);font-weight:650}
.v-prose h2{font-size:var(--fs-2xl);font-weight:600;padding-top:.9em;border-top:1px solid var(--line)}
.v-prose h3{font-size:var(--fs-xl);font-weight:600}
.v-prose h4,.v-prose h5,.v-prose h6{font-size:var(--fs-l);font-weight:600}
.v-prose p,.v-prose ul,.v-prose ol,.v-prose pre,.v-prose blockquote,.v-prose .v-table,.v-prose .v-figure{margin:0 0 1em}
.v-prose ul,.v-prose ol{padding-left:1.5em}
.v-prose li{margin:.2em 0}
.v-prose li>p{margin:0 0 .4em}
.v-prose a{color:var(--accent-ink);text-decoration:underline;text-decoration-color:var(--line2);text-underline-offset:2.5px}
.v-prose a:hover{text-decoration-color:currentColor}
.v-prose code{font:500 .92em/1.5 var(--mono);background:var(--sunken);border:1px solid var(--line);border-radius:var(--r-xs);padding:.05em .32em}
.v-prose pre{background:var(--sunken);border:1px solid var(--line);border-radius:var(--r-m);padding:12px 14px;overflow:auto;line-height:1.55}
.v-prose pre code{background:none;border:none;padding:0;font-size:var(--fs-s);white-space:pre}
.v-prose blockquote{border-left:3px solid var(--line2);padding:2px 0 2px 14px;color:var(--ink2)}
.v-prose hr{border:none;border-top:1px solid var(--line);margin:2em 0}
.v-prose img{max-width:100%;border-radius:var(--r-m)}
.v-table{overflow:auto;border:1px solid var(--line);border-radius:var(--r-m)}
.v-table table{border-collapse:collapse;width:100%;font-size:var(--fs-m)}
.v-table th,.v-table td{text-align:left;vertical-align:top;padding:7px 11px;border-bottom:1px solid var(--line)}
.v-table th{background:var(--sunken);font-weight:600;white-space:nowrap}
.v-table tr:last-child td{border-bottom:none}
.v-prose .v-anchor{position:absolute;right:100%;top:0;padding-right:6px;color:var(--faint);text-decoration:none;opacity:0;font-weight:400}
.v-prose :hover>.v-anchor,.v-prose .v-anchor:focus-visible{opacity:1}
.v-prose .v-flash{animation:v-flash var(--d-flash) var(--ease)}
@keyframes v-flash{0%,35%{background:var(--accent-soft)}100%{background:transparent}}
.v-prose a.v-ref{padding:1px 4px;margin:0 -1px;border-radius:var(--r-xs);background:var(--accent-soft);color:var(--accent-ink);font-weight:500;text-decoration:none;cursor:pointer;box-shadow:0 0 0 1px transparent;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.v-prose a.v-ref:hover,.v-prose a.v-ref.on{box-shadow:0 0 0 1px var(--accent)}
.v-prose a.v-ref.plain{cursor:default;background:var(--sunken);color:var(--ink2)}
.v-figure{border:1px solid var(--line);border-radius:var(--r-l);background:var(--panel);overflow:hidden}
.v-figure-pic{display:block;padding:14px;cursor:zoom-in;text-decoration:none}
.v-figure-pic svg{display:block;width:100%;height:auto;max-height:70vh}
[data-theme=dark] .v-app[data-pic=light] .v-figure svg,[data-theme=light] .v-app[data-pic=dark] .v-figure svg{filter:invert(.92) hue-rotate(180deg)}
.v-figure figcaption{display:flex;align-items:center;gap:10px;padding:9px 14px;border-top:1px solid var(--line);background:var(--sunken);font-size:var(--fs-s);color:var(--ink2)}
.v-figure figcaption span{flex:1;min-width:0}
.v-fig-missing{color:var(--bad-ink);font-size:var(--fs-s)}
.v-read-toc{flex:none;width:272px;border-left:1px solid var(--line);background:var(--panel);display:flex;flex-direction:column;min-height:0}
.v-read-toc h4{font:var(--caps);letter-spacing:var(--caps-track);text-transform:uppercase;color:var(--muted);margin:0;padding:16px 16px 8px}
.v-read-find{margin:0 12px 8px;height:30px;padding:0 10px;border:1px solid var(--line);border-radius:var(--r-m);background:var(--sunken);color:var(--ink);font:inherit;outline:none}
.v-read-find:focus{border-color:var(--accent);box-shadow:var(--halo)}
.v-read-list{flex:1;overflow:auto;padding:0 8px 16px}
.v-read-list a{display:block;padding:4px 8px 4px calc(8px + var(--depth,0) * 12px);border-radius:var(--r-s);color:var(--ink2);font-size:var(--fs-s);line-height:1.4;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.v-read-list a:hover{background:var(--hover);color:var(--ink)}
.v-read-list a.on{background:var(--accent-soft);color:var(--accent-ink);font-weight:600}
.v-read-empty{color:var(--muted);padding:24px 0}
.v-reading-beside .v-read-toc,.v-read.v-read-notoc .v-read-toc{display:none}
.v-reading-beside .v-read-tocbtn{display:inline-flex}
.v-read.v-read-notoc .v-read-tocbtn{display:none}
.v-reading-beside .v-read.v-toc-open .v-read-toc{display:flex;position:absolute;inset:0 0 0 auto;z-index:2;box-shadow:var(--shadow3)}
@media (max-width:1180px){
  .v-read-toc{display:none}
  .v-read-tocbtn{display:inline-flex}
  .v-read.v-toc-open .v-read-toc{display:flex;position:absolute;inset:0 0 0 auto;z-index:2;box-shadow:var(--shadow3)}
}
@media ${COMPACT}{.v-read-page{padding:22px 18px 120px}.v-read-title{font-size:var(--fs-2xl)}}
@media print{.v-read{position:static}.v-read-scroll{overflow:visible}.v-read-toc,.v-read-tocbtn{display:none!important}}
`;

/** The brand surfaces before the app (auth-pages.ts): the blueprint field with the logo's shapes, and the task beside it. */
export const BRAND_CSS = `
.auth{min-height:100vh;min-height:100dvh;display:flex;background:var(--bg)}
.auth-art{flex:1 1 50%;position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;gap:32px;padding:44px 56px;background-color:var(--blueprint);color:var(--on-blueprint);background-image:radial-gradient(circle at 1px 1px,var(--blueprint-dot) 1px,transparent 0);background-size:24px 24px}
.auth-art img{height:30px;width:auto;align-self:flex-start}
.auth-shapes{position:relative;height:300px}
.auth-shapes i{position:absolute;display:block}
.auth-shapes i:nth-child(1){left:6%;top:10%;width:180px;height:120px;border-radius:var(--r-2xl);background:var(--art-coral);transform:rotate(-7deg);box-shadow:var(--art-shadow);animation:auth-settle var(--d-art) var(--ease) both;--r:-7deg}
.auth-shapes i:nth-child(2){left:52%;top:0;width:160px;height:160px;border-radius:var(--r-2xl);background:var(--art-amber);transform:rotate(9deg);box-shadow:var(--art-shadow);animation:auth-settle var(--d-art) var(--ease) var(--d-2) both;--r:9deg}
.auth-shapes i:nth-child(3){left:34%;top:58%;width:120px;height:120px;border-radius:var(--r-pill);background:var(--art-blue);box-shadow:var(--art-shadow)}
@keyframes auth-settle{from{transform:translateY(8px) rotate(var(--r))}to{transform:rotate(var(--r))}}
.auth-art h2{margin:0;font:700 52px/56px var(--display);letter-spacing:-.03em;max-width:520px}
.auth-art p{margin:14px 0 0;font:500 19px/27px var(--display);opacity:.86;max-width:480px}
.auth-task{flex:1 1 50%;display:flex;align-items:center;justify-content:center;padding:40px 24px}
.auth-box{width:100%;max-width:380px;display:flex;flex-direction:column;gap:20px}
.auth-small{display:none}
.auth-tile{width:56px;height:56px;border-radius:var(--r-xl);background:var(--raise);box-shadow:var(--shadow3);display:inline-flex;align-items:center;justify-content:center}
.auth-tile svg{width:36px;height:36px}
.auth-box h1{margin:0;font:700 32px/36px var(--display);letter-spacing:-.02em}
.auth-box .lede{margin:8px 0 0;font-size:var(--fs-l);line-height:21px;color:var(--muted)}
.auth-box form{display:flex;flex-direction:column;gap:8px}
.auth-box label{font-size:13px;font-weight:500}
.auth-box .field{height:44px;padding:0 14px;font-size:var(--fs-l);border-radius:var(--r-ml)}
.auth-box .field.code{font-size:15px}
.auth-box .btn.lg{width:100%;height:44px;margin-top:8px}
.auth-note{margin:0;font-size:12.5px;line-height:18px;color:var(--faint)}
@media (max-width:820px){.auth-art{display:none}.auth-small{display:block}.auth-small img{height:26px;width:auto}.auth-box h1{font-size:28px;line-height:32px}}
@media (prefers-reduced-motion:reduce){.auth-shapes i{animation:none}}
`;

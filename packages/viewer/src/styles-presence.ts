/** Presence: the readers here as avatars in the app bar, the follow bar over the stage, and the frame a follower sees. */
import { COMPACT } from './compact.ts';
export const PRESENCE_STYLES = `
.v-peers{display:flex;align-items:center;padding-left:6px;margin-right:2px}
.v-peer{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;margin-left:-6px;padding:0;border:2px solid var(--panel);border-radius:var(--r-pill);background:var(--peer,var(--path-slate));color:var(--panel);font:600 var(--fs-xs)/1 var(--font);letter-spacing:.02em;cursor:pointer;position:relative;transition:transform var(--d-1) var(--ease),box-shadow var(--d-1) var(--ease)}
.v-peer:hover{transform:translateY(-1px);z-index:1}
.v-peer[aria-pressed=true]{box-shadow:0 0 0 2px var(--peer)}
.v-peer.v-presenting::after{content:'';position:absolute;right:-3px;bottom:-3px;width:10px;height:10px;border-radius:50%;background:var(--peer);border:2px solid var(--panel)}
.v-peer.v-guest{background:var(--sunken);color:var(--ink2);box-shadow:inset 0 0 0 1.5px var(--peer)}
.v-peer-more{background:var(--sunken);color:var(--muted);cursor:default}
.v-peer-more:hover{transform:none}
.v-follow{position:absolute;left:50%;top:16px;transform:translateX(-50%);z-index:7;display:flex;align-items:center;gap:10px;max-width:calc(100% - 32px);padding:5px 6px 5px 14px;background:var(--raise);border:1px solid var(--peer,var(--line));border-radius:var(--r-pill);box-shadow:var(--shadow2);font-size:var(--fs-m);white-space:nowrap;animation:v-pop var(--d-2) var(--ease)}
.v-follow-text{overflow:hidden;text-overflow:ellipsis}
.v-follow-text b{font-weight:600}
.v-follow-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--peer,var(--accent))}
.v-follow .v-btn{height:28px;border-radius:var(--r-pill)}
.v-area.v-following::after{content:'';position:absolute;inset:0;z-index:6;pointer-events:none;box-shadow:inset 0 0 0 3px var(--follow)}
@media ${COMPACT}{.v-peer:nth-child(n+3){display:none}.v-follow{top:auto;bottom:calc(var(--lift,0px) + 72px)}}
@media print{.v-peers,.v-follow{display:none!important}.v-area.v-following::after{display:none}}
`;

/**
 * The voice walkthrough row on the story card: play or record, the seek
 * bar, the time, and a note. The recording mark is a still dot; only the
 * timer text changes, once a second.
 */
export const TALK_STYLES = `
.v-talk{padding:6px 10px 0 14px}
.v-talk-row{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
.v-talk-play{flex:none}
.v-talk-seek{flex:1;min-width:96px;accent-color:var(--story,var(--accent));height:24px;margin:0}
.v-talk-time{font:500 var(--fs-s) var(--mono);color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.v-talk-by{font-size:var(--fs-s);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px}
.v-talk-pick{max-width:220px}
.v-talk-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--bad-ink)}
.v-talk-stop{color:var(--bad-ink)}
.v-talk-hint{flex:1;min-width:0;font-size:var(--fs-s);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.v-talk-note{margin:4px 0 0;font-size:var(--fs-s);line-height:1.45;color:var(--muted)}
.v-story.folded .v-talk{padding-bottom:8px}
`;

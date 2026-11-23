-- The release that drew each render. A reader who opens a document drawn
-- by an older release queues a redraw, so a rollout whose old workers
-- take the redraw jobs never leaves a document drawn the old way.
alter table render_states add column renderer text;

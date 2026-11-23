-- What a render kept of each view (its digest, the anchors it leaves for
-- the views after it, its size and score, and whether its variants are
-- drawn), so the next render of the document takes unchanged views as
-- they are.
alter table render_states add column views jsonb;

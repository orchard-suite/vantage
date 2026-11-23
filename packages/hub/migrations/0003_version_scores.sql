-- Layout score per view, written by the render worker, read by the history panel.
alter table versions add column scores jsonb not null default '{}'::jsonb;

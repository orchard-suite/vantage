-- A diagram drawn from a description rides on the revisions table, so it
-- spends against the same records and limits. `kind` tells the two apart;
-- a generation has no document or comments, only the words it was given
-- and the workspace it was asked for. One generation runs per person.
alter table revisions add column kind text not null default 'revise' check (kind in ('revise', 'generate'));
alter table revisions add column prompt text;
alter table revisions add column workspace_id text references workspaces(id) on delete set null;
alter table revisions alter column comment_ids set default '{}';
create unique index revisions_one_generation on revisions (requested_by) where kind = 'generate' and state in ('queued', 'running');

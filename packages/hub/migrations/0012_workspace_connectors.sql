-- Connectors belong to one workspace and run outside the hub. Each signs in
-- with its own OAuth client (an app-only access token from the issuer), so
-- the hub stores no credential for it: the client id it accepts, and an
-- admin's decision on it. Org-wide sources, their visibility, the schedule
-- the worker ran them on, and the hub-issued push tokens are gone. A source
-- that belongs to no workspace cannot be adopted safely, so it is deleted
-- with its observed rows, runs, and mappings.
delete from sources;
delete from jobs where kind in ('connector-run', 'ingest') and state in ('queued', 'running');

alter table sources drop column visibility;
alter table sources drop column schedule;
alter table sources add column workspace_id text not null references workspaces(id) on delete cascade;
alter table sources add column client_id text not null;
alter table sources add column created_by text references users(id) on delete set null;
alter table sources add column approval text not null default 'pending' check (approval in ('pending', 'approved', 'stopped'));
alter table sources add column approval_by text references users(id) on delete set null;
alter table sources add column approval_at timestamptz;

drop index sources_slug;
create unique index sources_workspace_slug on sources (workspace_id, slug);
create index sources_client on sources (client_id);

alter table source_runs drop constraint source_runs_trigger_check;
update source_runs set trigger = 'push';
alter table source_runs add constraint source_runs_trigger_check check (trigger in ('push'));

delete from tokens where kind = 'source';
alter table tokens drop constraint tokens_kind_check;
alter table tokens add constraint tokens_kind_check check (kind in ('personal', 'automation'));

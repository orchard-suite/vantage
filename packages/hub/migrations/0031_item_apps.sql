-- A module's app (VAN-2005): an OAuth client the issuer vouches
-- for, registered by an admin with the kinds it works and the workspace its
-- kinds live in. Its own work (putting items, publishing labels, loading
-- kinds files, reading the feed) runs under it; a person's act never does.
create table item_apps (
  id text primary key,
  org_id text not null references orgs(id),
  client_id text not null,
  name text not null,
  workspace_id text not null references workspaces(id),
  kinds jsonb not null default '[]'::jsonb,
  created_by text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, client_id)
);

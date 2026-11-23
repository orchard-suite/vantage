-- A workspace's own icon pack: ids (pack/name) to picture bytes in the blob store under icons/<org>/<hash>.
create table workspace_icons (
  workspace_id text not null references workspaces(id) on delete cascade,
  org_id text not null references orgs(id),
  id text not null,
  hash text not null,
  content_type text not null,
  size integer not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

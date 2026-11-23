-- A document's old address after it moved to another workspace. The page
-- at the old address redirects to the new one, and a tool that names the
-- old address is told the new one. A document saved later at the same
-- address takes it back: an alias only answers where no document is.
create table document_aliases (
  workspace_id text not null references workspaces(id) on delete cascade,
  slug text not null,
  document_id text not null references documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workspace_id, slug)
);

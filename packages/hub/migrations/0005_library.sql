-- Stars: diagrams a reader keeps at hand, per reader.
create table stars (
  user_id text not null references users(id) on delete cascade,
  document_id text not null references documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, document_id)
);

-- Folders inside a workspace, one level deep. A document sits in at most one.
create table folders (
  id text primary key,
  org_id text not null references orgs(id),
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);
alter table documents add column folder_id text references folders(id) on delete set null;
create index documents_folder on documents (folder_id) where folder_id is not null;

-- Access promised to an email address before its owner has signed in. The
-- first sign-in with that email turns it into a grant.
create table invites (
  id text primary key,
  org_id text not null references orgs(id),
  workspace_id text not null references workspaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('viewer', 'author')),
  invited_by text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (workspace_id, email)
);

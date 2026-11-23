-- Vantage hub schema. Every table carries org_id so a second organization
-- is a row, not a migration.

create table orgs (
  id text primary key,
  name text not null,
  slug text not null unique,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table users (
  id text primary key,
  org_id text not null references orgs(id),
  subject text not null,
  email text,
  display_name text,
  is_admin boolean not null default false,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, subject)
);

create table teams (
  id text primary key,
  org_id text not null references orgs(id),
  name text not null,
  slug text not null,
  external_group text,
  created_at timestamptz not null default now(),
  unique (org_id, slug)
);
create index teams_external_group on teams (org_id, external_group);

create table team_members (
  org_id text not null references orgs(id),
  team_id text not null references teams(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table workspaces (
  id text primary key,
  org_id text not null references orgs(id),
  kind text not null check (kind in ('personal', 'team')),
  name text not null,
  slug text not null,
  owner_user_id text references users(id),
  settings jsonb not null default '{}'::jsonb,
  disabled_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, slug)
);

create table grants (
  id text primary key,
  org_id text not null references orgs(id),
  workspace_id text not null references workspaces(id) on delete cascade,
  role text not null check (role in ('viewer', 'author')),
  subject_kind text not null check (subject_kind in ('user', 'team', 'org')),
  subject_id text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, subject_kind, subject_id)
);

create table documents (
  id text primary key,
  org_id text not null references orgs(id),
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  head_version_id text,
  search tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);
create index documents_search on documents using gin (search);

create table versions (
  id text primary key,
  org_id text not null references orgs(id),
  document_id text not null references documents(id) on delete cascade,
  hash text not null,
  yaml text not null,
  imports jsonb not null default '{}'::jsonb,
  pins jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  author_user_id text references users(id),
  surface text not null,
  message text not null default '',
  parent_id text references versions(id) on delete set null,
  created_at timestamptz not null default now()
);
create index versions_document on versions (document_id, created_at desc);
create index versions_hash on versions (hash);

create table artifacts (
  id text primary key,
  org_id text not null references orgs(id),
  version_hash text not null,
  view_id text not null default '',
  kind text not null check (kind in ('bundle', 'svg', 'png', 'html')),
  blob_key text not null,
  bytes bigint not null,
  content_type text not null,
  created_at timestamptz not null default now(),
  unique (version_hash, view_id, kind)
);

create table jobs (
  id text primary key,
  org_id text not null references orgs(id),
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'queued' check (state in ('queued', 'running', 'done', 'failed')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  locked_by text,
  locked_at timestamptz,
  run_at timestamptz not null default now(),
  log jsonb not null default '[]'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_queue on jobs (state, run_at);

create table audit (
  id text primary key,
  org_id text not null references orgs(id),
  who text not null,
  what text not null,
  surface text not null,
  target text not null,
  details jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index audit_at on audit (org_id, at desc);

create table tokens (
  id text primary key,
  org_id text not null references orgs(id),
  user_id text references users(id) on delete cascade,
  hash text not null unique,
  kind text not null check (kind in ('personal', 'source', 'automation')),
  scope jsonb not null default '{}'::jsonb,
  name text not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table device_codes (
  device_code text primary key,
  user_code text not null unique,
  org_id text not null references orgs(id),
  name text not null,
  approved_by text references users(id),
  sealed_token text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table guest_links (
  id text primary key,
  org_id text not null references orgs(id),
  document_id text not null references documents(id) on delete cascade,
  view_id text,
  created_by text references users(id),
  expires_at timestamptz not null,
  passcode_hash text,
  revoked_at timestamptz,
  opens int not null default 0,
  created_at timestamptz not null default now()
);

create table comments (
  id text primary key,
  org_id text not null references orgs(id),
  document_id text not null references documents(id) on delete cascade,
  view_id text,
  node_id text,
  text text not null,
  author_user_id text references users(id),
  resolved_by text references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index comments_document on comments (document_id, created_at);

create table sources (
  id text primary key,
  org_id text not null references orgs(id),
  name text not null,
  kind text not null,
  config jsonb not null default '{}'::jsonb,
  secret_sealed text,
  visibility jsonb not null default '{"org": true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table mappings (
  id text primary key,
  org_id text not null references orgs(id),
  source_id text not null references sources(id) on delete cascade,
  name text not null,
  yaml text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into orgs (id, name, slug) values ('default', 'Default', 'default') on conflict do nothing;

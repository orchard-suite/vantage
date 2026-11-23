-- Agents that sign in to /mcp with OAuth: the hub is their authorization server.
-- A client registers itself (no secret: a public client using PKCE); a person
-- approves it once on the hub, which gives it a grant; the grant holds a
-- rotating refresh token and the one short-lived access token it last issued.

create table oauth_clients (
  id text primary key,
  org_id text not null references orgs(id),
  name text not null,
  redirect_uris jsonb not null,
  created_at timestamptz not null default now()
);

create table oauth_codes (
  hash text primary key,
  client_id text not null references oauth_clients(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  expires_at timestamptz not null
);

create table oauth_grants (
  id text primary key,
  org_id text not null references orgs(id),
  user_id text not null references users(id) on delete cascade,
  client_id text not null references oauth_clients(id) on delete cascade,
  refresh_hash text not null unique,
  refresh_expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index oauth_grants_user on oauth_grants (user_id) where revoked_at is null;

-- An access token a grant issued; it goes when the grant is revoked or refreshed.
alter table tokens add column grant_id text references oauth_grants(id) on delete cascade;

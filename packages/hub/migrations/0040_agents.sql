-- An agent acts as itself for one person (VAN-2009). An agent row names
-- the person it acts for, the name it goes by, the client it came through,
-- and the machine or runtime it runs on. A device-flow token and an OAuth
-- grant each name one; disconnecting the agent ends them. An event records
-- the agent beside the person, and a claim names its run and its agent as
-- well as its person, so two runs for one person never both hold an item.
create table agents (
  id text primary key,
  org_id text not null references orgs(id),
  user_id text not null references users(id) on delete cascade,
  name text not null,
  client text not null,
  host text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index agents_user on agents (user_id) where revoked_at is null;

alter table tokens add column agent_id text references agents(id) on delete cascade;
alter table oauth_grants add column agent_id text references agents(id) on delete cascade;
alter table device_codes add column client text;
alter table device_codes add column host text;

-- Events and items keep the agent's id as history: no foreign key, so the
-- fold and the table always agree.
alter table item_events add column agent_id text;
alter table items add column claim_agent text;
alter table items add column claim_run text;

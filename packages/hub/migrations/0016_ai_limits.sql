-- Cached input is billed apart from fresh input, so a revision keeps the two
-- apart. Rows from before this kept every input token in input_tokens.
alter table revisions add column cache_read_tokens integer not null default 0;
alter table revisions add column cache_write_tokens integer not null default 0;

-- What revisions may spend, set by an admin. One row per organization holds
-- the defaults for each person and the cap for the whole organization; a
-- null is no limit. Without a row the deployment's AI_DAILY_TOKENS is the
-- daily default and nothing else is capped.
create table ai_limits (
  org_id text primary key references orgs(id),
  daily_tokens integer check (daily_tokens > 0),
  monthly_tokens integer check (monthly_tokens > 0),
  org_monthly_tokens bigint check (org_monthly_tokens > 0),
  updated_by text references users(id),
  updated_at timestamptz not null default now()
);

-- One person's limits in place of the defaults; a null keeps the default.
create table ai_user_limits (
  org_id text not null references orgs(id),
  user_id text not null references users(id) on delete cascade,
  daily_tokens integer check (daily_tokens > 0),
  monthly_tokens integer check (monthly_tokens > 0),
  blocked boolean not null default false,
  updated_by text references users(id),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

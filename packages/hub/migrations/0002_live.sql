-- The live layer: sealed secrets by name, sources that run on a schedule,
-- observed models and runs, publications and runs, drift reports, reviews,
-- notifications, and an idempotency key on jobs for the cron scheduler.

create table secrets (
  id text primary key,
  org_id text not null references orgs(id),
  name text not null,
  sealed text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

alter table sources rename column kind to connector;
alter table sources drop column secret_sealed;
alter table sources add column slug text;
update sources set slug = id where slug is null;
alter table sources alter column slug set not null;
alter table sources add column schedule text;
alter table sources add column enabled boolean not null default true;
alter table sources add column last_run jsonb;
create unique index sources_slug on sources (org_id, slug);

-- Source slugs a document's head version binds to (the prefix of every
-- `bind: source:id`), so a source run finds the documents to overlay.
alter table documents add column bind_sources jsonb not null default '[]'::jsonb;
create index documents_bind_sources on documents using gin (bind_sources);

create table observed_models (
  org_id text not null references orgs(id),
  source_id text not null references sources(id) on delete cascade,
  model jsonb not null default '{"entities":{},"relations":{}}'::jsonb,
  version int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (source_id)
);

create table source_runs (
  id text primary key,
  org_id text not null references orgs(id),
  source_id text not null references sources(id) on delete cascade,
  job_id text,
  trigger text not null check (trigger in ('schedule', 'manual', 'push')),
  status text not null check (status in ('ok', 'failed')),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  counts jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  error text
);
create index source_runs_source on source_runs (source_id, started_at desc);

create table publications (
  id text primary key,
  org_id text not null references orgs(id),
  workspace_id text not null references workspaces(id) on delete cascade,
  document_id text not null references documents(id) on delete cascade,
  name text not null,
  views jsonb,
  formats jsonb not null,
  target text not null,
  config jsonb not null default '{}'::jsonb,
  trigger jsonb not null default '{"kind":"manual"}'::jsonb,
  audience text not null default 'org',
  theme text,
  title_block boolean not null default true,
  enabled boolean not null default true,
  last_run jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index publications_document on publications (document_id);

create table publication_runs (
  id text primary key,
  org_id text not null references orgs(id),
  publication_id text not null references publications(id) on delete cascade,
  job_id text,
  trigger text not null,
  status text not null check (status in ('ok', 'failed')),
  version_id text,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  written jsonb not null default '[]'::jsonb,
  skipped jsonb not null default '[]'::jsonb,
  error text
);
create index publication_runs_publication on publication_runs (publication_id, started_at desc);

create table drift_reports (
  org_id text not null references orgs(id),
  document_id text not null references documents(id) on delete cascade,
  version_id text not null,
  report jsonb not null,
  counts jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (document_id)
);

create table reviews (
  id text primary key,
  org_id text not null references orgs(id),
  workspace_id text not null references workspaces(id) on delete cascade,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  documents int not null default 0,
  errors int not null default 0,
  score_delta double precision not null default 0,
  drift_delta int not null default 0,
  summary jsonb not null default '{}'::jsonb
);
create index reviews_workspace on reviews (workspace_id, started_at desc);

create table notifications (
  id text primary key,
  org_id text not null references orgs(id),
  workspace_id text not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('drift', 'review', 'publication-failed')),
  title text not null,
  body text not null,
  delivered jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index notifications_workspace on notifications (workspace_id, created_at desc);

alter table jobs add column schedule_key text;
create unique index jobs_schedule_key on jobs (schedule_key);

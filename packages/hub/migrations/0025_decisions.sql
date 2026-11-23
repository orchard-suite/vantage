-- Decision records. A registry is a named, numbered set of decisions held
-- by a workspace; its prefix is unique in the organization so a citation
-- (SHOP-2001) resolves anywhere. Records are never deleted, so a number
-- once taken is never handed out again.

create table decision_registries (
  id text primary key,
  org_id text not null references orgs(id),
  workspace_id text not null references workspaces(id) on delete cascade,
  prefix text not null,
  name text not null,
  description text not null default '',
  -- [{ "digit": 0, "name": "Governance" }, ...]
  categories jsonb not null,
  created_by text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, prefix)
);
create index decision_registries_workspace on decision_registries (workspace_id);

create table decisions (
  id text primary key,
  org_id text not null references orgs(id),
  registry_id text not null references decision_registries(id) on delete cascade,
  number int not null check (number between 0 and 9999),
  category int not null check (category between 0 and 9),
  title text not null,
  status text not null check (status in ('proposed', 'accepted', 'deprecated', 'superseded')),
  decided_on text,
  updated_on text not null,
  deciders jsonb not null default '[]'::jsonb,
  context text not null default '',
  decision text not null default '',
  consequences text not null default '',
  alternatives jsonb not null default '[]'::jsonb,
  related jsonb not null default '[]'::jsonb,
  alignment jsonb,
  supersedes_id text references decisions(id) on delete set null,
  superseded_by_id text references decisions(id) on delete set null,
  search tsvector,
  created_by text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registry_id, number)
);
create index decisions_search on decisions using gin (search);
create index decisions_registry on decisions (registry_id, category, number);

-- What a record governs: a box (node id) or a view of a document.
create table decision_links (
  decision_id text not null references decisions(id) on delete cascade,
  org_id text not null references orgs(id),
  document_id text not null references documents(id) on delete cascade,
  target_kind text not null check (target_kind in ('box', 'view')),
  target_id text not null,
  primary key (decision_id, document_id, target_kind, target_id)
);
create index decision_links_document on decision_links (document_id);

-- Every write keeps the record as it was after the write, like a document version.
create table decision_revisions (
  id text primary key,
  org_id text not null references orgs(id),
  decision_id text not null references decisions(id) on delete cascade,
  snapshot jsonb not null,
  message text not null default '',
  author_user_id text references users(id) on delete set null,
  surface text not null,
  created_at timestamptz not null default now()
);
create index decision_revisions_decision on decision_revisions (decision_id, created_at desc);

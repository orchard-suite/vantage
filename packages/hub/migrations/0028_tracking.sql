-- Tracked work (docs/decisions/3005 to 3008, 2004). A kind is a document
-- with a kind block; its lifecycle is a view in it. An item's events are
-- the truth: every change appends one, and the current-state tables (items,
-- item_named, item_links) are written in the same transaction and can be
-- rebuilt from the events.

-- A kind as its document's head last said. The prefix shares the
-- organization's one namespace with registry prefixes, so ER-31 names one
-- thing. The definition is the kind block with its base laid under it and
-- its lifecycle read out of the view.
create table item_kinds (
  id text primary key,
  org_id text not null references orgs(id),
  workspace_id text not null references workspaces(id),
  document_id text not null references documents(id),
  prefix text not null,
  name text not null,
  definition jsonb not null,
  version_id text not null,
  next_number int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, prefix),
  unique (document_id)
);

-- Each item as it stands now. Every column is a value some event set.
create table items (
  id text primary key,
  org_id text not null references orgs(id),
  kind_id text not null references item_kinds(id),
  workspace_id text not null references workspaces(id),
  number int not null,
  key text not null,
  -- The owner's own key for an item another system keeps (forms/1842); null for the hub's own.
  ref text,
  title text not null,
  state text not null,
  class text not null check (class in ('not-started', 'in-progress', 'done', 'parked')),
  asker_id text references users(id) on delete set null,
  holders jsonb not null default '[]'::jsonb,
  labels jsonb not null default '{}'::jsonb,
  -- The content revision the state is about, for an item another system keeps.
  revision text,
  -- The body revision for an item the hub keeps.
  body_id text,
  parent_id text references items(id),
  -- The position of the last event, which is the item's version.
  position bigint not null,
  events int not null default 0,
  notes int not null default 0,
  files int not null default 0,
  state_since timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  search tsvector,
  unique (org_id, key),
  unique (kind_id, number)
);
create unique index items_ref on items (kind_id, ref) where ref is not null;
create index items_workspace on items (workspace_id, class, updated_at desc);
create index items_kind_state on items (kind_id, state);
create index items_parent on items (parent_id) where parent_id is not null;
create index items_search on items using gin (search);
create index items_holders on items using gin (holders);

-- The events. A position only moves forward: appends take one lock per
-- organization, so positions commit in the order they were handed out and
-- a reader never later finds an event before one it has seen.
create table item_events (
  position bigserial primary key,
  id text not null unique,
  org_id text not null references orgs(id),
  item_id text not null references items(id) deferrable initially deferred,
  kind_id text not null,
  type text not null,
  v int not null default 1,
  actor_id text,
  actor_kind text not null check (actor_kind in ('person', 'agent', 'app', 'system')),
  surface text not null,
  at timestamptz not null default now(),
  data jsonb not null,
  idempotency_key text,
  answer text not null
);
create unique index item_events_key on item_events (org_id, idempotency_key) where idempotency_key is not null;
create index item_events_item on item_events (item_id, position desc);
create index item_events_feed on item_events (org_id, position);

-- Who is named on an item, so a person outside the workspace sees it:
-- the asker, each holder, and each person or team a waiting move's role
-- resolves to.
create table item_named (
  item_id text not null references items(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('user', 'team')),
  subject_id text not null,
  why text not null,
  primary key (item_id, subject_kind, subject_id, why)
);
create index item_named_subject on item_named (subject_kind, subject_id);

-- What an item is linked to: another item (came from, part of), a box or a
-- view of a document, or a decision record.
create table item_links (
  item_id text not null references items(id) on delete cascade,
  rel text not null check (rel in ('came-from', 'part-of', 'box', 'view', 'decision')),
  target text not null,
  primary key (item_id, rel, target)
);
create index item_links_target on item_links (rel, target);

-- The Markdown body of an item the hub keeps. Every change is a new row;
-- an event names the row and never carries the text.
create table item_bodies (
  id text primary key,
  item_id text not null references items(id) deferrable initially deferred,
  text text not null,
  created_at timestamptz not null default now()
);
create index item_bodies_item on item_bodies (item_id, created_at desc);

-- Files about the work on an item: proof, a note's attachment.
create table item_files (
  id text primary key,
  item_id text not null references items(id) deferrable initially deferred,
  name text not null,
  content_type text not null,
  size int not null,
  blob_key text not null,
  created_at timestamptz not null default now()
);
create index item_files_item on item_files (item_id, created_at);

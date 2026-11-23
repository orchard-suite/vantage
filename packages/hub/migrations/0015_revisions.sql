-- A comment points at any number of boxes in its view, not one node.
alter table comments add column targets text[] not null default '{}';
update comments set targets = array[node_id] where node_id is not null;
alter table comments drop column node_id;

-- One request to revise a document from its open comments: who asked, the
-- comments it carried, the model's proposal, and what it cost. A row
-- outlives its document and its base version, so usage stays counted.
create table revisions (
  id text primary key,
  org_id text not null references orgs(id),
  document_id text references documents(id) on delete set null,
  base_version_id text references versions(id) on delete set null,
  requested_by text not null references users(id),
  comment_ids text[] not null,
  model text not null,
  state text not null check (state in ('queued', 'running', 'ready', 'failed', 'accepted', 'rejected')),
  yaml text,
  summary text,
  addressed text[] not null default '{}',
  error text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  version_id text references versions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index revisions_document on revisions (document_id, created_at desc);
create index revisions_usage on revisions (org_id, requested_by, created_at);
create unique index revisions_one_active on revisions (document_id) where state in ('queued', 'running');

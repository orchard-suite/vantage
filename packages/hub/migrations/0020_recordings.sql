-- A voice walkthrough: an author's audio over one view's walkthrough or
-- numbered paths, with the moment each step was shown. The audio lives in
-- the blob store under recordings/<org>/<id>. The version is kept as an id
-- without a reference: retention may drop that version, and the id still
-- tells a reader the recording was made on an older one.
create table recordings (
  id text primary key,
  org_id text not null references orgs(id),
  document_id text not null references documents(id) on delete cascade,
  view_id text not null,
  version_id text not null,
  author_user_id text references users(id) on delete set null,
  duration_ms integer not null check (duration_ms > 0),
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  blob_key text not null,
  timeline jsonb not null,
  created_at timestamptz not null default now()
);
create index recordings_document on recordings (document_id, view_id, created_at desc);

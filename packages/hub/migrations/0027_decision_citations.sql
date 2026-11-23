-- Where decision records are cited from, and the citations a record keeps
-- after it moves. A citation row names its source (a document's head
-- version and the box or page in it, or another record and the part of it)
-- and its target by id, so it survives any renumbering. A row whose text
-- names no record yet keeps decision_id null until that record exists.

create table decision_citations (
  org_id text not null references orgs(id),
  decision_id text references decisions(id) on delete cascade,
  -- The citation in its canonical text: PREFIX-NNNN, or adr:<ULID>.
  cited_ref text not null,
  -- The citation as the source writes it.
  cited_as text not null,
  document_id text references documents(id) on delete cascade,
  version_id text references versions(id) on delete cascade,
  source_decision_id text references decisions(id) on delete cascade,
  -- box and page in a document (place_id is the box or view id); related and body in a record (place_id is the field).
  place_kind text not null check (place_kind in ('box', 'page', 'related', 'body')),
  place_id text not null,
  check ((document_id is null) <> (source_decision_id is null))
);
create index decision_citations_target on decision_citations (decision_id);
create index decision_citations_document on decision_citations (document_id);
create index decision_citations_source on decision_citations (source_decision_id);
create index decision_citations_pending on decision_citations (org_id, cited_ref) where decision_id is null;

-- A number a record held before it moved. It still resolves to the record,
-- and no other record ever takes it.
create table decision_aliases (
  org_id text not null references orgs(id),
  registry_id text not null references decision_registries(id) on delete cascade,
  number int not null check (number between 0 and 9999),
  decision_id text not null references decisions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (registry_id, number)
);
create index decision_aliases_decision on decision_aliases (decision_id);

-- What the index last read, so the backfill reads only what it has not.
alter table documents add column cites_version_id text;
alter table decisions add column cites_indexed boolean not null default false;

-- A record may carry a position, and each scope's standard is built from
-- positions and published in editions (VAN-3018).

-- The outside standard a record named is now prose in its Context: the
-- stance, the rule id, and the note, as one closing paragraph.
update decisions set context = trim(both from concat_ws(E'\n\n', nullif(trim(both from context), ''),
  'Standard: ' || case alignment->>'stance' when 'follows' then 'follows' when 'extends' then 'extends' when 'departs' then 'departs from' else 'new ground' end
    || coalesce(' ' || nullif(alignment->>'rule', ''), '')
    || coalesce(': ' || nullif(alignment->>'note', ''), '') || '.'))
  where alignment is not null;
alter table decisions drop column alignment;

-- The line a record sets for its scope: { line, binding, binds, locked, reach, enforced_by, checked_by }.
alter table decisions add column position jsonb;
create index decisions_position on decisions (org_id) where position is not null;

-- A scope's standard, one row per edition. scope '' is the whole estate.
-- A published edition never changes. At most one row per scope is not
-- published: the next edition, waiting for the steward (pending) or held
-- by the machine gate (refused), numbered one past the last published.
create table standard_editions (
  org_id text not null references orgs(id),
  scope text not null,
  version int not null check (version > 0),
  state text not null check (state in ('published', 'pending', 'refused')),
  -- sha256 over the body: its lines, packs, exceptions, and pages.
  hash text not null,
  body jsonb not null,
  -- { scope, name, kind, steward, builds_on: [{ scope, version }] }
  manifest jsonb not null,
  -- What changed against the last published edition.
  changes jsonb not null default '[]'::jsonb,
  -- Why the machine gate refused it.
  problems jsonb not null default '[]'::jsonb,
  built_at timestamptz not null default now(),
  published_at timestamptz,
  published_by text,
  primary key (org_id, scope, version)
);
create unique index standard_editions_next on standard_editions (org_id, scope) where state <> 'published';

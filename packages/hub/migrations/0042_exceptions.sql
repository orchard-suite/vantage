-- An exception is the hub's record, granted by the steward of the line it
-- departs from (VAN-3020). scope is the scope key it stands at ('' for the
-- whole estate, owner+program for a workspace that serves a program), and
-- every scope below; line is the record whose line it bends.
create table standard_exceptions (
  org_id text not null references orgs(id),
  number int not null check (number > 0),
  -- exception:<ULID>, the name another store gives what it writes from it.
  id text not null unique,
  line text not null,
  scope text not null,
  -- The departing records it lets stand, by id; empty is any record there.
  records jsonb not null default '[]'::jsonb,
  -- The resources an engine exempts, as the catalog or the engine names them.
  things jsonb not null default '[]'::jsonb,
  reason text not null default '',
  safeguard text not null default '',
  -- The last day it is in force, in the estate's time zone.
  ends date,
  state text not null check (state in ('requested', 'incomplete', 'granted', 'revoked', 'ended')),
  asked_by text,
  asked_by_user text,
  asked_at timestamptz not null default now(),
  granted_by text,
  granted_by_user text,
  granted_at timestamptz,
  closed_at timestamptz,
  -- Where an imported one came from: the store, and that store's own key.
  source_store text,
  source_ref text,
  primary key (org_id, number),
  unique (org_id, source_store, source_ref)
);
create index standard_exceptions_line on standard_exceptions (org_id, line);

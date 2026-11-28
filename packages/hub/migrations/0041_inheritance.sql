-- Every line that reaches a scope applies; a record says how it stands
-- against each one it touches, and a clash between two lines is a
-- conflict its nearest shared scope's steward rules on (VAN-3019).

-- The record's map of inherited lines: [{ line: <record id>, stance:
-- builds | refines | departs, scope: <scope key>, version: <edition> }].
alter table decisions add column inherits jsonb not null default '[]'::jsonb;
-- The records this one amends, by id.
alter table decisions add column amends jsonb not null default '[]'::jsonb;

-- The program a workspace serves, beside its owner scope (VAN-3017): a
-- second axis, never a second parent.
alter table workspaces add column program text;

-- The facets a catalog gave a scope that are longer than a line can name,
-- kept aside so the tree's outline says so.
alter table scopes add column refused_facets text[] not null default '{}';

-- A clash between two lines that reach the same scope. scope is a scope
-- key ('' for the whole estate, owner+program for a workspace that serves
-- a program); lines are two record ids; stewards are who rules:
-- [{ scope, steward }], the nearest shared scope's, or each line's own
-- scope's when the clash crosses the program axis.
create table standard_conflicts (
  org_id text not null references orgs(id),
  number int not null check (number > 0),
  scope text not null,
  lines jsonb not null,
  stewards jsonb not null,
  why text not null,
  state text not null default 'open' check (state in ('open', 'ruled')),
  -- change | narrow | exception
  ruling text,
  note text,
  exception text,
  filed_by text,
  filed_at timestamptz not null default now(),
  ruled_by text,
  ruled_at timestamptz,
  primary key (org_id, number)
);
create index standard_conflicts_open on standard_conflicts (org_id) where state = 'open';

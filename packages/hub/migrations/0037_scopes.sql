-- The organization's tree of owners (VAN-3017). A scope has one parent, a
-- kind in the estate's own word, a steward, and facets. The tree comes
-- from the catalog (origin catalog, which edits never change) or is kept
-- in the hub (origin hub). A workspace names one owner scope; none means
-- the whole estate. Which source the tree uses is orgs.settings.scopes.
create table scopes (
  org_id text not null references orgs(id),
  id text not null,
  name text not null,
  kind text not null,
  parent text,
  steward text,
  facets text[] not null default '{}',
  origin text not null check (origin in ('catalog', 'hub')),
  url text,
  updated_at timestamptz not null default now(),
  primary key (org_id, id)
);

alter table workspaces add column scope text;
alter table workspaces add constraint workspaces_scope_fk foreign key (org_id, scope) references scopes (org_id, id) on delete set null (scope);

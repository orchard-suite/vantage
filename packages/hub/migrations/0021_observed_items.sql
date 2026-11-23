-- Open items (issues, firing alerts, pull requests, incidents), one row
-- each, beside the observed entities and relations of their source. An item
-- may point at an entity of another source of the workspace, by key or by
-- fact, so it is not part of any entity's row. A full read replaces every
-- item of its source: an item no longer reported is closed and its row goes.
create table observed_items (
  source_id text not null references sources(id) on delete cascade,
  key text not null,
  data jsonb not null,
  observed text not null,
  primary key (source_id, key)
);

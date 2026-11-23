-- Observed entities and relations, one row each, instead of one document
-- per source. A run writes only the rows whose content changed, so a large
-- source costs its changes in writes and replication, not its size. The
-- time an item was last seen is not stored per row when a full read saw
-- it: full_observed on the source carries it, and a row keeps its own time
-- only when a partial slice saw it later or it went missing.
create table observed_entities (
  source_id text not null references sources(id) on delete cascade,
  key text not null,
  data jsonb not null,
  observed text not null,
  primary key (source_id, key)
);

create table observed_relations (
  source_id text not null references sources(id) on delete cascade,
  key text not null,
  data jsonb not null,
  observed text not null,
  primary key (source_id, key)
);

alter table observed_models add column full_observed text;

insert into observed_entities (source_id, key, data, observed)
  select m.source_id, e.key,
         case when e.value ? 'provenance' then (e.value - 'observed') || jsonb_build_object('provenance', (e.value -> 'provenance') - 'observed') else e.value - 'observed' end,
         e.value ->> 'observed'
    from observed_models m, jsonb_each(m.model -> 'entities') e;

insert into observed_relations (source_id, key, data, observed)
  select m.source_id, r.key,
         case when r.value ? 'provenance' then (r.value - 'observed') || jsonb_build_object('provenance', (r.value -> 'provenance') - 'observed') else r.value - 'observed' end,
         r.value ->> 'observed'
    from observed_models m, jsonb_each(m.model -> 'relations') r;

-- The old document column stays for one release: pods of the previous
-- release still read it while a rolling upgrade replaces them. Nothing in
-- this release reads or writes it.

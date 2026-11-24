-- An item keeps its place among the items of its kind, as a fractional rank:
-- a move between two items writes one row. Ranks compare byte by byte.
alter table items add column rank text collate "C";
create index items_kind_rank on items (kind_id, rank);

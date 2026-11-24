-- An item links toward a milestone, so a dated point gathers items from
-- every kind and works out its state from them.
alter table item_links drop constraint item_links_rel_check;
alter table item_links add constraint item_links_rel_check check (rel in ('came-from', 'part-of', 'waits-on', 'toward', 'box', 'view', 'decision', 'proof', 'adds', 'changes', 'retires'));

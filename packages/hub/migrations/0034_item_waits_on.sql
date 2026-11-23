-- An item says it waits on another, so a roadmap carries its build order
-- as links, not as prose.
alter table item_links drop constraint item_links_rel_check;
alter table item_links add constraint item_links_rel_check check (rel in ('came-from', 'part-of', 'waits-on', 'box', 'view', 'decision', 'proof', 'adds', 'changes', 'retires'));

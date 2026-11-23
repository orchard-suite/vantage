-- A roadmap item names its proof (another item, or a box whose real thing
-- a connector should see) and the boxes and views it adds, changes, or
-- retires (VAN-3009).
alter table item_links drop constraint item_links_rel_check;
alter table item_links add constraint item_links_rel_check check (rel in ('came-from', 'part-of', 'box', 'view', 'decision', 'proof', 'adds', 'changes', 'retires'));
create index item_links_proof on item_links (target) where rel = 'proof';

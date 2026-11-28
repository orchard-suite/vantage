-- A work item has one owner who answers for it, and the owner delegates it
-- to agents (VAN-3024). The owner (a person or a team), the delegation (to
-- the owner's agents, or to one named agent, and by whom), and the scope
-- the item serves are each set by events. worked_by is everyone who ever
-- held or claimed the item, so a review can refuse the people who worked it.
alter table items add column owner_kind text check (owner_kind in ('user', 'team'));
alter table items add column owner_id text;
alter table items add column delegated_agent text;
alter table items add column delegated_user text;
alter table items add column delegated_by text;
alter table items add column scope text;
alter table items add column worked_by jsonb not null default '[]'::jsonb;

-- Who worked each item already, in the order the fold meets them.
update items i set worked_by = coalesce((
  select jsonb_agg(w.u order by w.p) from (
    select e.data ->> 'userId' as u, min(e.position) as p from item_events e
     where e.item_id = i.id and e.type in ('held', 'claimed') group by 1
  ) w
), '[]'::jsonb);

create index items_owner on items (org_id, owner_kind, owner_id);
create index items_delegated on items (org_id, delegated_by) where delegated_by is not null;

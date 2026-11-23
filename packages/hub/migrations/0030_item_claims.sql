-- Agents on items (VAN-3010). A claim is a hold with an end:
-- the claimant and when it runs out, both set by events (claimed, renewed,
-- released). A run record is an event; the card counts them.
alter table items add column claim_user text references users(id) on delete set null;
alter table items add column claim_until timestamptz;
alter table items add column runs int not null default 0;
create index items_queue on items (workspace_id, class, updated_at) where class in ('not-started', 'in-progress');

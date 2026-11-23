-- Who may make team workspaces when TEAM_WORKSPACES=granted, who set up
-- each publication, and an admin's decision on it: pending until an admin approves
-- it, approved, or stopped by an admin. Publications that already exist
-- ran under the old rules, so they start approved.
alter table users add column can_create_workspaces boolean not null default false;

alter table publications add column created_by text references users(id) on delete set null;
alter table publications add column approval text not null default 'pending';
alter table publications add column approval_by text references users(id) on delete set null;
alter table publications add column approval_at timestamptz;
update publications set approval = 'approved';

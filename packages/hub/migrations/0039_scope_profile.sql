-- A scope carries its profile (VAN-3017): the fields the estate names in
-- orgs.settings.scopes.profile, read from the catalog or kept in the hub.
-- A field a scope leaves empty shows its nearest ancestor's when read.
alter table scopes add column profile jsonb not null default '{}'::jsonb;

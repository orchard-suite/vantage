-- The issuer's stable id for a person (VAN-2006): the claim
-- OIDC_PERSON_CLAIM names, the same in every token the issuer signs for any
-- app. A browser sign-in, a front door, and a module's token for the same
-- person meet on it. Null until the person first signs in with a claim
-- that carries it.
alter table users add column person_id text;
create unique index users_person on users (org_id, person_id) where person_id is not null;

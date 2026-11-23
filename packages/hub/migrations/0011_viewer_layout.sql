-- The viewer lays out opened, folded, zoomed, and depth pictures itself
-- from the bundle's layout kit, so renders stop drawing them ahead.
-- Their rows go, their files go the way a replaced render's files go,
-- and every document is drawn again so its bundle carries the kit.
with gone as (
  delete from artifacts where kind = 'variants' returning org_id, blob_key
)
insert into jobs (id, org_id, kind, payload)
select replace(gen_random_uuid()::text, '-', ''), org_id, 'drop-files', jsonb_build_object('keys', jsonb_agg(distinct blob_key))
from gone group by org_id;

insert into jobs (id, org_id, kind, payload, dedupe_key)
select replace(gen_random_uuid()::text, '-', ''), org_id, 'overlay', jsonb_build_object('documentId', id, 'reason', 'viewer lays out in the browser'), 'overlay:' || id
from documents where head_version_id is not null
on conflict do nothing;

alter table artifacts drop constraint if exists artifacts_kind_check;
alter table artifacts add constraint artifacts_kind_check check (kind in ('bundle', 'svg', 'png', 'html'));

-- Each view's bundle entry is stored on its own (kind `view`) and reused
-- by later renders until its digest changes; the stored bundle lists the
-- views. A view's standalone SVG is made on first request, like its PNG.
alter table artifacts drop constraint if exists artifacts_kind_check;
alter table artifacts add constraint artifacts_kind_check check (kind in ('bundle', 'view', 'svg', 'png', 'html'));
-- A view's entry is read by its view and digest.
alter table artifacts add column if not exists digest text;
create index if not exists artifacts_view_digest on artifacts (view_id, digest) where kind = 'view';

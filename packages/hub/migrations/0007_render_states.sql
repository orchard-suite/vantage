-- One render of a version hash: its id names the folder its files live in,
-- so a new render writes beside the old one and swaps in one transaction.
-- The digest is what the picture depended on; an overlay whose inputs
-- match it draws nothing.
create table render_states (
  version_hash text primary key,
  render_id text not null,
  digest text not null,
  updated_at timestamptz not null default now()
);

alter table artifacts add column render_id text;
alter table artifacts drop constraint if exists artifacts_kind_check;
alter table artifacts add constraint artifacts_kind_check check (kind in ('bundle', 'svg', 'png', 'html', 'variants'));

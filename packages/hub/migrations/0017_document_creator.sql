-- Who made a document. The workspace's delete rule lets the maker delete
-- their own diagrams; retention can drop the first version, so the maker
-- is kept on the document. Rows from before this take the author of the
-- oldest version still kept.
alter table documents add column created_by text references users(id) on delete set null;
update documents d set created_by = (
  select v.author_user_id from versions v
   where v.document_id = d.id and v.author_user_id is not null
     and exists (select 1 from users u where u.id = v.author_user_id)
   order by v.created_at limit 1
);

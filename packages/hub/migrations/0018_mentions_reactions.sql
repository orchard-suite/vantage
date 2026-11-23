-- Mentions in comments and reactions on boxes.
--
-- A notification may be addressed to one person (user_id) instead of a
-- workspace's fixed list; a mention is one. Workspace lists leave those out.
alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (kind in ('drift', 'review', 'publication-failed', 'mention'));
alter table notifications add column user_id text references users(id) on delete cascade;
create index notifications_user on notifications (user_id, created_at desc) where user_id is not null;

-- Who a comment mentions, by stable user id. The comment text carries the
-- same ids as <@id> tokens; this table answers "where was I mentioned".
create table comment_mentions (
  comment_id text not null references comments(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  org_id text not null references orgs(id),
  document_id text not null references documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index comment_mentions_user on comment_mentions (user_id, created_at desc);

-- One reaction of each kind per person per box in a view. A box id that a
-- later save drops keeps its rows; readers see them as orphaned.
create table reactions (
  org_id text not null references orgs(id),
  document_id text not null references documents(id) on delete cascade,
  view_id text not null,
  box_id text not null,
  user_id text not null references users(id) on delete cascade,
  kind text not null check (kind in ('up', 'wrong', 'question')),
  comment_id text references comments(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (document_id, view_id, box_id, user_id, kind)
);
create index reactions_document on reactions (document_id, view_id);

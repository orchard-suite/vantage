-- A document draws once per burst: saves and source refreshes share one
-- queued draw under `doc:<id>`, and a document never draws on two workers
-- at once (claim skips a key that is running).
update jobs set dedupe_key = 'doc:' || substr(dedupe_key, 9)
  where dedupe_key like 'overlay:%' and state in ('queued', 'running')
    and not exists (select 1 from jobs q where q.state = 'queued' and q.dedupe_key = 'doc:' || substr(jobs.dedupe_key, 9));
create index if not exists jobs_dedupe_running on jobs (dedupe_key) where state = 'running';

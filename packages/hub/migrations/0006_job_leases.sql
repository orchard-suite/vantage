-- One queued job per dedupe key: a burst of source runs queues one overlay
-- per document, not one per run. A running job holds no key, so a change
-- that lands while it runs queues the next one.
alter table jobs add column dedupe_key text;
create unique index jobs_dedupe on jobs (dedupe_key) where state = 'queued';

-- A running job's lease: the worker renews locked_at while it works, and a
-- job whose lease lapsed is taken back from a worker that died.
create index jobs_leases on jobs (locked_at) where state = 'running';

-- Finished jobs are pruned by age.
create index jobs_finished on jobs (updated_at) where state in ('done', 'failed');
create index source_runs_age on source_runs (started_at);
create index publication_runs_age on publication_runs (started_at);
create index notifications_age on notifications (created_at);

-- A connector the hub schedules runs in the shared runner pool every
-- every_minutes; null runs on a runner of its own, or is pushed to. The
-- pool leases its runs from the job queue as connector-run jobs.
alter table sources add column every_minutes int check (every_minutes is null or every_minutes between 1 and 1440);

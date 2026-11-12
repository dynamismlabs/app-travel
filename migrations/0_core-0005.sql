CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
ALTER TABLE installation ADD COLUMN time_zone TEXT;


CREATE TABLE job_state (job TEXT PRIMARY KEY, checkpoint TEXT, first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL);


CREATE TABLE job_runs (id TEXT PRIMARY KEY, job TEXT NOT NULL, scheduled_for TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','waiting','retrying','succeeded','failed')), attempt INTEGER NOT NULL, runner TEXT, lease_until TEXT, next_attempt_at TEXT, started_at TEXT NOT NULL, finished_at TEXT, result TEXT, error TEXT, approval TEXT);


CREATE INDEX job_runs_job_idx ON job_runs(job, started_at);
INSERT INTO _migrations (id,checksum,applied_at) VALUES ('core-0005','616c3bb303c867dd399ad72b3ec27419ec670d352d375c8ff01cc0f15b5082b7',CURRENT_TIMESTAMP);

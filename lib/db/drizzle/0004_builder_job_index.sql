-- 0004 — builder_companies.job_id hardening
--
-- Context: builder_companies.job_id is text while builder_jobs.id is serial.
-- A forced text→int coercion would drop any non-numeric job_id rows, so we do
-- NOT coerce. Instead we add an index for the join path and a forward-compatible
-- nullable numeric reference that new writes can populate. The legacy text
-- column stays authoritative until a later release backfills + swaps.

CREATE INDEX IF NOT EXISTS idx_builder_companies_job_id
  ON builder_companies (job_id);

ALTER TABLE builder_companies
  ADD COLUMN IF NOT EXISTS job_ref integer;

-- Backfill job_ref where job_id is purely numeric (safe subset).
UPDATE builder_companies
  SET job_ref = job_id::integer
  WHERE job_ref IS NULL
    AND job_id ~ '^[0-9]+$';

CREATE INDEX IF NOT EXISTS idx_builder_companies_job_ref
  ON builder_companies (job_ref);

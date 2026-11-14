-- ─── 004: web-search / adequacy fields on analysis_runs ──────────────────
-- Written by createRun()/executeRun() since #29/#30 but never migrated,
-- which made every POST /analysis fail with 503 on insert.
ALTER TABLE analysis_runs
  ADD COLUMN IF NOT EXISTS data_adequacy TEXT,
  ADD COLUMN IF NOT EXISTS web_search_effective TEXT,
  ADD COLUMN IF NOT EXISTS web_search_note TEXT;

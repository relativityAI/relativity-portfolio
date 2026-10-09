-- 018: v3 pipeline artifacts (verification badge + evidence summary).
-- The GET /analysis/:id handler selects "*", so this column flows to the UI
-- with no handler change.
alter table public.analysis_runs
  add column if not exists artifacts jsonb;

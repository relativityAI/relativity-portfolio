-- ─── 015: true run-start clock ──────────────────────────────────────────
-- created_at marks when the run row was inserted (PENDING — queue time).
-- started_at is stamped exactly once on the PENDING→RUNNING edge, so the
-- UI's live elapsed timer survives page reloads: it shows the run's total
-- actual time, not time-since-this-page-load. Null while queued.

ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS started_at timestamptz;

-- Backfill in-flight runs (and any completed run missing the column's
-- semantics) with their created_at — the best available approximation that
-- never claims more elapsed time than reality.
UPDATE analysis_runs
SET started_at = created_at
WHERE started_at IS NULL;

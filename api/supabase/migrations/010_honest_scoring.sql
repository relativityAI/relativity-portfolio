-- ─── 010: honest scoring (plan §5.3 / Phase 0 tickets 0.2–0.4) ─────────────
-- coverage: % of weight actually scored (unknown ≠ 0 — unscored weight is
--   visible instead of silently collapsing to 0).
-- fit_low / fit_high: the uncertainty band around total_score — the same
--   weighted sum treating every unscored item as 0 and as 100.

ALTER TABLE analysis_runs
  ADD COLUMN IF NOT EXISTS fit_low NUMERIC,
  ADD COLUMN IF NOT EXISTS fit_high NUMERIC,
  ADD COLUMN IF NOT EXISTS coverage NUMERIC;

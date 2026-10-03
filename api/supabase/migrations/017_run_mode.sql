-- 017: single-skill evaluation mode.
-- A run is either a full agent evaluation (run_mode 'agent') or a single
-- skill run (run_mode 'skill', skill_id set). Existing rows read as 'agent'.

ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS run_mode text DEFAULT 'agent';
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS skill_id text;

-- 013: skill-based pipeline.
-- Custom skills are per-user markdown documents; analysis runs persist
-- per-skill outputs. Agent md_config rows adopt the v3 grammar lazily on
-- load (agentstore migration) — no destructive rewrite of existing rows.

CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_id text NOT NULL,
  markdown text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, skill_id)
);

ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS skill_outputs jsonb;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS pipeline_version text DEFAULT 'v3';

CREATE INDEX IF NOT EXISTS skills_user_idx ON skills (user_id);

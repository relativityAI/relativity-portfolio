-- Relativity Portfolio: Apply these migrations in the Supabase SQL Editor
-- Run this entire file as one SQL script.

-- ─── 002: stock_pulls table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_pulls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol          TEXT NOT NULL,
  country         TEXT NOT NULL,
  source          TEXT NOT NULL,
  job_id          TEXT,
  status          TEXT DEFAULT 'pending',
  last_pulled_at  TIMESTAMPTZ,
  data_available  BOOLEAN DEFAULT false,
  records         INT DEFAULT 0,
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_pulls_user_symbol
  ON stock_pulls(user_id, symbol, source);

CREATE INDEX IF NOT EXISTS idx_stock_pulls_status ON stock_pulls(status);

-- ─── 003: key_version column on user_settings ────────────────────────────
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS key_version INT DEFAULT 1;

-- ─── 004: web-search / adequacy fields on analysis_runs ──────────────────
ALTER TABLE analysis_runs
  ADD COLUMN IF NOT EXISTS data_adequacy TEXT,
  ADD COLUMN IF NOT EXISTS web_search_effective TEXT,
  ADD COLUMN IF NOT EXISTS web_search_note TEXT;

-- ─── 005: reasoning trace on analysis_runs ────────────────────────────────
ALTER TABLE analysis_runs
  ADD COLUMN IF NOT EXISTS trace JSONB DEFAULT '[]';

-- ─── 006: defaults_deleted flag on user_settings ──────────────────────────
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS defaults_deleted BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── 007: daily API usage tracking ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_usage (
  day         DATE NOT NULL,
  provider    TEXT NOT NULL,
  key_ref     TEXT NOT NULL,
  model_id    TEXT NOT NULL,
  requests    INT NOT NULL DEFAULT 0,
  tokens_in   BIGINT NOT NULL DEFAULT 0,
  tokens_out  BIGINT NOT NULL DEFAULT 0,
  failures    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, provider, key_ref, model_id)
);

CREATE INDEX IF NOT EXISTS idx_api_usage_provider_day ON api_usage(provider, day);

-- ─── 008: agent markdown storage ────────────────────────────────────────────
ALTER TABLE agents ADD COLUMN IF NOT EXISTS md_config TEXT NOT NULL DEFAULT '';

-- ─── 009: analysis report storage ───────────────────────────────────────────
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS report JSONB DEFAULT NULL;

-- ─── 010: honest scoring (plan §5.3 / Phase 0 tickets 0.2–0.4) ─────────────
ALTER TABLE analysis_runs
  ADD COLUMN IF NOT EXISTS fit_low NUMERIC,
  ADD COLUMN IF NOT EXISTS fit_high NUMERIC,
  ADD COLUMN IF NOT EXISTS coverage NUMERIC;

-- ─── 011: v2 pipeline (rubric/judge/KB) — retired by the skill redesign ────
-- (tables created by 011_v2_pipeline.sql remain harmless if present)

-- ─── 013: skill-based pipeline ─────────────────────────────────────────────
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

-- ─── 014: per-preset deletion tracking ─────────────────────────────────
-- Supersedes the all-or-nothing defaults_deleted boolean (006): deleting one
-- preset must not suppress the other three on re-seed.
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS deleted_preset_keys JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ─── 015: true run-start clock ──────────────────────────────────────────
-- started_at is stamped once on the PENDING→RUNNING edge; the UI's elapsed
-- timer anchors here so reloads show the run's total actual time.
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS started_at timestamptz;
UPDATE analysis_runs SET started_at = created_at WHERE started_at IS NULL;

-- ─── 016: market snapshot at run date ──────────────────────────────────
-- { price, as_of, market_cap, market_cap_source, currency, candles, fetched_at }
-- frozen at run time so a result viewed later shows the market as it was.
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS market_snapshot JSONB;

-- ─── 017: single-skill evaluation mode ─────────────────────────────────
-- A run is either a full agent evaluation (run_mode 'agent') or a single
-- skill run (run_mode 'skill', skill_id set). Existing rows read as 'agent'.
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS run_mode text DEFAULT 'agent';
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS skill_id text;

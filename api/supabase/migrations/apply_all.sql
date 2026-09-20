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

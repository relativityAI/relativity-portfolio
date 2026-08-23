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

-- Relativity Portfolio: initial schema
-- Run against Supabase Postgres to create all required tables.

-- ─── agents ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id        TEXT PRIMARY KEY,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  source    TEXT NOT NULL DEFAULT 'NSE',
  persona   JSONB DEFAULT '{}',
  configuration JSONB DEFAULT '{}',
  asset_evaluation  JSONB DEFAULT '{"qualitative":[],"quantitative":[]}',
  macro_evaluation  JSONB DEFAULT '{"qualitative":[],"quantitative":[]}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);

-- ─── analysis_runs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analysis_runs (
  id        TEXT PRIMARY KEY,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status    TEXT DEFAULT 'PENDING',
  symbol    TEXT NOT NULL,
  share_name TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  model     TEXT NOT NULL,
  source    TEXT,
  documents JSONB DEFAULT '[]',
  web_search BOOLEAN DEFAULT false,
  web_sources JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  duration  REAL,
  error     TEXT,
  steps     JSONB DEFAULT '[]',
  data_availability JSONB,
  price_data JSONB,
  quantitative_analysis JSONB DEFAULT '{}',
  qualitative_analysis JSONB DEFAULT '{}',
  qualitative_tool_calls JSONB DEFAULT '{}',
  quantitative_score REAL,
  qualitative_score  REAL,
  total_score REAL
);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_user_id ON analysis_runs(user_id);

-- ─── user_settings ─────────────────────────────────────────────────────
-- Stores encrypted per-user API keys (Voyager, LLM providers, Tavily).
CREATE TABLE IF NOT EXISTS user_settings (
  user_id   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  voyager_key_encrypted TEXT,
  llm_keys_encrypted   JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

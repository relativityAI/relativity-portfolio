-- Relativity Portfolio: stock pull tracking
-- Tracks per-user data pulls from Voyager to enforce freshness and dedup concurrent requests.

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

-- One record per user+symbol+source (upsert on conflict)
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_pulls_user_symbol
  ON stock_pulls(user_id, symbol, source);

CREATE INDEX IF NOT EXISTS idx_stock_pulls_status ON stock_pulls(status);

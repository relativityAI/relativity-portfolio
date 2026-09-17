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

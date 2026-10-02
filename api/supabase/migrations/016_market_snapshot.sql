-- ─── 016: market snapshot at run date ──────────────────────────────────
-- Every analysis result should show the stock's price and market cap as of
-- the run date, plus the 6-month price chart ending at that date. This
-- column freezes that context at run time — a result viewed months later
-- shows the market as it was when the verdict was formed, not as it is now.
--
-- Shape (JSONB):
--   { price: number, as_of: "YYYY-MM-DD", market_cap: number | null,
--     market_cap_source: "metrics" | "computed" | null,
--     currency: string | null, candles: [{ date, close }],
--     fetched_at: ISO string }

ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS market_snapshot JSONB;

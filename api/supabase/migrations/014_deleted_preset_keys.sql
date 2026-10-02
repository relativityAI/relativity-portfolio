-- ─── 014: per-preset deletion tracking ─────────────────────────────────
-- Supersedes the all-or-nothing defaults_deleted boolean (006). Deleting one
-- preset must not suppress the other three on re-seed (audit finding P0-1).
-- defaults_deleted is kept as a legacy fallback for pre-migration servers.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS deleted_preset_keys JSONB NOT NULL DEFAULT '[]'::jsonb;

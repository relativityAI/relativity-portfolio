-- Relativity Portfolio: track key provisioning version
-- Used to detect when an existing user's Voyager key needs re-provisioning
-- with updated scopes (e.g. adding data:write for pull support).

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS key_version INT DEFAULT 1;

-- Relativity Portfolio: track when a user deletes a default agent profile
-- so GET /agents stops re-seeding onto someone who chose to remove it.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS defaults_deleted BOOLEAN NOT NULL DEFAULT FALSE;
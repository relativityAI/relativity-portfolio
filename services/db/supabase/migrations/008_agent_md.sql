-- Agent markdown storage: the full agent config as a single editable md file.
-- Existing JSONB columns (persona/configuration/asset_evaluation/macro_evaluation)
-- are kept as an ignored read-cache for one release cycle, then dropped (migration 009).
ALTER TABLE agents ADD COLUMN IF NOT EXISTS md_config TEXT NOT NULL DEFAULT '';
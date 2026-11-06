-- 023: multi-file custom skills (agentskills.io directory layout).
-- SKILL.md stays in `markdown` (the harness reads it unchanged); every other
-- file in the skill directory lives here as a path -> content map. Folder
-- entries are keys ending in "/" with an empty string, so empty directories
-- (references/, assets/) survive a round-trip.
ALTER TABLE skills ADD COLUMN IF NOT EXISTS files jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 022: chosen system prompt on a run.
-- The New Run page's "Agent" step picks a named system prompt
-- (agent.yaml prompts.*) but the row only stored the constant agent_name
-- (the same default agent for every run), so Past Runs could not show
-- which prompt a run actually read. Store the pick like skill_ids.

ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS system_prompt text;
-- This migration briefly shipped as 022_run_output_template.sql: the pick is
-- a prompt NAME, not a template id. Drop the old column if it was applied.
ALTER TABLE analysis_runs DROP COLUMN IF EXISTS output_template_id;

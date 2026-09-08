-- Relativity Portfolio: analysis trace
-- Stores the full LLM process (reasoning thoughts, tool calls, decisions)
-- streamed from the AI SDK harness during qualitative scoring.

ALTER TABLE analysis_runs
  ADD COLUMN IF NOT EXISTS trace JSONB DEFAULT '[]';

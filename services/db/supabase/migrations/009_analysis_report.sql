-- Add report JSONB column to analysis_runs for storing the LLM-synthesized report
ALTER TABLE public.analysis_runs
ADD COLUMN report jsonb DEFAULT NULL;

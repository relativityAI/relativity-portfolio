-- 021: selected skills on a run.
-- POST /analysis accepts skill ids (the New Run page's Skills picker) but the
-- list could only show agent_name — which is the same default agent for every
-- harness run. Persist the selection so the list shows the real skills.

ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS skill_ids text[];

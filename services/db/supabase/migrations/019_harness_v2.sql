-- 019: agent harness v2 — custom agent definitions + run records.
-- The harness (api/src/harness/) stores a SOUL, the selected skills, an
-- allowed-tool list, a model, and a budget on the agent row. Runs persist the
-- typed ReportDocument and the evidence trace.

alter table public.agents
  add column if not exists soul_prompt text,
  add column if not exists skill_ids text[] not null default '{}',
  add column if not exists allowed_tools text[] not null default '{}',
  add column if not exists model_id text,
  add column if not exists budget jsonb not null default '{"maxSteps":20,"maxTokens":200000,"maxCostUsd":0.5,"maxIterations":6}'::jsonb,
  add column if not exists harness_version int not null default 1;

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.agents(id) on delete cascade,
  user_id uuid,
  symbol text,
  status text not null default 'pending',
  report_document jsonb,
  trace jsonb not null default '[]'::jsonb,
  budget_used jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_runs_agent_id_idx on public.agent_runs (agent_id);

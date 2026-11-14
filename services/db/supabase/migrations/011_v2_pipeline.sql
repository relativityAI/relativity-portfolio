-- Migration 011: v2 pipeline scaffolding (plan §9, adapted to existing conventions).
-- Idempotent (IF NOT EXISTS) like prior migrations. No RLS anywhere in this
-- project — access control is app-side via requireAuth + service-role client.

-- analysis_runs: mark which pipeline produced a run and pin the rubric/evidence
-- it was scored against, so reports stay auditable after re-compiles.
alter table analysis_runs
  add column if not exists pipeline_version text,
  add column if not exists rubric_id text,
  add column if not exists rubric_hash text,
  add column if not exists evidence_hash text,
  add column if not exists prompt_versions jsonb;

-- Compiled rubrics per agent. md_hash pins the source md; editing the md
-- changes the hash → a fresh rubric compile invalidates the old approval.
-- NOTE: agents.id is TEXT in this schema (001), so agent_id is text, not uuid.
create table if not exists agent_rubrics (
  id text primary key default gen_random_uuid()::text,
  agent_id text not null references agents(id) on delete cascade,
  md_hash text not null,
  compiler_version text not null,
  criteria jsonb not null,
  status text not null default 'draft' check (status in ('draft','approved','auto')),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (agent_id, md_hash, compiler_version)
);

create index if not exists agent_rubrics_agent_idx on agent_rubrics (agent_id, status);

-- stock_features (plan §6.2): flat derived features keyed by stock+data, never
-- by user.
create table if not exists stock_features (
  symbol text not null,
  source text not null,
  data_version text not null,
  as_of date,
  features jsonb not null,
  primary key (symbol, source, data_version)
);

-- stock_events (plan §6.4): classified announcements/news, deduped by doc_hash.
create table if not exists stock_events (
  id bigint generated always as identity primary key,
  symbol text,
  source text,
  doc_hash text unique,
  type text,
  materiality int,
  sentiment text,
  summary text,
  raw_excerpt text,
  as_of date,
  source_ref text,
  model text,
  prompt_version text
);

-- stock_chunks (plan §6.4): filings/concall/news chunks for retrieval.
-- Embedding column added only if RETRIEVAL_VECTOR=1 (pgvector), per D7.
create table if not exists stock_chunks (
  id bigint generated always as identity primary key,
  symbol text,
  source text,
  doc_hash text,
  kind text,
  text text,
  as_of date,
  source_ref text,
  tsv tsvector generated always as (to_tsvector('simple', text)) stored
);

create index if not exists stock_chunks_tsv_idx on stock_chunks using gin (tsv);
create index if not exists stock_chunks_symbol_idx on stock_chunks (symbol, as_of);

-- criterion_verdicts (plan §6.7): per-criterion deterministic judging trail.
-- analysis_runs.id is TEXT (001), so run_id is text.
create table if not exists criterion_verdicts (
  run_id text references analysis_runs(id) on delete cascade,
  criterion_id text,
  kind text,
  verdict text,
  confidence text,
  evidence_ids text[],
  quote text,
  reasoning text,
  votes jsonb,
  model text,
  score_source text,
  cache_hit boolean,
  primary key (run_id, criterion_id)
);

-- verdict_cache (plan §6.6): keyed dedupe of judge calls.
create table if not exists verdict_cache (
  key text primary key,
  output jsonb not null,
  created_at timestamptz default now()
);
-- NOTE: the stock_pulls (symbol, source)-unique dedupe constraint is deferred
-- to Phase 4 (it changes per-user semantics; 002's key is per-user). Verify
-- existing data before adding it there.
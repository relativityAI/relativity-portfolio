# Relativity Portfolio — Analysis Workflow v3 (Skills), End to End

**2026-09-26 — full redesign.** The v2 rubric/judge pipeline and the qualitative/quantitative agent schema are retired (archived under `archives/`). Every design decision and its rationale lives in `docs/2026-09-26-analysis-redesign-decisions.md`.

## 0. The model

An **agent** is no longer a grid of criteria. It is:

```
{ name, description,
  persona.philosophy,                     // the investor's voice, injected into every skill run
  configuration { investment_horizon, risk_appetite },
  skills: [ { skill_id, weight }, ... ]   // ordered; weight 1-10
}
```

A **skill** is a self-contained markdown document (`api/config/skills/*.md` built-ins, per-user rows in the `skills` table for customs):

```
---
id: dcf-valuation
name: DCF Valuation
description: ...
category: valuation|fundamentals|qualitative|market|macro|custom
version: 1
---
## Purpose          — what it investigates and why
## Data             — "- tool_name" allowlist for this skill's analyst
## Method           — ordered analysis steps
## Verdict Anchors  — "- claim — weight N" (optional; findings-only when absent)
## Charts           — "- type: line | title: ... | data: series_key" (optional)
## Output Template  — reporting instructions for the analyst
```

The invariant survives from v1 unchanged: **the LLM scores nothing authoritative.** Analysts return verdicts (YES/PARTIAL/NO/INSUFFICIENT + evidence); code aggregates. INSUFFICIENT is unscored — it reduces coverage, never inflates or silently lowers a number.

## 1. The pipeline (both orchestrators: `run.ts` local + `inngest.ts` durable)

Steps: `agent → data → pull → skills → scorecard → finalize`.

1. **agent** — `loadAgent` parses the agent md (v3 grammar: frontmatter + Philosophy + Skills). A row still in the v2 format is **migrated lazily on load**: qualitative params become a generated "…Custom Checklist" skill, quantitative rules a generated "…Quant Screen" skill (both saved to the user's `skills` table), and the v3 md is written back. Legacy columns are never mutated.
2. **data / pull** — unchanged from v1: availability check, freshness cascade, Voyager pull with adoption + polling.
3. **skills** — fetch the metrics snapshot (feeds deterministic rule screens + adequacy), resolve web-search effectiveness, then `runAllSkills`: **one focused analyst per skill**, concurrency 3, through the shared harness (retries, key failover, zero-tool gate, trace streaming). Each analyst gets ONLY the tools its Data section lists (plus `web_search` when enabled and `get_pull_job_status` for async doc jobs). Structured output (`generateObject`): findings, verdicts with evidence, chart requests, tools used.
   - **Quant-screen skills** (the migrated numeric rules) bypass the LLM entirely: `runQuantScreen` evaluates each rule in code against the snapshot with v1's soft-boundary decay; unknown metric → INSUFFICIENT, not 0.
4. **scorecard** — `aggregateSkillOutputs`: per-skill score = (Y=1, P=0.5, N=0) ÷ assessable; total = weight-weighted mean over scored skills; unscored skills widen the `fit_low–fit_high` band and drop coverage. Code renders the Skill Scores / Aggregate / per-skill verdict tables.
5. **finalize** — one `synthesizeSkillReport` pass over the structured skill outputs (persona-framed, numbers-it-was-given only); skill-declared charts are assembled **in code** (candlestick/RSI/volume from the market-data client; everything else grounded from tool evidence); `sanitizeReport` drops any block citing numbers outside the allowlist; `heroPct` is clamped to the stored total. Persisted: `skill_outputs`, `pipeline_version: "v3-skills"`, scores, band, coverage, report.

## 2. Tools (D6 audit)

Analyst-facing catalog (reconciled against Voyager's live API, 2026-09-29 report): `get_financial_metrics` (now with `fields=` subsetting and explicit `data_available:false` handling), `compare_financial_metrics` (new — `/financial-metrics/batch`, up to 10 symbols in one call), `search_symbol` (new — company-name → ticker resolution via `/search`), `get_financials` (+ income/balance/cash-flow), `get_announcements`, `get_shareholdings`, `get_market_news`, `get_ticker_news`, `search_news` (new — DDG news vertical, Tavily news when keyed), `search_reddit`, `search_youtube` + transcript, `parse_pdf_document` + `get_document_index`, `get_pull_job_status` (doc jobs only), `read_latest_transcript` / `read_latest_presentation` / `read_pdf` / `search_company_documents`, `list_categories`, `get_price_history` (Yahoo OHLCV + SMA 20/50/200 + RSI(14) + 52-week range), `get_macro_snapshot` (assembled in code from live index history — Voyager's `/macro` endpoint is gone), `web_search` (free DDG default; Tavily when keyed).

**Removed (endpoints no longer exist on Voyager):** `get_dcf_valuation` (`/dcf`), `analyze_management_sentiment` (`/sentiment/management`) — valuation now reasons from real filings via the metrics/statements tools; the `dcf-valuation` skill was rewritten (v2) around them.

**Removed from analysts:** `get_pull_status`, `trigger_data_pull`, `list_pull_jobs` — pulls are pipeline-owned (steps data/pull). Symbol binding, SSRF guard, and untrusted-content wrapping are unchanged.

## 3. API surface (new)

- `GET /skills` (builtin + mine), `GET /skills/:id` (with markdown), `POST /skills` (upsert custom from markdown), `POST /skills/validate`, `DELETE /skills/:id` (customs only).
- `POST /skills/draft` — AI skill authoring: conversational turns (optional Tavily research) → complete skill markdown, **validated by the real parser before it is shown**, so the chat can only propose loadable skills.
- Agent routes (`/agents*`) now speak v3: `{ name, description, philosophy/persona, configuration, skills[] }`; `/agents/validate-md` parses the v3 grammar; migration happens transparently on load.
- Migration 013 (`api/supabase/migrations/`): `skills` table + `analysis_runs.skill_outputs` / `pipeline_version`.

## 4. UI

- **Agent builder**: Overview → Configuration → Persona → **Skills** (library browser with category filters, attach/remove/reorder, per-skill weight, "Draft skill with AI" chat panel). Asset/Macro evaluation sections are gone; per-section markdown editor reads the v3 grammar.
- **Analysis result**: new **Skill Breakdown** section (one card per skill: verdict table, findings, score, coverage, tools used, rule-based badge for deterministic skills) rendered above the legacy breakdowns; report blocks support `chartType: "candlestick"` via `lightweight-charts` (candles + SMA overlays).

## 5. What was retired

- v2 rubric/judge/KB **scoring** machinery (`judge.ts`, `score.ts`, `rubric.ts`, `rubricStore.ts` → `archives/v2-pipeline/`; KB ingest stays as a document cache). `kb/features`, `evidence`, `predicates` remain as libraries.
- Old agent UI sections (`AgentQualitative`, `AgentQuantitative`, `AssetEvalSection`, `MacroEvalSection`) → `archives/ui-v2-sections/`.
- The v2 grammar parser (`mdconfig.ts`) is kept **only** for the one-time lazy migration.

## 6. Tests

`api`: 284 passing — includes new suites for the skill parser (+ every built-in file), aggregation honesty properties (INSUFFICIENT ≠ 0, error ≠ 0, band widening), the deterministic quant screen, and v3 agent store/migration. `ui`: 45 passing, including the section-markdown v3 round-trips.

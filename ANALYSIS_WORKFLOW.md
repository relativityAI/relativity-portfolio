# Relativity Portfolio — Analysis Workflow, End to End

## 0. Actors & topology

Five moving parts. UI never talks to anything but the API; the API talks to everything else.

| Actor | Where | Role |
|---|---|---|
| **React UI** | `ui/` (Vite + Chakra) | Form → `POST /api/analysis`; polls `GET /api/analysis/:id`; consumes SSE stream; renders report blocks |
| **Express API** | `api/` port 8080 | Auth, agent store, run orchestration, LLM calls, deterministic scoring, PDF |
| **Supabase / Postgres** | external | `agents`, `analysis_runs`, `user_settings`, `stock_pulls`, `api_usage` |
| **Voyager** | hosted (`VOYAGER_URL`) | Data service: financials snapshots, statements, announcements, news, social, DCF, pull jobs |
| **LLM providers** | OpenAI/Gemini/Anthropic/Cerebras/Groq/OpenRouter/Ollama | The qualitative "analyst" tool-loop, planning, report synthesis |
| **Tavily** | external | Optional web search for the analysts |

Auth is a Supabase JWT verified server-side against the project's JWKS (`api/src/auth.ts:52`). Every authenticated request also triggers lazy `ensureUserSettings`, which **auto-provisions a Voyager key** (`api/src/provision.ts`) — so a brand-new user has a working run with zero setup provided `VOYAGER_ADMIN_KEY` is set.

---

## 1. The inputs — what config actually is

### 1a. The **Agent** (the "style") — a markdown file

The single source of truth for an agent is a markdown document (`api/src/mdconfig.ts`). Frontmatter holds identity/horizon/risk; sections hold the actual evaluation criteria. This is what a preset looks like (`api/config/presets/buffett.md`) and what every saved agent round-trips through.

```
---
name: Warren Buffett
description: ...
investment_horizon: Long-term (years)
risk_appetite: 4
---
## Philosophy                    → persona.philosophy_and_mindset (prose)
## Asset Evaluation
### Qualitative
#### Economic Moat — weight 9    → qualitative param, weight 1-10
   prose = scoring checklist
### Quantitative
| Metric | Rule | Weight |        → quantitative rule
|---|---|---|
| Return on Equity | > 15% | 8 |
## Macro Evaluation               → same shape as Asset
```

Parse rules in `mdconfig.ts:188`:
- `> 15%`, `55 to 75`, `= Yes` → `parseRule` (`mdconfig.ts:109`) produces `{operator, value, value_upper?, metric_type}`. `metric_type` is inferred from the literal: `%`, `₹/$`, ISO date, bare number, else text.
- Metric names are resolved to catalog ids via `findMetricId` (`metrics.ts:115`); unknown names still pass through (warn only), and the snapshot lookup falls back to permissive key scanning.
- Unknown frontmatter keys and unknown `##` sections survive **verbatim** as "opaque blocks" (`serializeMd`, `mdconfig.ts:355`) — hand-edited custom sections are never clobbered.

The canonical runtime shape is `AgentConfig` (`mdconfig.ts:52`): `{name, description, persona.configuration, asset_evaluation, macro_evaluation}` where each evaluation section is `{qualitative: [{parameter, content, weightage}], quantitative: [{metric, metric_name, metric_type, operator, value, value_upper, weightage}]}`.

Storage: the markdown is saved to `agents.md_config` (JSONB columns `persona/configuration/asset_evaluation/macro_evaluation` are a legacy fallback). Reading is md-first: `agentFromRow` → `loadAgent` (`agentstore.ts:132`).

### 1b. The **run request** — everything else (post-auth)

`POST /api/analysis` body (`index.ts:463`, typed as `RunRequest` in `run.ts:95`):

| Field | Meaning | Source in UI |
|---|---|---|
| `symbol` | Exchange ticker (`RELIANCE`, `AAPL`) | SearchBar selection (`Analysis.tsx:862`) |
| `share_name` | Human company name | Same search row (`Analysis.tsx:861`) |
| `agent_name` | Agent **id** (or name) | Agent dropdown from `GET /agents` |
| `model` | `provider/model-id` | Dropdown from `GET /models`, validated via `POST /models/validate` |
| `source` | `NSE` or `SEC` | Segmented control — a property of the **run, not the agent** |
| `web_search` | boolean | Toggle, only rendered if a Tavily key exists |
| `documents` / `web_sources` | arrays | Typed + accepted by the backend, **never populated by the UI today** |

UI preflight (informational only, never blocking): `GET /analysis/data-status?symbol=&source=` (`Analysis.tsx:977`) checks Voyager pull status + local freshness, rendered as "Live data on file" or "data will be pulled when the run starts".

---

## 2. Entry → `createRun` (the request lifetime)

`index.ts` route → `createRun(runReq)` (`run.ts:275`):

1. **Dedupe** (`run.ts:285`): if a `PENDING`/`RUNNING` run with the same `user_id + symbol` exists, return its id instead of spawning a duplicate (double-submit, retry, two tabs).
2. **Insert** a fully-shaped `PENDING` row into `analysis_runs` (`run.ts:300`) — pre-populated with `initialSteps()` (the 7 steps), empty score/analysis fields, `status: "PENDING"`, `model: req.model || getModelIds()[0]`. Schema: `analysis_runs` (`001_initial.sql:20` + migrations 004/005/009/010).
   - Schema-drift guard (`run.ts:391`): if migration 010 (`fit_low/fit_high/coverage`) isn't applied, PostgREST's PGRST204 is detected and the insert/update **retried without those columns**, logging loudly.
3. **Dispatch**: if `INNGEST_EVENT_KEY` is set, `inngest.send({name: "analysis/run.requested"})` → the durable Inngest function. Otherwise, or if dispatch throws, execute **locally in-process** (`executeRun(runId, req)` fire-and-forget). Returns `202 {analysis_id}` immediately.

So there are **two orchestrators** that are deliberately kept in behavioral parity (`run.ts` local + `inngest.ts, analysis-run-pipeline`). Inngest gives: durable step replay, per-step retries (2), same-symbol serialization via concurrency key, and an `onFailure` hook that marks the run `FAILED` (`inngest.ts:48`). The local runner is the dev/self-host fallback.

---

## 3. The orchestrator skeleton (shared by both paths)

`executeRun` (`run.ts:452`) sets up four cross-cutting mechanisms before the first step:

- **Write queue** (`run.ts:460`): every DB patch to `analysis_runs` serializes through a promise chain so out-of-order snapshots (throttled trace flushes, status writes) can't clobber each other.
- **StepTracker** (`run.ts:189`): the 7 steps (`agent → data → pull → quantitative → qualitative → scorecard → finalize`), each transitioned `pending/running/completed/failed/skipped` with `started_at/duration_ms/detail`, persisted on every change.
- **TraceCollector + traceHub** (`trace.ts`): every LLM thought, tool call, result, and step transition is pushed as a `TraceEvent` to an in-process ring-buffered pub/sub (`traceHub`). SSE subscribers (`GET /analysis/:id/stream`) get events live; the collector also **persists the trace array to the DB on a 1.5 s throttle** (`TraceCollector.push`) plus final flush, so the reasoning tab survives page reloads.
- **Fill-in values**: `voyagerKey/llmKeys` decrypted from `user_settings` (`provision.ts:156`); `modelId = req.model || keyPool.getDefaultModel(llmKeys)` (quota-aware); `source = req.source || "NSE"` mapped via `toCountrySource` → `{country, source}` (`voyager.ts:334`).

---

## 4. Step by step

### Step 1 — `agent` · Load agent configuration
`loadAgent(userId, agent_name)` (`agentstore.ts:132`) → row lookups by name-or-id, parse the markdown (`parseMd`), zod-validate via `agentSchema` (`validateConfig`). Warn-level md issues are logged; a hard parse error throws → run fails.

### Step 2 — `data` · Check data availability
`voyager.getPullStatus(symbol, country, source)` (`voyager.ts:236`) hits `GET /pull`. Wrapped in a **60 s deadline** (`withDeadline`, `run.ts:116`) — Voyager cold-sleeps on Render's free tier, so an unconfirmed check **continues the run** instead of hanging it. Persisted as `data_availability`.

### Step 3 — `pull` · Ensure fresh data
`ensureFreshData` (`freshness.ts:268`), cascading freshness checks:
1. **Local fast path**: `isDataFresh` — `stock_pulls` row with `completed` status and `last_pulled_at` within 7 days (`FRESHNESS_FUNDAMENTAL_MS`).
2. **Voyager check**: if Voyager reports a fresh `last_pull` (< 7 d), copy it to `stock_pulls` and skip.
3. **Trigger a pull**: `POST /pull` (NSE only — SEC returns "unsupported"). Handles `409` (job already in flight) with retries then **adoption of the running job** (`adoptRunningPull`); polls `GET /pull/jobs/:id` every 5 s up to 5 min; upserts `stock_pulls` status (`pulling/completed/failed/timeout`).
   - An in-memory map `activePulls` (`${symbol}:${source}:${userId}`) dedupes concurrent pulls for the same stock-user.
   - Pull failure or timeout is **non-fatal** — the run proceeds with whatever data exists and marks the step `failed`.

### Step 4 — `quantitative` · Deterministic scoring from a single metrics snapshot
`fetchMetricsSnapshot` (`quant.ts:191`) → `GET /financial-metrics?symbol&source&consolidated&filing_type=ttm`. This is the **single** quant data source (the legacy `/equity/data/*` endpoints don't exist in deployed Voyager).

Two outcomes:
- **Outage ≠ no data** (`quant.ts:167` `isMetricsOutage`, `OUTAGE_STATUSES`): a provider/auth/rate-limit/circuit-open failure — *or a 400/404 "no data"* — no longer kills the run. `unscoredQuantResult` (`quant.ts:457`) builds the full quant table where **every criterion is `null` with `unscored_reason: "error"`**. The run degrades to qual-only, the band widens, coverage → 0, and the report states the gap (`degraded:`).
- **Scored path**: `runQuantitative(agent, metrics, price_data)` (`quant.ts:408`).

Per criterion `evaluateMetric` (`quant.ts:334`):
- Resolve metric id → recursive value lookup in the snapshot (`_findMetric`, case-insensitive, category-scoped, with `METRIC_ALIASES` like `roe → returnonequity`).
- **Missing value → `null`, not 0** (`unscored_reason: missing_data` / `price_unavailable` for `market`/`valuation` categories when the price feed is down).
- Numeric evaluation uses a **triangular soft-boundary decay** around the threshold (`_linearDecay`, `quant.ts:246`): `spread = max(|threshold|,1)*0.5`; `> threshold` gives 1, misses decay linearly from 1 at threshold to 0 at ±spread. Dates/text are binary. The single 0..1 → 0..100 conversion point is `Math.round(s01 * 10000)/100` (`quant.ts:400`).
- Keys are `${section}:${idx}:${metric}` so two rules on the same metric never collide (A9).
- **Optional LLM judge overlay** (`runQuantitativeLLM`, `quant.ts:563`): **off by default** — deterministic only unless `QUANT_LLM_JUDGE=1`. When on, a JSON-only prompt may re-score numeric criteria for partial credit; every override is flagged `scored_by: "llm"` and the aggregate recomputed. On any failure the deterministic scores are kept.

Then `assessDataAdequacy(pullStatus, metrics)` (`quant.ts:232`) → `inadequate | sparse | adequate` (record count < 50 or metric keys < 10 → sparse; both 0 → inadequate). `resolveWebSearch` (`run.ts:222`) turns that into `web_search_effective = user | auto | off`: explicit user choice wins; otherwise auto-enable only if data is inadequate *and* a Tavily key exists.

### Step 5 (new, cheap) — `plan` · The agent picks its own tactics
`planAnalyze` (`agent.ts:532`) — one `generateObject` call against `AnalysisPlanSchema` (`agent.ts:509`): the model decides, per qualitative parameter, a **tactic** + which **tools** to lean on, plus the final report's **charts/tables/sections** outline. Failure → `EMPTY_PLAN` fallback. This is the agent's plan, not a hardcoded template. Not a tracked "step", but logged and injected into the scoring prompts and the synthesis prompt.

### Step 6 — `qualitative` · The LLM tool-loop, per parameter
`runQualitativeAll` (`agent.ts:596`) flattens asset + macro qualitative params (each tagged `section`) and scores them **3 at a time** (`QUAL_CONCURRENCY = 3`, `mapWithConcurrency`), preserving order.

Per parameter → `runQualitative` (`agent.ts:279`):

1. **Key resolution**: `keyPool.pickKey(modelId, llmKeys)` — user's own key wins if set, else the least-used/quota-aware server-pool key; failures put keys in 60 s cooldown and the pool rotates (`keypool.ts:150`).
2. **Toolset**: `buildTools(toolCtx, {analyst:true})` (`tools.ts:192`). Analyst set is **read-only, symbol-bound**:
   - The analyzed `symbol/source` are **bound in the closure** — model-supplied symbol args are ignored (C2). `trigger_data_pull` and `list_pull_jobs` are stripped (C2/exclusion).
   - SSRF guard on `read_pdf`: protocol+allowlist+private-IP block, size cap (`tools.ts:116`).
   - Every web/PDF/social result is wrapped `[UNTRUSTED …]` so injected directives stay delimited (C3); outage tool errors return `{unavailable:true, reason:"service_unavailable"}` (B7).
   - Macro params get a different prompt framing ("the market is the subject") and `web_search` without the company-suffix (B6).
3. **Turn**: `runAgentTurn` (harness) → `streamText` with `stopWhen: isStepCount(maxToolSteps=10)`, `toolChoice` unforced (see harness below).
4. **Score extraction**: `parseFinalScoreResult` regexes the trailing `FINAL_SCORE: NN` (`agent.ts:488`).
5. **Recovery ladder** (only if the score wasn't found):
   a. `recoverScore` — re-ask `temperature 0, 8 tokens` for just the integer (`agent.ts:127`).
   b. `verdictRecovery` — a fresh **no-tools** turn against `QUALITATIVE_VERDICT_SYSTEM_PROMPT` fed the already-gathered research + tool evidence (2 tries, 3 s apart) (`agent.ts:182`).
   c. Last-resort integer scrape of the verdict.
   - Provider errors are retried once by `runQualitativeAll` on a *different* key (the failed key is in cooldown) (`agent.ts:650`).
6. **Zero-tool gate** (A11): a completion that **never called a data tool is UNSCORED**, not a memory guess and not 0 (`agent.ts:667`).
7. **Trace**: thoughts (streamed reasoning deltas), tool calls, results, and the final `decision` event stream out per parameter.

After all params: `parseQualStructure` (`agent.ts:737`) splits each analysis into `CHECKLIST → RISKS → CONCLUSION → FINAL_SCORE`, parses verdict lines (`YES/PARTIAL/NO/INSUFFICIENT DATA` at line-end), and **recomputes the authoritative score in code** via `scoreChecklist` (`scoring.ts:196`): credits = Y=1, P=0.5, N=0, `INSUFFICIENT DATA` = unscored; `score = credits/assessable × 100`. The LLM's `FINAL_SCORE` is kept only as `llm_final_score` for audit. Then `aggregateWeightedScores` → pillar score + band + coverage.

### Step 7 — `scorecard` · Deterministic summary tables
`buildScoreTables` (`agent.ts:1119`) renders the Quant table, Qual table (with verdict counts like `3Y / 1P / 2N / 1 insuff.`), and Aggregate table from **scored data by code**. The LLM never authors these — no dropped rows, no rescaled weights, no invented totals (plan D2).

### Step 8 — `finalize` · Aggregate, synthesize, sanitize, persist
1. **Pillar combination** (`combinePillars`, `scoring.ts:135`): quant + qual, each weight 1. **Null pillars are excluded** from the point estimate but widen the band (a scored `0` is a real 0 and counts — the old `score > 0` test that turned `(0, 80)` into 80 is gone). `total_score`, `fit_low`, `fit_high`, `coverage`.
2. **Run status logic** (`run.ts:776`): `COMPLETED` unless **everything** failed to score (all-qual-failed, or nothing scored with no criteria) → then `FAILED` with an explicit reason.
3. **Report synthesis** (`synthesizeReport`, `agent.ts:957`): `generateObject` against `ReportBlockSchema` — a fixed block union (`heading|paragraph|table|chart|callout|quote`). Two attempts, then `buildFallbackReport` (`agent.ts:825`): a fully deterministic report assembled from scored data, flagged `source: "fallback"`. The prompt (`prompts.ts:244`) forbids computing new figures, demands the band+coverage be stated, and demands honest surfacing of INSUFFICIENT DATA / partial credit.
4. **Append** the code-rendered Score Summary tables.
5. **Numeric-integrity hard gate** (`sanitizeReport`, `agent.ts:1025`): `collectKnownValues` gathers every number that legitimately existed (scores, thresholds, tool args/results — `run.ts:25`). Any table cell or chart point that can't trace back to a known value **drops that block**; semantic guards drop single-point charts etc. (`dropped` is logged).
6. **Hero override** (`run.ts:838`): `heroPct` is clamped to **our stored total**, never the model's.
7. **Persist** the whole result: scores, `quantitative_analysis`, parsed `qualitative_analysis`, tool calls, report blocks, steps, duration, status.

Any exception anywhere → `failRunningStep` + `markFailed` with the message persisted.

---

## 5. The harness (`runAgentTurn`, `harness.ts`)

Shared by the analysts and the conversational builder so both surfaces behave identically.

- One `streamText` call per attempt. Attempt ladder: with tools forced → `[{tools}, {}]`; otherwise `[{tools}]`. **Never `toolChoice: "required"`** — it would force a tool call on the final round and the model could never write `FINAL_SCORE`. Auto lets the loop **terminate in text**.
- Iterates `fullStream` parts: `text-delta` → text; `reasoning-delta/start/end` → `thought` events and counts as output (thinking-model compatible); `tool-call` → `tool_call` event; `tool-result`/`tool-error` → `tool_result` events with duration. An `error` part mid-stream keeps what was streamed (`streamHadError`) instead of throwing.
- `result.steps` / `result.usage` are awaited **guarded** (`sawOutputPart`) so an empty last step (`AI_NoOutputGeneratedError`) doesn't throw away a useful stream.
- Provider hiccups (`RETRYABLE_ERROR` regex: NoOutputGenerated, ECONNRESET, 429, 5xx, "overloaded", …) retry up to 2× with 3 s waits; hard errors propagate normalized with `retryable`, `userMessage` (e.g. "model can't read PDFs" → actionable advice via `describeInputError`).
- The zero-output gate: forced-tool attempts that produced neither tools nor text come back `error: "Model finished without calling any data tools", retryable: true`.

---

## 6. The prompts (`prompts.ts`) — division of labor

| Prompt | Model does | Code does |
|---|---|---|
| `QUALITATIVE_SCORING_SYSTEM_PROMPT` | Gather tool evidence, decompose into checklist items, mark `YES/PARTIAL/NO/INSUFFICIENT DATA`, risks, echo `FINAL_SCORE` | Parse checklist, **compute** the authoritative score |
| `QUALITATIVE_VERDICT_SYSTEM_PROMPT` | No-tools verdict from supplied research notes only | Numeric scrape |
| `ANALYSIS_PLAN_SYSTEM_PROMPT` | Per-param tactics + report outline | Validate shape, inject |
| `REPORT_SYNTHESIS_SYSTEM_PROMPT` | Present already-scored numbers as narrative blocks | Sanitize numbers, append score tables, clamp hero |

The invariant, stated everywhere and enforced at the end: **the LLM scores nothing authoritative; code owns every number.** The pipeline is "honest scoring" — unknown ≠ 0, coverage explicitly visible, uncertainty band always stated.

---

## 7. Outputs — what the user ends up with

**`analysis_runs` row** (single source of truth for the UI):
- Headline: `total_score`, `quantitative_score`, `qualitative_score`, `fit_low/fit_high` (band), `coverage`, `price_data`, `data_adequacy`, `web_search_effective/note`, `error`.
- Detail: `quantitative_analysis` (per-criterion `value/score/score_0_100/operator/threshold/weightage/unscored_reason`), `qualitative_analysis` (per-param `score_0_100/checklist/checklist_counts/risks/llm_final_score/score_source/coverage`), `qualitative_tool_calls` (raw tool history for provenance chips + disclosures), `trace` (persisted events), `steps`.
- `report`: `{heroPct, heroLabel, blocks[], partial, source: "llm"|"fallback"}`.

**UI rendering** (`AnalysisResult.tsx`):
- Hero CountUp from `report.heroPct`, band chips (Shortlist/Watch/Pass), coverage chip — and coverage below 60% suppresses the confident headline.
- Quant table, Qual table, per-parameter rationale cards (markdown, scaffolding stripped), expandable tool-call disclosures, data-source chips, token usage.
- `ReportBlockRenderer` renders `blocks` — tables and Recharts charts (`bar|line|radar|area|scatter|pie`) from `block.data`.
- Banner if `report.source === "fallback"` (deterministic) or `report.partial`, or `price_data === "unavailable"`.
- **PDF**: `GET /analysis/:id/pdf` → `buildReportPdf` (`pdf.ts`) server-side, same plots.

**Live view during the run**: `GET /analysis/:id/stream` SSE — `traceHub.subscribe` replays buffered events then live ones (`index.ts:605`). `AgentActivity.tsx` renders merged steps + thoughts (streamed deltas concatenated) + tool rows + decisions; the result page forces the *reasoning* tab while running and switches to the persisted `analysis.trace` when done.

---

## 8. Resilience & safety net (the umbrellas)

- **Run dedupe** (DB-level) + **concurrency key** (Inngest-level, `symbol+source`) — no duplicate LLM burns.
- **Stale-run sweeper**: `checkAndFailStaleRun` on every `GET /analysis/:id` — a `PENDING/RUNNING` run untouched for >10 min is marked `FAILED` (`run.ts:253`).
- **Inngest `onFailure`** persists the terminal failure if all retries are exhausted.
- **Voyager resilience** (`voyager.ts`): circuit breaker (15 consecutive, 5 s half-open), 3 retries with exponential backoff, `retry-after` respect, 30 s timeouts tuned for cold-sleep boot.
- **Key pool failover**: quota-aware default model selection, per-key rotation, cooldowns, all-keys-in-cooldown graceful degradation (`keypool.ts`).
- **HTTP rate limit**: 10 POST `/analysis`/min/IP (`index.ts:127`).
- **Data outages degrade, they don't kill**: metrics outage → qual-only estimate + widened band + explicit `degraded` report callout; inadequate data → auto web search.
- **Honesty gates**: unknown ≠ 0, zero-tool = unscored, sanitize ungrounded numbers, code-computed scores, hero clamped.

---

## 9. The one-paragraph version

From the UI you POST `{symbol, share_name, agent_name, model, source, web_search}`. The API inserts a `PENDING` `analysis_runs` row and throws a background executor at it (Inngest, or in-process). It loads the agent from its markdown spec, checks/pulls fresh exchange data via Voyager, scores every quantitative criterion **deterministically** against one metrics snapshot (soft-boundary thresholds, null when unknown), asks an LLM to **plan** research tactics, then spawns up to 3 concurrent **LLM analyst tool-loops** that gather tool evidence per qualitative parameter and emit `FINAL_SCORE` verdicts — which the code re-parses into checklists and **re-scores itself**. Pillars aggregate with an explicit uncertainty band and coverage; deterministic score tables are appended; an LLM synthesizes narrative report blocks (fallback: a fully deterministic report); every number is verified against known values; and the whole artifact — scores, blocks, trace, steps — is persisted and streamed live to the UI over SSE, optionally exported as PDF.

---

## Known gap

`documents` and `web_sources` are plumbed end-to-end (request type → prompt → report sources strip) but **no UI code populates them**, so that path is dormant until the upload/sources UI lands.
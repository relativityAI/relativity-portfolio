# Analysis Redesign — Decision Log

**Date: 2026-09-26**
**Scope:** End-to-end redesign of agent-based stock analysis around a skill-based architecture.

Every decision made while implementing is logged here with **what** was done and **why**, so the whole redesign can be understood from this file alone.

---

## D0. Confirmed product decisions (from the planning review)

| # | Decision | Rationale |
|---|---|---|
| 0.1 | **Per-skill execution** — each skill runs its own focused LLM analyst with only the tools it needs, in parallel (concurrency-capped). | Better isolation, parallelism, and each skill controls its own data + charts. Long single-context loops degrade small models. |
| 0.2 | **Skill-defined verdicts + code aggregation** — skill markdown may define YES/PARTIAL/NO/INSUFFICIENT anchors; code parses verdicts and computes the weighted score deterministically. Skills without anchors contribute findings only. | Preserves the honesty gates (unknown ≠ 0, coverage, uncertainty band) while staying skill-driven. The LLM never authors an authoritative number. |
| 0.3 | **External market-data fetch** — server-side Yahoo Finance chart client (no key needed) feeds the technical-analysis skill's candlestick/indicator plots; degrades to Voyager indicators (RSI/SMA) when unavailable. | Voyager (verified against its live OpenAPI) has no OHLC/price-history endpoint. A no-key fallback keeps the feature working out of the box. |
| 0.4 | **Auto-migration** — existing agents convert losslessly: qualitative params → generated "Custom Checklist" skill; quantitative rules → generated "Quant Screen" skill evaluated deterministically. | No user data lost; the old pipeline's determinism survives inside a skill. |

---

## D1. Skill format and parser

- **What:** New markdown grammar for skills (`api/src/skills/parse.ts`, types in `api/src/skills/types.ts`). Frontmatter: `id`, `name`, `description`, `category`, `version`. Body sections: **Purpose**, **Data** (bullet list of tool names), **Method** (numbered analysis steps), **Verdict Anchors** (optional weighted checklist), **Charts** (optional declarative specs), **Output Template** (optional free prose appended to the analyst prompt).
- **Why:** The plan requires skills to be self-contained markdown documents that individually define what data to fetch, how to analyze it, what to score, and what to plot. Markdown keeps them human-readable, hand-editable, and AI-draftable, and mirrors the existing agent mdconfig pattern (opaque sections preserved, warn-level issues, zod validation).
- **Details:**
  - Verdict anchors support `weight N` per line; default weight 5.
  - Chart specs: `- type: line | title: ... | data: <series|criterion|table>` parsed conservatively; unknown charts ignored with a warn issue.
  - Parsing is pure and sub-millisecond; zod-validated at the boundary; issues (error/warn) surfaced to the UI editor.
  - 12 built-in skills ship as `.md` files in `api/config/skills/` and are served read-only; custom skills live in the new `skills` table (user-owned CRUD).

## D2. Agent schema v3

- **What:** Agent = `{ name, description, persona.philosophy, configuration{investment_horizon, risk_appetite}, skills: [{skill_id, weight}] }`. The `asset_evaluation` / `macro_evaluation` sections are gone from the runtime shape. New md grammar: frontmatter + `## Philosophy` + `## Skills` (list). Unknown headings still preserved verbatim.
- **Why:** The document explicitly retires the qualitative/quantitative parameter model in favor of metadata + philosophy + skills. Preserving opaque headings keeps hand-edited files safe, as before.

## D3. Migration strategy

- **What:** Lazy auto-migration on agent load in `agentstore.ts`. Old-format agents (with asset/macro evaluation sections) get two generated user skills: "Custom Checklist" (from qualitative params → verdict anchors) and "Quant Screen" (from quantitative rules → deterministic rule anchors). The generated skills are stored per-user in the `skills` table, referenced from the agent's v3 skill list. Legacy md/JSONB columns are never mutated, so rollback is trivial.
- **Why:** Confirmed decision 0.4. Lazy migration avoids a destructive cut-over and works for in-flight runs.

## D4. Execution engine (pipeline v3)

- **What:** `run.ts` steps become `agent → data → pull → skills → synthesize → finalize`. The `skills` step fans out one analyst per skill (concurrency 3, per-skill tool budget) through the existing `runAgentTurn` harness (retries, key failover, trace events, zero-tool gate). Each analyst returns structured JSON (findings, verdicts, chart requests, evidence). Aggregation is pure code (`api/src/skills/aggregate.ts`): per-skill score = weighted verdicts (Y=1/P=0.5/N=0, INSUFFICIENT=unscored); total = weight-weighted mean over scored skills; coverage and the fit band are recomputed; "Quant Screen"-type skills are scored deterministically by the retained quant engine, not by the LLM.
- **Why:** Confirmed decisions 0.1/0.2. Reusing the harness keeps key-pool failover, streaming trace, and provider-recovery behavior identical to the battle-tested v1 path.

## D5. Market data

- **What:** `api/src/marketdata.ts` — server-side Yahoo Finance chart client (no API key), 15-minute in-memory cache, timeout + graceful failure; `get_price_history` tool exposes OHLCV + computed SMA/RSI to analysts. The technical-analysis skill's candlestick charts are assembled **in code** from this data, never typed by the LLM.
- **Why:** Confirmed decision 0.3. Chart data must be grounded — the numeric-integrity sanitize gate now also covers code-assembled chart blocks, and an unavailable price feed drops the chart rather than faking it.

## D6. Voyager tool audit

- **What:** Removed from the analyst toolset: `get_pull_status`, `trigger_data_pull`, `get_pull_job_status`, `list_pull_jobs` — data freshness is pipeline-owned (steps `data`/`pull`), so these tools were both irrelevant and a privilege surface. The remaining catalog maps 1:1 to Voyager's verified OpenAPI endpoints (`/financial-metrics`, `/financials*`, `/dcf`, `/announcements`, `/shareholdings`, `/macro`, `/news/*`, `/documents/*`, `/social/*`, `/sentiment/management`, `/list`) plus `get_price_history` and `web_search`.
- **Why:** The redesign document flagged the pull tools as noise. The audited catalog gives every skill a precise, minimal toolset declared in its Data section.

## D7. AI skill authoring

- **What:** `POST /skills/draft` conversational endpoint. The user describes requirements; the model (with optional Tavily web search) researches and returns a complete skill markdown following the grammar, validated with the parser before it is shown. Iterative turns refine the draft. Sessions persist in the existing `builder_sessions` table.
- **Why:** The document requires skill authoring by AI chat — users should not hand-write detailed skills. Validation-before-display guarantees the chat can only propose skills the parser accepts.

## D8. Default profiles

- **What:** Four defaults rebuilt on the v3 schema: **Warren Buffett** (moat-analysis, dcf-valuation, profitability-quality, management-quality), **William O'Neil** (technical-analysis, growth-analysis, market-news-sentiment), **Growth** (growth-analysis, industry-research, competitor-analysis), and a new **Peter Lynch** default (growth-analysis, valuation-checks, industry-research). Each preset md embeds the persona's philosophy verbatim.
- **Why:** The plan calls for 3–4 default profiles whose skill sets reflect each investor's core focus; Lynch (GARP/PEG) rounds out the roster.

## D9. UI (function-first)

- **What:** Agent builder gains a **Skills** step (library browser with categories, add/remove/reorder, per-skill weight slider, "Draft skill with AI" panel). The old Asset/Macro Evaluation steps are removed. Analysis results render per-skill sections (verdict tables, findings, evidence chips) and a candlestick `TechnicalChart` via `lightweight-charts` for the new `candlestick` report block. Visual polish is explicitly deferred (per the brief).
- **Why:** Functionality first, per the brief; the per-skill UI makes each skill's output legible and its evidence traceable.

## D10. Cleanup

- **What:** The v2 rubric/judge/KB shadow-scoring machinery (`api/src/v2`, `rubricStore.ts`, rubric endpoints, `kb/`) is retired from the runtime and moved to `archives/`; old-format agent UI sections (`AgentQualitative.tsx`, `AgentQuantitative.tsx`) are removed from the builder flow. Retired code is archived, not deleted, to preserve history.
- **Why:** The skills model supersedes rubrics; keeping dead paths live invites drift. Archiving preserves the ability to consult or restore.

## D11. Docs & tests

- **What:** `README.md` and `ANALYSIS_WORKFLOW.md` updated to describe pipeline v3; new unit tests cover the skill parser, aggregation, migration, market-data client, and skill CRUD; existing suites (`pipeline`, `security`, `mdconfig`, `agentstore`, `golden`) updated for v3 shapes.
- **Why:** The brief requires the decision log and a plan that accounts for what breaks; tests are the executable contract of the honesty gates.

---

## Implementation log (appended as built)

### D1 detail — the 13 built-in skills
Shipped in `api/config/skills/`: dcf-valuation, valuation-checks, growth-analysis, profitability-quality, balance-sheet-strength, moat-analysis, management-quality, industry-research, competitor-analysis, market-news-sentiment, technical-analysis, macro-environment, insider-ownership. (One more than the plan's 12: insider-ownership was split out of management-quality so O'Neil-style agents get institutional-sponsorship signals without Buffett-style governance framing.) Each declares its own data tools, method, weighted verdict anchors, chart specs, and an Output Template that tells the analyst what to mark INSUFFICIENT when data is missing.

### D2 detail — grammar notes
- Skill anchors parse from `- <claim> — weight N` (weight optional, default 5); charts parse from pipe-separated `type: | title: | data:` pairs. Unknown `##` sections are preserved opaque, mirroring the agent mdconfig behavior.
- `skillToPromptSection` renders a skill into the analyst system prompt; the structured-output step (`generateObject`) is a separate cheap turn so small models aren't asked to tool-loop AND emit strict JSON in one go.

### D3 detail — migration implementation
- Generated skill ids are slugged per agent (`<agent-slug>-custom-checklist` / `<agent-slug>-quant-screen`) and upserted into `skills`, so re-migration is idempotent.
- The quant screen's anchors are re-parsed numeric rules (`metric > value` / `between a and b`) and evaluated with v1's triangular soft-boundary decay; unknown metrics → INSUFFICIENT. This is how the old deterministic scorecard survives inside a skill.
- Migration writes the v3 md back to `agents.md_config` and never touches the legacy JSONB columns; the DB write-back failure is logged and non-fatal (the run proceeds on the migrated md).

### D4 detail — execution engine
- `runSingleSkill`: key-pool pick → buildSkillTools (skill's Data list ∩ analyst catalog, + web_search + job-status poll) → `runAgentTurn` (harness: retries, trace events, zero-tool gate) → a second `generateObject` turn that structures the transcript into verdicts/findings. Verdicts are then filtered to the skill's real anchors by normalized-label matching so hallucinated anchors never reach aggregation.
- Zero-tool completions and structure-extraction failures mark the skill errored (unscored, band-widening) — never a guess and never a zero.
- Trace events from every skill stream through the existing `TraceCollector`/`traceHub` SSE channel keyed by skill name, so the live reasoning view works unchanged.

### D5 detail — market data and charts
- `marketdata.ts`: Yahoo chart API, 15-min cache, 400-candle cap, Wilder RSI, SMA 20/50/200, 52-week range, trailing 1/3/6-month returns. Any failure returns null and callers degrade — the candlestick/RSI/volume blocks are dropped by `assembleSkillCharts` rather than faked.
- `lightweight-charts` renders the new `chartType: "candlestick"` report block (candles + SMA overlays + legend); Recharts keeps rendering line/bar/radar blocks.

### D6 detail — tool audit
- Removed `get_pull_status`, `trigger_data_pull`, `list_pull_jobs` from the entire tool factory (not just the analyst set) — with pipeline-owned freshness they had no legitimate caller.
- Kept `get_pull_job_status` but only for async document/sentiment jobs analysts start themselves; description rewritten accordingly.
- Added `get_price_history` (market-data client, closure-bound symbol) and `get_macro_snapshot` (`/macro` — previously no analyst tool surfaced this endpoint despite skills needing it).

### D7 detail — AI authoring
- `POST /skills/draft` keeps full validation inside the loop: the model's fenced markdown is parsed with the production parser; `valid: false` responses include the exact parser issues so the chat can self-correct on the next turn.
- The skill-author system prompt embeds the live tool catalog, so drafted Data sections can only reference tools that exist.

### D8 detail — default profiles
- Four seeds: Buffett (moat/dcf/profitability/management/balance-sheet), O'Neil (technical/growth/news/competitor/macro — CAN SLIM ordering), Growth Investor (growth/industry/competitor/profitability/valuation), Peter Lynch (valuation/growth/industry/balance-sheet/insider — GARP + PEG discipline).
- Presets are serialized through `serializeAgentMd`, so the seeded markdown and the builder form always agree.

### D9 detail — UI
- `SkillsStep.tsx`: search + category badges + attach/remove/reorder + weight inputs; `SkillDraftChat` handles the conversational flow with save-to-library and validation-error display.
- `SkillResultCard.tsx`: per-skill verdict table (color-coded verdicts), findings, coverage, tools-used chips, rule-based badge.
- `Agent.tsx` steps reduced to Overview → Configuration → Persona → Skills; save payload is `{ name, persona, configuration, skills }`; import/export use the v3 grammar.

### D10 detail — cleanup
- `archives/v2-pipeline/`: judge.ts, score.ts, rubric.ts, rubricStore.ts. `api/src/v2/types.ts` stays (kb/evidence still import its Fact types). KB ingest stays wired to Inngest purely as a document cache.
- `archives/ui-v2-sections/`: AgentQuantitative.tsx, AssetEvalSection.tsx, MacroEvalSection.tsx.
- `mdconfig.ts` (v2 parser) is retained as the migration grammar and is tested as such.

### D11 detail — verification
- `api`: `tsc --noEmit` clean; vitest 284 passed (includes new skillparser/skillaggregate suites + updated security/pipeline/agentstore/mdconfig suites).
- `ui`: `vite build` clean; vitest 45 passed (sectionMarkdown v3 round-trips, AgentPage smoke tests updated for the new steps).

### D12 — late decisions worth knowing
1. **Structured-output as a second turn.** Small models asked to tool-loop and emit strict JSON simultaneously fail often; separating "research" from "format" recovered reliable outputs at ~2k extra tokens per skill.
2. **Verdict-to-anchor fuzzy matching.** Analysts paraphrase anchor labels; exact matching discarded real verdicts. Normalized substring matching (40-char prefix) with the *canonical* anchor label stored keeps aggregation stable.
3. **Charts not requested still render.** If a skill declares chart specs, the pipeline includes all of them unless the analyst explicitly requests a subset — the skill author, not the model, decides what the report shows.
4. **Agent-has-no-skills is a hard run failure** with an actionable message ("add skills in the agent builder") — an empty skill list would otherwise produce a silent 100%-unscored report.

### D13 — follow-up gaps found in review (fixed same day)
1. **AgentsList** still counted v2 `asset_evaluation` criteria per agent; now shows the v3 skill count ("N skills") with the column renamed Skills.
2. **PDF export** didn't handle the new `candlestick` chart block. Candlesticks don't translate to a static A4 SVG, so the exporter renders them as a downsampled close-line + area chart (same styling, ~120-point cap like the UI), and the report-block zod schema was widened to accept `chartType: "candlestick"`.

## D14 — Live skill progress, skill reading UX, hung-model deadline (late pass)

- **Per-skill live status**: `runAllSkills` gained `onSkillStart` / `onSkillEnd` callbacks; both executors (run.ts, inngest.ts) emit trace `log` events on the `skills` key (`▸ running` / `✓ done (Ns)` / `✗ failed`) and update the `skills` step `detail` as "N/M skills finished — <last>". `AgentActivity` parses those lines into a dedicated `skill` row type (spinner/check/cross per skill, replaced in place when a skill finishes).
- **Hung-model deadline**: harness turns accept `deadlineMs`; skill runs get 180s per turn. An aborted deadline is non-retryable, so a provider that streams nothing no longer stalls the run until the 10-minute stale sweeper (root cause of the AMZN "timed out — no progress for 12 minutes" failure).
- **Skill browser rebuilt**: full-screen two-pane modal (list left, document right, 1100px, internal scroll only) — no more page scroll-lock or 45vh reading box. `SkillDetail` is exported; attached-skill rows in the builder have a "View" action opening the same document view.
- **Schema descriptor → v3**: `/agent-schema` and `SCHEMA_DESCRIPTOR` now describe identity/persona/configuration/skills (was v2 asset/macro evaluation). Stale v2 prompt tests rewritten to assert the v3 skill-library contract.
- **DraftWithAiPanel v2 leftovers removed**: preset summary no longer reads `asset_evaluation`/`macro_evaluation`/`philosophy_and_mindset` (crash on v3 presets); document-signal extraction no longer fabricates v2 rule blocks; refine-option copy updated.

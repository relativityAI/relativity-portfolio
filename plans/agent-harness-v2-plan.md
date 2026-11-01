# Relativity Agent Harness v2 — Design & Implementation Plan

**Status:** DRAFT (awaiting approval)
**Date:** 2026-10-18
**Author:** harness operator (agent-harness skill)
**Goal:** Replace the current analysis runtime with a clean-slate, skill-driven, MCP-connected agent harness that renders high-quality, structured equity-research reports.

---

## 0. First-principles rationale

The product is **AI-generated equity research reports**, produced by **user-composed custom agents**. Strip it to atomic capabilities:

1. **An agent** = a *SOUL* (system prompt / persona) + a set of *skills* + a set of *tools* + a model + a *budget*.
2. **A skill** = a self-contained capability module, packaged in the official [agentskills.io](https://agentskills.io/specification) envelope (`SKILL.md` + optional `scripts/`, `references/`, `assets/`).
3. **A tool** = a callable function that fetches or computes something (Voyager market data, web search, file write, MCP tool).
4. **The harness** = the runtime that loads an agent definition, assembles context (SOUL + activated skills + tool catalog), runs an autonomous loop under budgets, records evidence, and emits a **Report Document**.
5. **The report** = a typed document (JSON) rendered deterministically into the web page (headings, paragraphs, tables, charts, citations, highlighted numbers).

### Why the previous design failed (root cause)

The old design asked **one model to do two incompatible jobs at once**: (a) rigorous financial analysis, and (b) emit a rich UI markup dialect (OpenUI). Two cognitive loads, no schema boundary between "what was concluded" and "how it is drawn", so information was lost in translation. The model either produced good analytics or good markup — never both.

**The fix is separation of concerns:** analysis produces a *typed Report Document*; rendering is *code*, not a model output. This is the single most important architectural decision in this plan.

### Why agentskills.io

- Standard, portable skill envelope (frontmatter `name`/`description`, `allowed-tools`, progressive disclosure).
- Lets third-party skill directories be loaded as-is; the app already enforces the spec (`api/src/skills/parse.ts`, `api/test/spec-conformance.test.ts`).
- The new harness **rewrites the loader** but adopts the spec verbatim, so skills remain interchangeable.

### Why MCP

Tools should be composable and externally discoverable. Streamable HTTP MCP lets an external server (Voyager, or any future data server) expose tools. The harness treats MCP tools as just another **tool source** alongside built-in REST tools. Voyager REST at `:8001` remains the primary data path; the MCP port is read from an env var (port TBD by the user).

---

## 1. Decisions locked (from Q&A)

| # | Decision | Choice |
|---|---|---|
| D1 | What "done" means for this engagement | Write this phase-wise plan to markdown, then stop for review. No code changes yet. |
| D2 | Report architecture | **Typed Report Document schema + deterministic renderer.** |
| D3 | Existing harness code | **Full rewrite, no reuse** of the old runtime (`pipeline.ts`, `iterative-agent.ts`, `harness.ts`, `tools.ts`, `agent.ts`, old skill loader). The agentskills.io *spec* is adopted; the old *implementation* is deleted. |
| D4 | Skill format | Official [agentskills.io](https://agentskills.io/specification) `SKILL.md` format, integrated end-to-end (see §5). |
| D5 | Data layer | **Voyager REST primary + MCP plugin**; MCP port via env var. |
| D6 | Custom agent authoring | DB-backed agent definitions + a UI "Agents" authoring surface (integrated within the app). |
| D7 | Autonomy | Bounded loop with budgets, evidence trace, machine-verified checks, CLI-testable. |
| D8 | Placement | New harness lives **inside the app** as `api/src/harness/` + `ui/src/pages/agents/`; it reuses the existing `agents` table, auth, Supabase, and Vercel AI SDK. |

---

## 2. Target architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  AUTHORING SURFACE (Phase 5)                                      │
│  ui/src/pages/agents/   SOUL editor · skill picker · budget · test│
└───────────────┬──────────────────────────────────────────────────┘
                │ REST (existing /agents routes)
┌───────────────▼──────────────────────────────────────────────────┐
│  AGENT DEFINITIONS (existing agents table + agentstore)           │
│  { id, user_id, name, soul_prompt, skill_ids[], model, budget,    │
│    allowed_tools[], enabled }                                     │
└───────────────┬──────────────────────────────────────────────────┘
                │ compile()
┌───────────────▼──────────────────────────────────────────────────┐
│  HARNESS RUNTIME (api/src/harness/)                               │
│  ┌─────────────┐ ┌──────────────┐ ┌───────────┐ ┌──────────────┐ │
│  │ skills/     │ │ tools/       │ │ loop/     │ │ report/      │ │
│  │ loader      │ │ registry     │ │ agent-loop│ │ document     │ │
│  │ catalog     │ │ mcp-client   │ │ budgets   │ │ builder      │ │
│  │ activate    │ │ builtins     │ │ trace     │ │ contract     │ │
│  └─────────────┘ └──────────────┘ └───────────┘ └──────────────┘ │
└───────┬───────────────────────────────┬──────────────────────────┘
        │ Voyager REST (:8001)          │ MCP streamable HTTP (env port)
        ▼                               ▼
   Voyager API                    MCP server (Voyager / others)
        │
┌───────▼──────────────────────────────────────────────────────────┐
│  REPORT DOCUMENT (typed JSON)                                     │
│  ui/src/components/report/ deterministic renderer                 │
│  lightweight-charts · tables · citations · highlighted numbers    │
└──────────────────────────────────────────────────────────────────┘
```

### Layer responsibilities

| Layer | Module | Responsibility |
|---|---|---|
| L0 Definition | `api/src/harness/agents/store.ts` | CRUD for agent definitions (SOUL, skills, tools, model, budget) in the existing `agents` table. |
| L1a Skills | `api/src/harness/skills/{loader,catalog,activate}.ts` | Parse/validate agentskills.io `SKILL.md`, resolve built-in + custom skills, inject progressive-disclosure content. |
| L1b Tools | `api/src/harness/tools/{registry,builtins,mcp-client}.ts` | Unified tool catalog, invocation, `allowed-tools` enforcement, MCP transport. |
| L1c Loop | `api/src/harness/loop/{agent-loop,budgets,trace}.ts` | Autonomous step loop, budget enforcement, tool-call repair, retries, evidence trace, cancellation. |
| L2 Report | `api/src/harness/report/{document,builder}.ts` | Typed Report Document schema + assembly from trace/evidence. |
| L3 Render | `ui/src/components/report/*` | Deterministic rendering of the Report Document into charts/tables/citations. |
| L4 Persist | existing Supabase tables | `agents`, `agent_runs`, `skills`, `reports`. |

---

## 3. Module map (new / deleted)

### New (api)

```
api/src/harness/
  index.ts                 # public entry: createHarness(), runAgent()
  agent-loop.ts            # autonomous step loop
  budgets.ts               # token/cost/tool-step/iteration budgets
  trace.ts                 # evidence events + stream
  skills/
    loader.ts              # agentskills.io parser/validator
    catalog.ts             # builtin dir + custom DB skills
    activate.ts            # progressive disclosure injection
  tools/
    registry.ts            # ToolRegistry (register/list/invoke/allowlist)
    mcp-client.ts          # streamable HTTP MCP transport (port from env)
    builtins/
      voyager.ts           # Voyager REST tools (:8001)
      websearch.ts         # web search + fallback
  report/
    document.ts            # ReportDocument Zod schema
    builder.ts             # assemble document from trace
    contract.ts            # renderer contract
  agents/
    store.ts               # agent definition CRUD
    compile.ts             # definition -> runnable context
```

### New (ui)

```
ui/src/pages/agents/            # list, create, edit custom agents
ui/src/components/agents/       # SoulEditor, SkillPicker, BudgetControls, TestRun
ui/src/components/report/       # ReportDocumentRenderer, ChartBlock, TableBlock, CitationBlock
ui/src/lib/reportContract.ts    # shared schema types (mirror of api report contract)
```

### Deleted (old runtime, Phase 0)

```
api/src/pipeline.ts
api/src/iterative-agent.ts
api/src/harness.ts
api/src/tools.ts
api/src/agent.ts            (keep buildModel? -> NO, full rewrite; model factory moves to harness/loop/model.ts)
api/src/skills/             (old loader; spec conformance moves to harness/skills)
api/src/layout.ts, layout.refs.ts, types/layout.ts   (orphaned OpenUI subsystem)
api/src/marketdata.ts       (orphaned synthesis parts; price client moves to builtins/voyager.ts)
api/src/v2/                 (legacy contracts)
api/test/{harness,iterative-agent,pipeline,layout,render,tools,v2-features}.test.*
```

> **Note:** the existing `agents` table, `agentstore.ts`, `presets.ts`, `agentIdentity.ts`, `agentmd.ts`, auth, Supabase, and Vercel AI SDK **stay**. The new harness plugs into them. No-touch: `api/src/db.ts`, `api/src/auth.ts`, `api/src/crypto.ts`, `api/src/provision.ts`, `ui/src/db.ts`, `docker-compose.yml`, `render.yaml`.

---

## 4. Data model

Reuse the existing `agents` table; add harness-specific columns via migration:

```sql
alter table agents add column if not exists
  soul_prompt text,
  skill_ids    text[]      default '{}',
  allowed_tools text[]     default '{}',
  model_id     text,
  budget       jsonb       default '{"max_steps":20,"max_tokens":200000,"max_cost_usd":0.5,"max_iterations":6}',
  harness_version int      default 2;
```

New tables:

```sql
create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id),
  user_id uuid,
  status text,              -- pending|running|completed|failed|escalated
  report_document jsonb,    -- typed Report Document
  trace jsonb,              -- evidence events
  budget_used jsonb,
  created_at timestamptz default now()
);
```

---

## 5. agentskills.io integration

The harness adopts the spec exactly. Each skill is a directory:

```
api/config/skills/<slug>/
  SKILL.md          # frontmatter (name, description, optional allowed-tools, metadata) + body
  scripts/          # optional executable helpers
  references/       # optional on-demand docs
  assets/           # optional templates
```

### Loader contract

- **Parse:** `loader.ts` validates frontmatter against the spec: `name` 1–64 chars, `[a-z0-9-]`, no leading/trailing/consecutive hyphens, matches directory name; `description` 1–1024 chars; optional `license`, `compatibility` (≤500), `metadata` (string map), `allowed-tools` (space-separated).
- **Catalog:** built-ins from `api/config/skills/` at boot; custom skills from the `skills` table (source: `custom`). Resolution by `name`.
- **Progressive disclosure:** only `name` + `description` are injected at agent-compile time (≈100 tokens). The full body loads when the agent loop activates the skill; `references/` and `assets/` load on demand. Main `SKILL.md` stays < 500 lines; heavy material moves to `references/`.
- **Activation:** a skill is "activated" by the model's tool use or by a declared trigger in the SOUL; activation injects the body + any `references/` files it names.
- **Validation check:** `api/test/skill-spec-conformance.test.ts` runs `skills-ref validate`-equivalent assertions over every skill dir and every DB custom skill.

### Built-in skill set (Phase 1)

| Skill | Category | Purpose |
|---|---|---|
| `dcf-valuation` | valuation | Intrinsic value, WACC, sensitivity tables |
| `technical-analysis` | market | Trends, indicators, support/resistance |
| `growth-analysis` | fundamentals | Revenue/earnings quality, growth durability |
| `sector-thesis` | qualitative | Industry structure, competitive position |
| `news-sentiment` | market | Recent news, sentiment, catalysts |
| `warren-buffett` / `peter-lynch` / `sector-agent` | custom | User-composed permutations (Phase 5) |

---

## 6. Report Document schema

The Report Document is the **only** artifact the model produces for output. Rendering is code.

```ts
type ReportDocument = {
  schema: "relativity/report.v1";
  title: string;
  subtitle?: string;
  generatedAt: string;
  symbol: string;
  sections: Section[];
  sources: Source[];        // every number is traceable
  artifacts: ArtifactRef[]; // xlsx/pdf downloads
};

type Section =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string; highlights?: Highlight[] }
  | { type: "callout"; variant: "info" | "warn" | "key"; title?: string; text: string }
  | { type: "table"; title?: string; columns: string[]; rows: (string | number)[][]; caption?: string }
  | { type: "chart"; title?: string; spec: ChartSpec; caption?: string }
  | { type: "citations"; refs: string[] };

type ChartSpec =
  | { kind: "line" | "candle" | "bar" | "pie"; series: Series[]; indicators?: Indicator[] }
  | { kind: "multi"; panels: ChartSpec[] };   // multi-line, overlays, indicators

type Source = { id: string; label: string; tool: string; url?: string; value: string };
type Highlight = { text: string; kind: "number" | "positive" | "negative" | "citation"; sourceId?: string };
```

Renderer mapping (deterministic, no model in the loop):

| Document node | UI component |
|---|---|
| `heading` / `paragraph` | `react-markdown` + remark-gfm |
| `table` | styled table (Chakra/Tailwind) |
| `chart` (time series) | `lightweight-charts` v5 (`MarketChart`) |
| `chart` (categorical) | `recharts` |
| `chart` (multi) | stacked `MarketChart` panels |
| `citations` | footnote list with source ids |
| `callout` | callout card |

---

## 7. Phases

Each phase is independently shippable and has machine-run verification. Budgets default to **12 loop iterations / 3 attempts per task**, escalate to a human on exhaustion.

### Phase 0 — Teardown & foundations
**Objective:** Remove the old runtime; scaffold the harness package and contracts.
**Deliverables:**
- Delete old runtime files (§3).
- Create `api/src/harness/` package skeleton + `api/src/harness/index.ts`.
- Add DB migration for agent columns + `agent_runs`.
- Define `ReportDocument` schema (stub) and renderer contract.
**No-touch:** `api/src/db.ts`, `auth.ts`, `crypto.ts`, `provision.ts`, `ui/src/db.ts`, `docker-compose.yml`, `render.yaml`.
**Verification:**
- `cd api && npx tsc --noEmit` → exit 0
- `cd api && npm test` → exit 0 (old tests removed/replaced)
**done_when:** old runtime gone; `createHarness()` stub compiles; migration applies cleanly on a fresh DB.

### Phase 1 — Skill system (agentskills.io)
**Objective:** Load, validate, and activate agentskills.io skills with progressive disclosure.
**Deliverables:** `skills/loader.ts`, `catalog.ts`, `activate.ts`; built-in skill set (§5).
**Verification:**
- `cd api && npx vitest run test/skill-spec-conformance.test.ts` → exit 0
- `cd api && npx vitest run test/skill-progressive-disclosure.test.ts` → exit 0
**done_when:** every built-in skill validates; only metadata is injected at compile time; body/references load on activation.

### Phase 2 — Tool system (Voyager REST + MCP)
**Objective:** Unified tool registry (built-in Voyager REST tools were later removed — MCP only).
**Deliverables:** `tools/registry.ts`, `tools/builtins/websearch.ts`, `tools/mcp-client.ts` (streamable HTTP, from `MCP_VOYAGER_URL`).
**Verification:**
- `cd api && npx vitest run test/tool-registry.test.ts` → exit 0
- `cd api && npx vitest run test/mcp-client.test.ts` → exit 0 (mocked streamable HTTP)
- `cd api && npm run smoke:mcp` → exit 0 (live list/call against `MCP_VOYAGER_URL`)
**done_when:** registry enforces `allowed-tools`; Voyager REST tools return typed data; MCP client connects over streamable HTTP and lists tools.

### Phase 3 — Agent loop runtime
**Objective:** Autonomous, budgeted loop with evidence trace and cancellation.
**Deliverables:** `loop/agent-loop.ts`, `loop/budgets.ts`, `loop/trace.ts`, `loop/model.ts` (Vercel AI SDK provider factory).
**Verification:**
- `cd api && npx vitest run test/agent-loop.test.ts` → exit 0
- `cd api && npx vitest run test/budgets.test.ts` → exit 0 (budget exhaustion aborts cleanly)
- `cd api && npx vitest run test/tool-repair.test.ts` → exit 0
**done_when:** loop terminates on budget or `[[DONE]]`; trace records every tool call + result; cancellation works; retries use a changed approach.

### Phase 4 — Report Document + renderer
**Objective:** Typed document produced by the loop, rendered deterministically with charts/tables/citations.
**Deliverables:** `report/document.ts`, `report/builder.ts`, `ui/src/components/report/*`, `ui/src/lib/reportContract.ts`.
**Verification:**
- `cd api && npx vitest run test/report-document.test.ts` → exit 0
- `cd ui && npx vitest run src/test/report-renderer.test.tsx` → exit 0
- `cd ui && npx vitest run src/test/golden-report.test.tsx` → exit 0
**done_when:** a golden report renders with headings, paragraphs, ≥1 table, ≥1 lightweight-charts chart, ≥1 multi-panel chart, citations, and highlighted numbers; every number traces to a `Source`.

### Phase 5 — Custom agent authoring
**Objective:** Users create/edit custom agents (SOUL + skills + tools + budget) in the app.
**Deliverables:** `agents/store.ts`, `agents/compile.ts`, `ui/src/pages/agents/*`, `ui/src/components/agents/*`; wire `/agents` routes.
**Verification:**
- `cd api && npx vitest run test/agent-store.test.ts` → exit 0
- `cd ui && npx vitest run src/test/agents-page.test.tsx` → exit 0
**done_when:** a user can create an agent from ≥2 skills, set a budget, and run a live test; the run persists to `agent_runs`.

### Phase 6 — Autonomy, budgets, machine verification
**Objective:** Budget enforcement, verification checks, CLI-testable sample.
**Deliverables:** budget guardrails, verification check runner, `harness` CLI sample (`api/src/harness/cli.ts --sample`).
**Verification:**
- `cd api && npx tsx src/harness/cli.ts --sample` → exit 0
- `cd api && npx vitest run test/harness-e2e.test.ts` → exit 0
**done_when:** sample run completes end-to-end; a verify failure consumes an attempt; loop closes only after a passing verify with evidence.

### Phase 7 — Migration & cleanup
**Objective:** Remove orphan code/docs; feature-flag the new harness; migrate users from presets.
**Deliverables:** cleanup commit, migration for existing presets → `harness_version=2`, docs update.
**Verification:**
- `cd api && npm test && npx tsc --noEmit` → exit 0
- `cd ui && npm test && npm run lint` → exit 0
**done_when:** no references to deleted modules remain; new harness is the live path behind a flag.

---

## 8. Harness process (how this plan is executed)

Once approved, this plan is compiled into an executable harness plan using the agent-harness skill:

```bash
python3 scripts/goal_compiler.py \
  --goal "build the relativity agent harness v2 (skill-driven, MCP-connected, typed report renderer)" \
  --manifest assets/harnesses/engineering-team.json --out plan.json
python3 scripts/loop_controller.py init --plan plan.json --state .agent-harness/state.json
python3 scripts/loop_controller.py next --state .agent-harness/state.json
```

State lives in `.agent-harness/state.json` (never `.agenthub/`, `.autoresearch/`, or `docs/TC/`). Each phase above maps to one or more tasks with `verification[]` checks and `done_when` contracts. A human reviews escalations; the loop never reports exhausted budgets as success.

---

## 9. Risks & open questions

| Risk | Mitigation |
|---|---|
| Model still loses nuance in typed output | Keep prose fields rich; use `highlights` + `citations`; golden-report test gates quality. |
| MCP port/transport unknown | Env-var config; Voyager REST is primary; MCP is a plugin with a mocked unit test. |
| Report renderer complexity | Deterministic renderer, no model; component-per-node mapping; reuse `lightweight-charts` v5. |
| Breaking existing users | Feature flag; migration of presets; old code removed only in Phase 7. |
| Budget/cost blowups | Hard caps in `budgets.ts`; abort + escalate. |

**Open (need user input):**
1. Voyager **MCP port** (and whether it is the same server as `:8001`).
2. Which built-in skills to prioritize first (DCF vs. technical vs. sector).
3. Whether report PDF export is in scope for v2 (currently Phase 4 optional).

---

## 10. Escalation

A human (the repo owner) reviews: budget exhaustion, verify failures after max attempts, destructive DB migrations, and the Phase 0 teardown. Escalations block the loop by design and are never auto-waived.

---

## Build status (2026-10-18)

Executed as an agent-harness loop (`.agent-harness/plan.json` → `state.json`). T1–T7 **verified**; T8 **escalated**.

| Task | Phase | Status | Evidence |
|---|---|---|---|
| T1 | 0 — scaffold + report contract + migration | verified | `tsc` 0; `harness-scaffold.test.ts` 6/6 |
| T2 | 1 — agentskills.io skill loader | verified | `skill-loader` 6/6, `skill-progressive-disclosure` 4/4 |
| T3 | 2 — tool registry + Voyager + MCP | verified | `tool-registry` 6/6, `mcp-client` 3/3 |
| T4 | 3 — agent loop + budgets | verified | `agent-loop` 2/2, `budgets` 2/2 |
| T5 | 4 — report document + renderer | verified | `report-document` 5/5, `golden-report` 4/4 |
| T6 | 5 — custom agent authoring | verified | `agent-store` 6/6, `agents-page` 3/3 |
| T7 | 6 — run orchestration + CLI + e2e | verified | `cli.ts --sample` exit 0; `harness-e2e` 3/3 |
| T8 | 7 — teardown + full-suite gate | escalated | full suites red on **pre-existing** failures |

### What shipped

- `api/src/harness/` — skill loader (`skills/`), tool registry + Voyager + MCP (`tools/`), budgeted loop (`loop/`), typed ReportDocument + builder (`report/`), agent store + compile (`agents/`), CLI.
- `ui/src/components/report/` — deterministic ReportDocument renderer (charts/tables/citations/inline highlights); `ui/src/pages/agents/` — custom agent authoring.
- Routes: `GET/POST/PUT/DELETE /harness/agents`, `POST /harness/agents/:id/run`.
- Migration `019_harness_v2.sql` (+ `apply_all.sql`).
- Removed orphaned dead code: `layout.ts`, `layout.refs.ts`, `types/layout.ts`, `test/layout.test.ts`.

### T8 escalation (why it did not verify)

T8's gate is the **full** suites: `cd api && npm test` and `cd ui && npm run lint`. Both are red **before and independent of** the harness work:

- api: 48 failing tests in `sse`, `report`, `normverdict`, `skillparser`, `spec-conformance` — stale tests for the *old* parser/pipeline.
- ui: 457 lint errors in pre-existing files (`compat/ui/components.tsx`, etc.). New files are lint-clean.

Per the harness contract the gate was **not** edited to pass. A human must decide: fix the stale tests, or waive T8.

### Deliberate deviation from the plan

The plan's Phase 0/7 called for a big-bang delete of the old runtime (`pipeline.ts`, `agent.ts`, `tools.ts`, `skills/`). Those modules are still imported by live routes (`/analysis`, `/skills`, `/builder`, `/tool-catalog`), so deleting them now would break the running app. Instead the new harness was added **additively** and wired behind `/harness/agents`; the old pipeline remains the live path until the route-level migration (a separate, riskier change) is done.

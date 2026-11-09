# Glossary

Domain language for the Relativity codebase. Architecture vocabulary (module,
interface, depth, seam, adapter, leverage, locality) comes from the
codebase-design skill, not from here.

## Harness (the research runtime)

- **Harness** — the independent research module at `api/src/harness/`. Plans,
  researches, composes, and assembles a typed report. Its one public interface
  is `api/src/harness/index.ts` (the barrel); nothing under `harness/` imports
  anything outside it.
- **Engine** — which of the two pipelines runs a report: `v1` (one autonomous
  tool loop) or `v2` (plan-parallel). Chosen by `harness.config.json` `engine`;
  both dispatch through `runAnalysis` (`harness/engine.ts`), which also owns
  the shared run options/result types. The `v2` in the report schema
  (`relativity/report.v2`) and in skill ids (`*-v2`) is unrelated.
- **Plan (v2)** — the task graph the planner emits, validated before anything
  executes and archived to `/workspace/plan.json`. Distinct from v1's todo
  list (see `todo_write`), which is model-authored and advisory.
- **Draft (v2)** — one section-writing model call: evidence is pasted into
  the prompt, it replies `{sections, sources, score}`. Drafts run in parallel.
- **Verdict** — the five-band run rating (Very Poor … Excellent). v1 gets it
  from an LLM grading call (`gradeReport`); v2 averages its section **scores**
  (each drafter's 1–10 self-rating) onto the same bands.
- **Canvas** — the in-memory report (`canvas/`): section-groups are appended
  in slot order (v1 via `report_write`, v2 via `appendSections`), validated by
  `validateComposed`; `canvas.document()` assembles the ReportDocument.
- **Workspace** — the per-run memfs volume (`workspace/`): `index.md`,
  `knowledge_base/`, `sources/`, `report/sections/`. Tool results are archived
  here as raw payload + stub + derived facts.
- **Evidence** — sourced facts backing a number. A note cites `[src:id]`; a
  chart needs a series-bearing stub. Coverage is assessed from evidence, never
  from the model's own TODO list.
- **Trace** — the ordered `TraceEvent` stream a run emits (thought, tool_call,
  tool_result, phase, canvas_block, kb, log). `canvas_block` = a section
  written to the report (v2 emits it; v1's writes show up as `report_write`
  tool events). The timeline UI and the report builder both consume it.
- **Budget** — per-run limits (`types.ts`): maxSteps, maxTokens, cbSessions,
  cbSessionSteps. `maxSteps` counts v1 loop steps; v2 does not enforce it.
  Compose holds a reserved slice so research cannot starve it.

### Persistence ports (the harness seam)

- **AgentRepository** — where agent definitions live (soul prompt, skills,
  tools, model, budget, output template). Harness ships an in-memory adapter;
  the server installs the Supabase adapter (`api/src/harness-adapters.ts`).
- **SkillRepository** — where custom skills live (id + markdown). Same two
  adapters. Built-in skills are read from `config/skills/` on disk and do not
  go through the repository.
- **Adapter** — a repository implementation. Row mapping (e.g. the
  `configuration` jsonb shape) belongs to the adapter, never to the harness.
- **Configuration shape version** — `HARNESS_VERSION` (jsonb key
  `harness_version`): which shape the agent configuration blob has. NOT the
  engine version.

### Adjacent, not the harness

- **Output template** — a `formats/*.md` presentation spec (structure, tone,
  min_charts, section_order). Format only — it never changes the analysis.
- **Skill** — an agentskills.io `SKILL.md`: tool mechanics the agent may use.
  Distinct from the soul prompt (judgment) and the output template (format).
- **Legacy turn harness** — `api/src/harness.ts`, the older shared model-turn
  runner (`runAgentTurn`) still used by the builder/pipeline routes. Shares
  transient-failure policy with the harness via `harness/resilience.ts`.

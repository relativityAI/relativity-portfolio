# Layout Agent + OpenUI Lang rendering (analysis pipeline replacement)

Status: REGISTERED — approved, implementing in place on `main` (no `gh`, direct mode).
Supersedes the v3 verification gate and the v4 chartPlanner layout pass (files `api/src/pipeline/*`, `api/src/evidence.ts`, `api/src/reportGate.ts`).

## Problem

`POST /analysis` writes a report the UI renders as a fixed list of generic blocks. The old v3 gate + v4 layout code (a) duplicated function in `pipeline/`, `evidence.ts`, `reportGate.ts`, (b) made the model choose figures and re-type chart values — hallucination surface — and (c) produced no interactive, chart-first UI. Whole imported `pipeline/` module set no longer exists on disk; tree cannot compile.

## Design (unchanged from the approved plan)

1. **Data manifest (deterministic, code-built):** after skill runs + synthesis, code serializes everything the UI can show into a compact manifest:
   - `identity` (symbol, shareName, source, agentName, runMode, asOf)
   - `score` (totalScore, coverage, degraded)
   - `skills` (id, name, category, weight, score, markdown — per-skill prose)
   - `price` (literal scalars + series ids into `datasets`) — read from captured `get_price_history`/`get_current_price` tool results
   - `datasets` registry (`{ id, label, type, cols, rows }`) — normalized from `raw_observations`; series for price/candles/SMA/RSI, generic tables for everything else
2. **Layout agent:** one `generateText` turn (same `buildModel`, temp ≈0.2, 1 retry on failure). Emits **OpenUI Lang** referencing `@ds:<dataset-id>` / `@lit:<literal-key>` — never inline arrays, never typed values. Uses `LAYOUT_AGENT_SYSTEM_PROMPT` + embedded spec JSON.
3. **Grounding (deterministic, non-blocking):** `groundLang` text-check — every `@ds:`/`@lit:` ref must exist in the manifest, else the ref is stripped; if >8 unresolved, discard Lang entirely. Old v3 gate (`verifyReport`) is deleted; severe KEI-contradiction wording is now handled by the retained `marketdata.ts` reading functions.
4. **Persistence:** `artifacts = { pipeline_version: "openui-v1", openui_manifest, openui_lang, verification }` (artifacts JSONB exists via migration `018_pipeline_artifacts.sql`; retry fallback when column missing is kept). No new DB columns.
5. **UI:** new renderer reads `artifacts.openui_lang + openui_manifest`, renders via `@openuidev/react-lang` `<Renderer>` + a custom component library (`ui/src/lib/openui.tsx`), all props schema-validated with zod. Falls back to the existing `ReportBlockRenderer` when Lang is absent. PDF/reasoning tabs unchanged.

## Component library (ui/src/lib/openui.tsx, single source)

`AnalysisPage` (root), `StatHero` (symbol + price + total score), `PriceChart` (lightweight-charts line + SMA overlays), `MultiLineChart`, `BarChart`, `PieChart`, `BoxPlotChart`, `HeatmapChart` (ECharts), `DataTable` (number-formatted), `SkillScoreCard`, `MarkdownBlock` (react-markdown). Dataset/literal reference resolution via a manifest context provider — `openui.tsx` is imported only by the report tab renderer.

## Files

- new `api/src/layout.ts` — `buildDataManifest`, `buildPriceProfile`, `normalizeDatasets`, `runLayoutAgent`, `groundLang`
- edit `api/src/prompts.ts` — append `LAYOUT_AGENT_SYSTEM_PROMPT`
- edit `api/src/index.ts` — drop L31–34 pipeline imports; replace L944–979 (v4 layout + v3 artifacts) with sources + score charts → manifest → layout agent → groundLang → artifacts
- delete `api/src/evidence.ts`, `api/src/reportGate.ts`, `api/test/evidence.test.ts`, `api/test/reportgate.test.ts`; rewrite `api/test/kei-eval-fixture.test.ts` (drop `gateReport`, keep marketdata assertions); new `api/test/layout.test.ts`
- new `ui/src/lib/openui.tsx`, `ui/src/lib/openui.spec.json` + `api/src/openui.spec.json` (generated via a vitest spec test), small `ui/src/test/openuiLibrary.test.tsx`
- edit `ui/src/lib/echarts.ts` (add BoxplotChart, HeatmapChart, VisualMapComponent), `ui/src/pages/AnalysisResult.tsx` (Lang renderer + remove dead `report.verification` callout), `ui/package.json` (add `@openuidev/react-lang`, `zod`)

## Verify

`npx tsc --noEmit` + `npx vitest run` in `api/` and `ui/`; `npm run lint` in `ui/`. Also confirm a plain `git grep` for `pipeline/` and `reportGate` finds nothing.

## Notes / trade-offs

- Server-side grounding is a text-level ref check (no zod parse of Lang server-side) — full structural validation lives in the UI renderer. Keeps `@openuidev/react-lang` out of the api bundle.
- Score charts (`buildSkillScoreCharts`) stay code-built and are pushed into `report.blocks` as before (PDF unchanged), and their rows are also exposed to the manifest for the Lang score display.
- Observed tool results are capped (rows/cell length) at manifest build so manifests stay prompt-sized.
# Blueprint — Skill Artifacts: downloadable, formula-bearing files

**Objective:** A skill run can emit a downloadable file (first: `.xlsx`) whose numbers are live Excel formulas, not baked values. Calculation happens at run time; rendering happens only at download time.

**Mode:** direct (edit-in-place on `main`). No branches — repo has no PR workflow convention for this and the user asked for speed.

---

## 0. Baseline (measured, do not re-litigate)

`cd api && npx vitest run` → **4 failed files / 49 failed tests**, 398 passed, BEFORE any change.
Failing: `normverdict`, `skillparser`, `spec-conformance`, + one more. Cause: commit `6e0fa82` ("simplify skill runs") deleted `normVerdict` and the section grammar but left the tests.

**Gate for this plan:** `npm run build` (tsc) green + new `test/artifacts.test.ts` green. Pre-existing failures are out of scope; fixing them is a separate cleanup step (Step 8).

---

## 1. Design

### 1.1 The core abstraction — `WorkbookRecipe`

One generic, kind-agnostic JSON shape describing a spreadsheet:

```
Recipe { sheets: Sheet[] }
Sheet  { name, cells: Cell[] }
Cell  { ref: "B7", value?: string|number|null, formula?: string,
        result?: number|string,       // cached value so the file shows a number before recalc
        provenance: "observed"|"assumption", note?: string }
```

- **Recipe is the source of truth.** Stored as jsonb in `skill_outputs[].artifacts[]`.
- **No binary in the DB.** The `.xlsx` is built on demand in the download handler and streamed.
- **No sandbox, no code execution.** `exceljs` writes cells; formulas are strings it does not evaluate.
- **`result` = cached value** so Excel/LibreOffice shows a number immediately and recalculates the moment the user edits an assumption. This is why the same math must exist once in TS — see §1.4.

### 1.2 Why this generalizes (the user's requirement)

| Future skill | What it needs | New code |
|---|---|---|
| DCF valuation | OCF + capex series → FCF, projections, TV, EV, per-share | `dcf.ts` (Step 5) |
| CAGR | any two period series → `=(B2/A2)^(1/n)-1` | one builder file |
| Growth rates | revenue/EBIT/net income series, QoQ + YoY | one builder file |
| Peer comps | cross-symbol metric maps → table | one builder file |

A builder is `(input) => Recipe`. The registry is a `Map`. Adding a skill = 1 file + 1 map line. Adding an artifact *kind* (PDF, PNG, HTML) = 1 variant + 1 renderer; the recipe/pipeline/UI don't change.

### 1.3 Grounding: the series extractor

The blocker for a generic builder is that we don't know Voyager's exact cash-flow field names (they are "XBRL-style" per `api/src/tools.ts:336`). Hardcoding them would break on the first NSE-vs-SEC mismatch.

So: **`series.ts` walks any tool-result JSON and extracts typed series.** A *series* is a numeric field name shared across an array of period-bearing rows:

```
findSeries(json) -> [{ path, name, points: [{period, value}] }]
```

Period key detected by value shape (`date`, `period`, `year`, `fy`, `quarter`, `end_date`, …). Numeric sibling keys become series. Builders then select by fuzzy name match with a candidate regex list.

This is ~50 lines, has no skill-specific knowledge, and is what makes the system modular rather than a DCF template with extra steps.

### 1.4 The no-duplicated-math rule

`dcfModel(inputs)` is a pure function returning every number. It is called **once** at run time. Its output becomes:
1. the `result:` cached value on each formula cell, and
2. the summary line in the skill report.

The Excel formulas are written independently but must agree. `test/artifacts.test.ts` asserts agreement by recomputing the model's arithmetic by hand for one fixture — cheap, catches a wrong formula.

### 1.5 Honest provenance

Every cell is `observed` (came from a tool result, `note` records which) or `assumption` (model/analyst choice, `note` records why). Assumption cells get an amber fill + a note in the rendered file. DCF's discount rate and terminal growth are **always** assumptions — the data provider does not supply a WACC — so the file is honest about it and the user edits them. That is the feature, not a gap.

---

## 2. Files

| # | File | Lines | Purpose |
|---|---|---|---|
| 1 | `api/src/skills/artifacts/types.ts` | ~45 | `WorkbookRecipe`, `Cell`, `SkillArtifact`, `ArtifactInput` |
| 2 | `api/src/skills/artifacts/series.ts` | ~60 | `findSeries`, `pickSeries`, `parseObservation` |
| 3 | `api/src/skills/artifacts/xlsx.ts` | ~55 | `renderXlsx(recipe) -> Promise<Buffer>` |
| 4 | `api/src/skills/artifacts/dcf.ts` | ~160 | `dcfModel()` + `buildDcfRecipe()` |
| 5 | `api/src/skills/artifacts/index.ts` | ~30 | `ARTIFACT_BUILDERS` map + `buildArtifacts()` |
| 6 | `api/src/index.ts` | +2 / +35 | call `buildArtifacts`; add `GET /analysis/:id/artifacts/:aid` |
| 7 | `api/package.json` | +1 | `exceljs` |
| 8 | `ui/src/pages/sections/SkillResultCard.tsx` | +45 | download card above `SourceDataPanel` |
| 9 | `api/test/artifacts.test.ts` | ~120 | extractor, model math, xlsx round-trip |

---

## 3. Step 1 — Types

**File:** `api/src/skills/artifacts/types.ts` (new)

```ts
export type CellProvenance = "observed" | "assumption";

export interface RecipeCell {
  ref: string;                    // "B7" — A1 style, sheet-local
  value?: string | number | null;  // literal content
  formula?: string;               // Excel formula, no leading "="
  result?: string | number;       // cached result for formula cells
  numFmt?: string;                // e.g. "0.0%", "#,##0"
  provenance: CellProvenance;
  note?: string;                  // observed: which tool. assumption: why chosen.
}

export interface RecipeSheet {
  name: string;                   // Excel sheet-name rules: <=31 chars, no : \ / ? * [ ]
  cells: RecipeCell[];
  colWidths?: Record<string, number>;
}

export interface WorkbookRecipe {
  kind: "xlsx";
  filename: string;
  description: string;
  sheets: RecipeSheet[];
}

export interface SkillArtifact {
  id: string;                     // "<skill_id>:<index>" — stable, used in the URL
  skill_id: string;
  kind: "xlsx";
  status: "ready" | "partial" | "unavailable";
  recipe: WorkbookRecipe | null;   // null only when status === "unavailable"
  summary: string;                // one line shown next to the button
  assumptions: { label: string; value: string; reason: string }[];
  observation_refs: number[];     // indices into skill_output.raw_observations
  note?: string;                  // required when status !== "ready"
}

export interface ArtifactInput {
  skillId: string;
  symbol: string;
  shareName: string;
  source: string;
  observations: { tool: string; args?: string; result: string; status: string }[];
}
```

Also add `artifacts?: SkillArtifact[]` to `SkillOutput` in `api/src/skills/types.ts`.

**Exit:** `npx tsc --noEmit` clean.

---

## 4. Step 2 — Series extractor

**File:** `api/src/skills/artifacts/series.ts` (new)

```ts
export interface Series {
  path: string;                    // where it was found, for provenance
  name: string;                    // the field name
  points: { period: string; value: number }[];
}

export function parseObservation(o: { result: string }): unknown | null;
export function findSeries(root: unknown): Series[];   // depth<=6 walk
export function pickSeries(all: Series[], re: RegExp): Series | null;  // first name match
```

Rules:
- Walk objects/arrays to depth 6.
- An array qualifies if ≥2 elements are objects sharing a **period key**: a key whose values are all `string|number` and match `/^(date|period|year|fy|fiscal_year|quarter|end_date|report_date|period_end)/i` or parse as a date.
- Every other key with ≥1 finite numeric value across rows becomes a `Series`.
- `pickSeries` takes a case-insensitive regex over the field name and returns the **highest point-count** match (longer history wins).

**Exit:** unit test with a Voyager-shaped fixture `{ data: { periods: [{period:"2023", operating_cash_flow: 1.2e9, capital_expenditure: -3e8}, …] } }` → 2 series found, `pickSeries(/capital.*expend/i)` returns capex.

---

## 5. Step 3 — xlsx renderer

**File:** `api/src/skills/artifacts/xlsx.ts` (new)

```ts
export async function renderXlsx(recipe: WorkbookRecipe): Promise<Buffer>;
```

- `new ExcelJS.Workbook()`; `creator = "Relativity AI Portfolio"`, fixed `created`/`modified` → **deterministic bytes** for the same recipe.
- Per sheet: sanitize name (≤31 chars, strip `:\/?*[]`), write cells by A1 ref.
  - formula cell → `cell.value = { formula, result }`
  - literal → `cell.value = value`
  - `numFmt` → `cell.numFmt`
  - `provenance === "assumption"` → `cell.fill = amber`, `cell.note = reason`
- `colWidths` when provided.
- `const out = await wb.xlsx.writeBuffer(); return Buffer.from(out)`.

**Exit:** round-trip test — render, re-read with `new ExcelJS.Workbook().xlsx.load(buf)`, assert a known formula cell has `.formula` and `.result`, and an assumption cell has `.note`.

---

## 6. Step 4 — Registry + assembler

**File:** `api/src/skills/artifacts/index.ts` (new)

```ts
import { buildDcfRecipe } from "./dcf.js";

type Builder = (input: ArtifactInput) => Omit<SkillArtifact, "id" | "skill_id" | "kind">[];

const ARTIFACT_BUILDERS: Record<string, Builder> = { "dcf-valuation": buildDcfRecipe };

export function buildArtifacts(input: ArtifactInput): SkillArtifact[] {
  const build = ARTIFACT_BUILDERS[input.skillId];
  if (!build) return [];                        // every other skill: zero behaviour change
  try {
    return build(input).map((a, i) => ({ ...a, id: `${input.skillId}:${i}`, skill_id: input.skillId, kind: "xlsx" as const }));
  } catch (e) {
    return [{ id: `${input.skillId}:0`, skill_id: input.skillId, kind: "xlsx", status: "unavailable",
              recipe: null, summary: "Workbook unavailable.",
              assumptions: [], observation_refs: [],
              note: `Artifact build failed: ${(e as Error).message}` }];
  }
}
```

**Exit:** `buildArtifacts` returns `[]` for `skill_id: "moat-analysis"`.

---

## 7. Step 5 — DCF builder

**File:** `api/src/skills/artifacts/dcf.ts` (new)

### 7a. `dcfModel` — the single source of math

```ts
export interface DcfInputs {
  fcf: number[];              // historical, oldest → newest
  discountRate: number;       // assumption
  stageGrowth: number;        // assumption
  terminalGrowth: number;     // assumption
  years: number;              // assumption
  netDebt: number;            // observed, or 0 when unavailable
  shares: number;             // observed, or 0 when unavailable
}
export interface DcfResult {
  projections: number[]; pv: number[]; pvSum: number;
  terminalValue: number; pvTerminal: number; enterpriseValue: number;
  equityValue: number; valuePerShare: number | null;
}
export function dcfModel(i: DcfInputs): DcfResult;
```

- `projections[t] = fcf[last] * (1 + stageGrowth)^(t+1)`
- `pv[t] = projections[t] / (1 + discountRate)^(t+1)`
- `terminalValue = projections[last] * (1 + terminalGrowth) / (discountRate - terminalGrowth)` — guard `discountRate <= terminalGrowth` → return `enterpriseValue: 0` and let the caller mark `partial`.
- `valuePerShare = shares > 0 ? equityValue / shares : null`

### 7b. `buildDcfRecipe` — inputs and sheets

**Inputs:** `get_cash_flows` series for OCF and capex; `get_financial_metrics` for `current_price`, `market_capitalization`, `total_debt`, `enterprise_value`.

Fuzzy selectors:
```ts
const RE_OCF   = /operating[_\s]?cash[_\s]?flow|net[_\s]?cash.*operat|cash.*from.*operat/i;
const RE_CAPEX = /capital[_\s]?expend|capex|purchase.*(property|equipment|fixed)|additions/i;
```
FCF per year is **`=OCF + Capex`** when every capex value ≤ 0 (the normal sign convention), else **`=OCF − Capex`** — decided in code, formula written accordingly.

**Assumptions (all `provenance: "assumption"`, each with a reason):**

| Ref | Value | Reason |
|---|---|---|
| Discount rate | `0.10` | "Default 10% required return. The data provider supplies no WACC — edit to your own." |
| Terminal growth | `0.025` | "2.5% ≈ long-run nominal GDP. Must stay below the discount rate." |
| Stage-1 growth | historical FCF CAGR clamped to `[-0.05, 0.25]`, else `0.05` | "Derived from the FCF history above; clamped to a plausible band. Edit freely." |
| Projection years | `5` | "Standard explicit forecast horizon." |

Observed: net debt = `total_debt − cash_and_equivalents` when both present, else `0` with note "not available"; shares = `market_capitalization / current_price` when both present, else `null`.

**Sheets:**

1. **`Inputs`** — every assumption as one editable cell in column B with the reason in column C. Also the observed net debt / shares / current price.
2. **`Historical FCF`** — table: period, OCF, Capex, FCF (formula), FCF growth (formula). OCF/Capex are observed literals; FCF and growth are formulas.
3. **`DCF`** — rows: year index, projected FCF (formula chained off the last historical FCF × `(1+growth)`), discount factor (formula), PV (formula). Then PV of explicit period (formula `=SUM`), terminal value (formula), PV of TV (formula), enterprise value, less net debt, equity value, ÷ shares, **value per share** (formula), vs current price (formula), margin of safety (formula).
4. **`Sensitivity`** — 5 × 5 grid of value-per-share. Row header = discount rate, column header = terminal growth, each body cell a full inline formula referencing `Inputs` and the projection row. Built as one string per cell; the code-computed centre cell must equal `dcfModel().valuePerShare` (asserted in the test).

Every formula cell carries `result` from `dcfModel`.

**Status:**
- no OCF series, or < 2 FCF points → `unavailable` + note naming what was missing.
- OCF but no capex → `partial`, `Inputs` note "capex not returned; FCF treated as operating cash flow".
- else `ready`.

`summary` example: `"5-year DCF on 4 years of reported free cash flow — 9 sheets cells, 62 formulas, every assumption editable."` (computed from the recipe, not hardcoded).

**Exit:** test asserts a 4-year fixture produces the hand-computable answer, and that the centre sensitivity cell equals `dcfModel().valuePerShare`.

---

## 8. Step 6 — Wire the API

**File:** `api/src/index.ts`

a) In `runSkillEvaluation`, after `observations` is built, add:

```ts
const artifacts = buildArtifacts({ skillId: skill.id, symbol, shareName, source, observations });
```

and add `artifacts` to the returned object. Nothing else in the function changes — it is one line plus one key.

b) New route, placed with the other `/analysis/:id` authenticated routes (find the existing `GET /analysis/:id` for the ownership-check idiom and copy it):

```
GET /analysis/:id/artifacts/:artifactId
```

- `requireAuth`; load the run scoped by `.eq("id", id).eq("user_id", userId)` (same as the existing route).
- `404` if run missing, artifact id not found, or `kind !== "xlsx"`.
- `409` if `status !== "ready"` with the artifact's `note`.
- Else `renderXlsx(recipe)` and send:
  - `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - `Content-Disposition: attachment; filename="<recipe.filename>"`

`artifactId` contains a colon (`dcf-valuation:0`) — it arrives percent-encoded in the path; `decodeURIComponent` it before matching, and match on the raw string too as a fallback.

**Exit:** `npx tsc --noEmit` clean; curl against a seeded run returns a zip-magic (`PK`) body.

---

## 9. Step 7 — UI download card

**File:** `ui/src/pages/sections/SkillResultCard.tsx`

- Extend the `SkillOutput` interface with `artifacts?: SkillArtifact[]` (structural type mirroring the API — the UI does not import from `api/`).
- New component `ArtifactCard({ artifact, runId })`:
  - Row of: filename (mono, `--ink-primary`), description, status dot, sheet chips from `recipe.sheets[].name`.
  - `status === "ready"` → a `<Button>` "Download .xlsx". Click → `fetch(`${API}/analysis/${runId}/artifacts/${encodeURIComponent(artifact.id)}`)` → `blob()` → object URL → programmatic `<a download>` click → `revokeObjectURL`. Show an inline error string if the fetch is not `ok` (the 409 note is worth showing).
  - `partial` / `unavailable` → no button, amber note text.
- Assumptions render as a quiet list under the description: label, value, reason — the user should see what they are about to edit.
- **Insertion point:** immediately above `<SourceDataPanel observations={observations} />` (line ~774) — i.e. below the analysis/verdicts/findings and above the source data. That is the requested position.
- Reuse existing tokens only: `var(--ink-primary)`, `var(--ink-tertiary)`, `var(--surface-recessed)`, `var(--hairline)`, `var(--accent-primary)`, Chakra `Button`/`Flex`/`Box`/`Text`/`Badge`.

**Exit:** `cd ui && npx tsc --noEmit` clean; card hidden entirely when `artifacts` is absent.

---

## 10. Step 8 — Dependency + tests

**a.** `cd api && npm install exceljs` — one runtime dep, pinned by npm to a caret minor in `package.json`.

**b.** `api/test/artifacts.test.ts` — the required runnable check:

1. `findSeries` finds OCF and capex in a Voyager-shaped fixture; `pickSeries` prefers the longer series.
2. `dcfModel` on a hand-checkable fixture returns the hand-computed value per share.
3. `buildDcfRecipe` output: every `Historical FCF` FCF cell and every `DCF` PV cell has a `formula` AND a `result`; the centre `Sensitivity` cell's `result` equals `dcfModel().valuePerShare`.
4. `renderXlsx` round-trip: re-read the buffer with exceljs; assert a formula cell exposes `.formula` and `.result`, and an assumption cell exposes `.note` + a fill.
5. `buildArtifacts` returns `[]` for an unregistered skill id.
6. Missing-capex fixture → `status === "partial"` with a note; empty fixture → `"unavailable"`.

**c.** Optional cleanup, only if cheap: delete the 4 stale test files left by `6e0fa82`. **Skip by default** — out of scope, and deleting tests is not a call to make unilaterally.

---

## 11. Dependency graph

```
Step 1 (types)
   ├─> Step 2 (series)      independent of 1
   ├─> Step 3 (xlsx)        needs 1
   └─> Step 4 (registry)    needs 1
          └─> Step 5 (dcf)  needs 2, 4
                 └─> Step 6 (api)  needs 4
                        └─> Step 7 (ui)
   Step 8a (exceljs) needed before Step 3
```

Parallel lanes: **[1] → {2, 3, 8a} → 4 → 5 → 6 → 7 → 8b**. Realistic critical path ≈ 6 sequential steps. Steps 2 and 3 are independent and can run concurrently.

---

## 12. Definition of done

1. `cd api && npm run build` → 0 errors.
2. `npx vitest run test/artifacts.test.ts` → all green.
3. `npx vitest run` → failures ≤ the 49-file baseline (no new breakage).
4. `cd ui && npx tsc --noEmit` → 0 errors.
5. A DCF run on a symbol with cash-flow data persists `skill_outputs[0].artifacts[0]` with `status: "ready"`, `recipe.sheets.length >= 3`, and ≥ 40 formula cells.
6. `GET /analysis/:id/artifacts/dcf-valuation:0` returns a `PK`-magic body with the right `Content-Disposition` filename.
7. The downloaded file opens in Excel/LibreOffice, shows values, and recalculating after changing the discount rate on `Inputs` changes `DCF!value per share`.
8. A non-DCF skill (`moat-analysis`) run produces no `artifacts` key and no UI change.
9. No binary blob is written to the database.
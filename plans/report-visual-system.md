# Analysis Result — report & reasoning visual system

Status: PROPOSED — awaiting sign-off before implementation on `main`.

Scope: the `/analysis-result/:id` report body (both render paths) and the
Reasoning tab. Out of scope: the verdict/score band and analysis-metadata
section (approved as-is), the builder, list pages.

## Problem

The report reads as "vibe coded": serif-less prose that runs the full 1120px,
charts that are always full-width regardless of how little data they hold,
plots in muddy off-brand colors, and two different prose + two different chart
palettes depending on which render path ran. Several font tokens are declared
but never wired to the code that draws text.

## Evidence (root causes)

Two render paths share `.report-container` but nothing else:
- OpenUI path — `ui/src/lib/openui.tsx` (ECharts via `ui/src/components/shared/Echart.tsx`)
- deterministic path — `ui/src/components/builder/ReportBlockRenderer.tsx` (Recharts + `MarketChart`)

1. **Prose style forks.** `.report-container .skill-md` is 15px/1.72 in Anek
   Latin with Newsreader headings (`ui/src/index.css:166-181`). But
   `ReportBlockRenderer` doesn't use `.skill-md` — it hardcodes Chakra
   `fontSize="14px" lineHeight="1.6"` paragraphs and 20px/16px headings
   (`ReportBlockRenderer.tsx:76,91`). Same report, different type by path.
2. **Long measure.** The report column is `Container maxW="1120px"`
   (`AnalysisResult.tsx:353`). Prose has no `max-width` inside `.report-container`
   (only the metadata block is capped at `74ch`, `AnalysisResult.tsx:577`), so
   lines run ~110ch — the "too much text" feel.
3. **Charts are always full-width.** `Echart` renders a `Box w="full"`
   (`Echart.tsx:76`); the Recharts path wraps in `ResponsiveContainer width="100%"`
   (`ReportBlockRenderer.tsx:242`). A 3-bar chart spans the whole column.
   Heights are fixed 240/260 (`openui.tsx:614,641,669,700,722`).
4. **Two divergent, partly-unwired palettes.**
   - ECharts: `t.chart` reads `--chart-1..5` but those tokens **do not exist in
     `index.css`**, so charts fall back to hardcoded `#23747D/#8A6B3B/#5B7FDE/#A64D4D/#3A7258`
     (`echarts.ts:120-124`).
   - Recharts: `CHART_COLORS = ["#5B7FDE","#4C8B6B","#B8935A","#8FA0C8","#B85C5C"]`
     (`rechartsColors.ts:1`), reused `i % length`.
   - Single-series `BarChart` paints every bar one accent → monochrome.
5. **Chart-internal fonts are wrong.** `resolvedTheme().fonts` hardcodes
   `'Inter'` and `'JetBrains Mono'` (`echarts.ts:129-133`), but the app declares
   `--font-body: 'Anek Latin'` and `--font-mono: 'IBM Plex Mono'`
   (`index.css:45-47`). JetBrains Mono isn't loaded → fallback to generic
   monospace in axis/tooltip text.
6. **Data sources aren't a designed surface.** `EvidenceNote` renders
   `Based on: …` as 11px tertiary inline text (`ReportBlockRenderer.tsx:65`).
   Tool responses use a bare native `<details>` (`AgentActivity.tsx:254`).
   `SkillResultCard` contract already requires raw data "one click away, must
   look branded, never a JSON dump".
7. **Reasoning tab is legible but flat.** `AgentActivity` is a 480px scroll
   panel at 11–12.5px (`AnalysisResult.tsx:787`, `AgentActivity.tsx:412`), with
   thoughts in 11.5px italic and mono tool lines. Works, but has no type
   hierarchy and thoughts aren't styled as prose.

## Design

### A. One typography system for the report

Define the report prose style once and have both paths consume it.

- Adopt a report scale in `index.css` under `.report-container`: body 15.5px /
  1.65 in Anek Latin (`--font-body`), headings Newsreader (`--font-display`) at
  a 1.25-modular step (h2 ≈ 1.5em, h3 ≈ 1.2em, h4 ≈ 1.05em), tabular figures
  for numbers via `font-variant-numeric: tabular-nums`.
- Cap prose measure: `.report-container .skill-md, .report-container p { max-width: 72ch }`.
  Charts and tables ignore the cap (they want width); text obeys it.
- Delete the inline Chakra sizes in `ReportBlockRenderer.tsx:76,91` and let the
  `heading`/`paragraph` blocks inherit the shared `.skill-md` / `.report-container`
  classes (smallest diff: add `className="skill-md"` to the paragraph Box and
  drop redundant font props — no new abstraction).
- Report title (`AnalysisPage` `props.symbol`, `openui.tsx:1008-1017`) becomes
  Newsreader at the existing 27px but weight 500, tracking `-0.015em`.

### B. One chart color system, tokenized

- Add real tokens to `index.css`: `--chart-1..8` (extend the current two
  palettes into one coherent categorical set anchored on the app's signals —
  blue/teal/green/amber/red/plum/grey-blue/slate), plus `--grid-line` and
  `--chart-track`. Fix `resolvedTheme().fonts` to read `--font-mono` /
  `--font-tabular` / `--font-body` instead of hardcoding Inter/JetBrains.
- Make `rechartsColors.ts` re-export the same token set (single source: read
  the CSS vars, keep the literal fallbacks) so both paths match.
- Semantic assignment: signed/degraded data uses `--signal-negative/positive`;
  multi-series uses the palette in fixed order; single-series categorical bars
  color **per category** (not one accent) so `BarChart` stops reading flat.

### B2. Chart sizing rule (kill full-width-default)

Add an optional `maxWidth?: number` to `Echart` (`Echart.tsx`), default
`undefined` → `w="full"`. Each chart component computes an intrinsic cap from
its data: `cap ≈ clamp(minWidth, nPoints|nCats * pxPerItem, containerWidth)`.
Charts then render at `maxWidth={cap}` centered (or start-aligned). A 3-bar
chart becomes ~360px, not 1120px. Recharts path gets the same wrap.

Add a "small-chart row" so 2–3 low-cardinality figures sit side by side instead
of stacking full-width cards (reuse the existing StatHero-row grouping idea in
`openui.tsx:996-1045`, generalised in the component tree, not the page CSS).

### C. Component catalog (OpenUI + deterministic)

`openui.tsx` / `openui.spec.json`:
- Add an optional `span`/`size` arg so the layout agent can declare intent
  (`"half" | "full"`), consumed as `maxWidth`. Constraint: these libs use
  **positional** props (first key = first positional arg), so append new
  optional props **after** existing ones and regenerate `openui.spec.json` via
  the existing spec vitest, or the model's positional mapping shifts.
- Add a `Callout` and a `KeyValueList`/`Sources` leaf so evidence and caveats
  stop being inline 11px text.
- `DataTable`: raise default `maxRows`, add "showing N of M" affordance rather
  than a silent cap.

`ReportBlockRenderer.tsx`: apply the same palette + heading/prose tokens; add
the shared Sources disclosure (below).

### D. Collapsible data-source box (shared)

One `Sources` component (native `<details>` — no new dep), styled like the
console surfaces, used by `EvidenceNote`, all charts, and `AgentActivity` tool
responses:
- Collapsed: a labelled hairline row — `Sources · N` + the first evidence line.
- Expanded: branded evidence list (lookup lines), then an optional raw dataset
  table using the existing `DataTable` styling — never a JSON dump.
- Keep `AgentActivity.tsx:254` `<details>` but restyle to match.

### E. Reasoning tab (`AgentActivity.tsx`)

Keep the SSE/timeline logic untouched. Type/layout only:
- Header 13px/600; step rows 12px; **thoughts promoted to 13px non-italic
  Anek Latin prose** (they're model prose, not telemetry) with a subtle left
  rule; tool lines stay mono 11px.
- Raise panel height cap from 480 → content-aware (e.g. 560 desktop) and add a
  "jump to latest" affordance while live.
- Group long traces under collapsible phase headings (Gathering → Scoring →
  Synthesising) using the step labels already present.

## Files

- `ui/src/index.css` — report type scale + measer cap; add `--chart-1..8`,
  `--grid-line`; (keep `.landing` scope as-is).
- `ui/src/lib/echarts.ts` — wire `fonts.*` to real tokens; drop dead fallbacks.
- `ui/src/lib/rechartsColors.ts` — derive from tokens; keep as re-export.
- `ui/src/components/shared/Echart.tsx` — `maxWidth` prop.
- `ui/src/lib/openui.tsx` + `ui/src/lib/openui.spec.json` — per-chart width
  caps, per-category bar colors, `span` arg, `Sources`/`Callout` leaves,
  regenerated spec.
- `ui/src/components/builder/ReportBlockRenderer.tsx` — consume shared prose
  tokens + palette; shared `Sources`.
- new `ui/src/components/shared/Sources.tsx` — the disclosure.
- `ui/src/components/shared/AgentActivity.tsx` — type hierarchy, height.
- `ui/src/pages/AnalysisResult.tsx` — only if the report wrapper needs a width
  change; otherwise untouched.

## Deferred (add when the trigger fires)

- `--chart-N` beyond 8 → add when a real chart exceeds 8 series.
- Small-chart responsive grid → only if the capped single-column read still
  looks sparse on 1120px; measure first.
- New dependencies: none. Native `<details>` covers the disclosure.

## Verify

- `ui/`: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`.
- Visual: render the reference run (`/analysis-result/<id>`) in both light/dark
  and both render paths (force the `ReportBlockRenderer` fallback); check a
  3-bar chart is no longer full-width, prose measure ≤72ch, bar colors vary.
- a11y: `<details>` has a discernible name; `Echart` keeps `role="img"` +
  `aria-label`.
- One `impeccable detect --json` pass on the changed UI files when done.

/**
 * System-prompt reference blocks — generated from the live schema so adding a
 * chart kind or a section primitive never needs a prompt edit. The config-dir
 * markdown embeds these via {{section_contract}} / {{plot_reference}} slots
 * (run.ts fills them per run; if the format file drops a slot, run.ts appends
 * the block itself so the contract always reaches the model).
 */

import { BLOCKS, SECTION_SHAPE } from "./catalog.js";
import { ChartSpecSchema } from "./document.js";

/**
 * Data tokens the harness can expand at assembly — mirrors tokenSeries() in
 * report/builder.ts (price, volume, sma overlays and rsi14 only; no local
 * indicator math).
 */
export const DATA_TOKENS = ["price", "volume", "sma20", "sma50", "sma200", "rsi14"];

/**
 * What each kind needs and how it ships — mirrors renderFigure() dispatch in
 * report/figure-kit.ts. ponytail: hand-kept next to the schema enum; update
 * together (a new kind needs a renderer anyway).
 */
const PLOT_NOTES: Record<string, string> = {
  line: "single time-series — ONE `series` (or one `data` token); the story line, big serif end label. Not for comparisons — use `multiline`.",
  multiline: "2–4 time-series on one axis — `series` or comma `data` tokens (e.g. \"price, sma200\"); lead = story ink, rival = ink, rest grey. Never more than 4 lines.",
  area: "time-series with weight — same data as `line`, filled under the curve; use when magnitude under the line is the point.",
  scatter: "time-series as dots — `series`; correlation/cluster reads, not trends (use `line` for trends).",
  hbar: "horizontal bars — `categories`+`values`; rankings, top/bottom lists, long category labels. Bars grow left→right from zero, value printed at the bar end.",
  vbar: "vertical columns — `categories`+`values` (discrete comparison) or `series` (over time); heights from zero. Use for period-over-period columns, not rankings.",
  pie: "parts of a whole — `categories`+`values` summing to a meaningful total; ships as a share strip with % legend (house style: no wedges). ≤6 slices.",
  donut: "parts of a whole with a center total — `categories`+`values`; ring + big-number legend beneath. Use when the whole's size matters as much as the split.",
  candle: "OHLC — `series` with o/h/l per point; renders as the interactive chart in the UI (needs a market-data tool).",
  stat: "big-number KPI card — `categories[0]` = label, `categories[1]` = optional sub-line, `values[0]` = the headline number, `series` or a `data` token = sparkline; for the one number that matters (index level, headline delta).",
  movers: "gainers/losers board — `categories` = names, `values` = signed numbers (two columns past five rows, +/− coloured); set `measure` to `%`; for biggest moves, top/bottom N.",
  table: "ledger table — `columns` (headers) + `rows` (array of arrays; strings and numbers). Hairline rows, numbers right-aligned. USE THIS instead of any markdown/`table` section block for 3+ column figures (financials, comparisons, factor scores). Numbers as JSON numbers, not strings.",
  radar: "categorical (`categories`+`values`); honestly drawn as bars — prefer `hbar` unless the radar shape is the point",
  bar: "LEGACY — prefer `hbar` (categorical) or `vbar` (columns); accepted only so old documents still render",
};

/** The report_write contract: the section envelope + every block with a copyable JSON example. */
export function sectionContractMarkdown(): string {
  const blocks = BLOCKS.map((p) => `- ${p.id} — ${p.when}\n      ${p.json}`).join("\n");
  return `${SECTION_SHAPE}\n\nBlock types allowed inside a section:\n${blocks}`;
}

/**
 * Plot menu + the exact spec shapes. `hasSeriesTool` steers honestly: with a
 * web-only toolbox no `data` token can ever resolve, so categorical charts are
 * the only ones that will actually draw.
 */
export function plotReferenceMarkdown(hasSeriesTool: boolean): string {
  const kinds = ChartSpecSchema.shape.kind.options;
  const lines = [
    "Every chart's data nests under `spec` — `kind` lives INSIDE `spec`:",
    "",
    ...kinds.map((k) => `- \`${k}\` — ${PLOT_NOTES[k] ?? "see the renderer"}`),
    "",
    "Data shapes:",
    `- categorical: \`{ "type": "chart", "measure": "USD per share", "sourceId": "s1", "spec": { "kind": "hbar", "categories": ["Base", "Bull"], "values": [218, 354] } }\``,
    `- time-series: \`{ "type": "chart", "measure": "USD", "sourceId": "s1", "spec": { "kind": "multiline", "data": "price, sma200" } }\` — the harness expands tokens into real series at assembly`,
    `- name the lines yourself: \`spec.names\` sits beside \`data\`, positional — \`{ "kind": "multiline", "data": "price, sma20, sma50", "names": ["AAPL", "20-day average", "50-day average"] }\`. Omitted → harness labels (close, SMA20…). Never leave lines named by raw tokens or dates.`,
    `- table: \`{ "type": "chart", "measure": "USD bn", "sourceId": "s1", "spec": { "kind": "table", "columns": ["Year", "Revenue", "FCF"], "rows": [[2024, 391.0, 111.5]] } }\` — numbers as JSON numbers`,
    "",
    hasSeriesTool
      ? `Data tokens available this run: ${DATA_TOKENS.join(", ")}.`
      : `NO series data tool this run — \`data\` tokens (${DATA_TOKENS.join(", ")}) will NOT resolve. Write categorical charts (categories+values) instead.`,
    "",
    "Every chart also carries `measure` (axis unit) and `sourceId`, plus a one-line caption saying how to read it.",
    `Optional \`color\` (hex, e.g. "#C66B4E") inks the plot — when the active skill's report-structure prescribes a palette, pick from it and give different plots different colors.`,
  ];
  return lines.join("\n");
}

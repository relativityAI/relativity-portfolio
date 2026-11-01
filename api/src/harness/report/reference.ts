/**
 * System-prompt reference blocks — generated from the live schema so adding a
 * chart kind or a section primitive never needs a prompt edit. The config-dir
 * markdown embeds these via {{section_contract}} / {{plot_reference}} slots
 * (run.ts fills them per run; if the format file drops a slot, run.ts appends
 * the block itself so the contract always reaches the model).
 */

import { PRIMITIVES } from "./catalog.js";
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
  line: "time-series — `series` or a `data` token list; ships as a static SVG",
  area: "time-series — `series` or a `data` token list; drawn as a plain line (no fill wash)",
  scatter: "time-series — `series`; ships as dots",
  bar: "categorical (`categories`+`values` → horizontal bars) or time-series (`series` → columns)",
  pie: "categorical (`categories`+`values`); ships as a share strip",
  radar: "categorical (`categories`+`values`); honestly drawn as bars",
  candle: "OHLC — `series` with o/h/l per point; renders as the interactive chart in the UI (needs a market-data tool)",
  stat: "big-number KPI card — `categories[0]` = label, `categories[1]` = optional sub-line, `values[0]` = the headline number, `series` or a `data` token = sparkline; for the one number that matters (index level, headline delta)",
  movers: "gainers/losers board — `categories` = names, `values` = signed numbers (two columns past five rows, +/− coloured); set `measure` to `%`; for biggest moves, top/bottom N",
};

/** The report_write contract: every primitive with a copyable JSON example. */
export function sectionContractMarkdown(): string {
  return PRIMITIVES.map((p) => `- ${p.id} — ${p.when}\n      ${p.json}`).join("\n");
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
    "Two data shapes:",
    `- categorical: \`{ "type": "chart", "measure": "USD per share", "sourceId": "s1", "spec": { "kind": "bar", "categories": ["Base", "Bull"], "values": [218, 354] } }\``,
    `- time-series: \`{ "type": "chart", "measure": "USD", "sourceId": "s1", "spec": { "kind": "line", "data": "price, sma200" } }\` — the harness expands tokens into real series at assembly`,
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

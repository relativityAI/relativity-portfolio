/**
 * Presentation catalog — the single source of truth for the report's block
 * primitives. The section-contract list is generated here, so guidance and
 * machine contract cannot drift.
 */

export interface BlockSpec {
  id: string;
  name: string;
  /** One line: when the model should reach for this block. */
  when: string;
  /** Minimal, copyable JSON example. */
  json: string;
}

/** The report_write block vocabulary — everything allowed INSIDE a section. */
export const BLOCKS: BlockSpec[] = [
  {
    id: "text",
    name: "text",
    when:
      "Prose. level 1 = the claim/lead (inline sources via highlights); level 2 = the supporting detail. RULE: every level-1 text must be IMMEDIATELY followed by a level-2 text — nothing between the pair. A level-2 text may also stand alone. Every number gets a highlight with a sourceId.",
    json: `{ "type": "text", "level": 1, "text": "…", "highlights": [{ "text": "4.2%", "kind": "positive", "sourceId": "s1" }] }`,
  },
  { id: "callout", name: "callout", when: "One judgement the reader must not miss.", json: `{ "type": "callout", "variant": "key", "title": "Thesis", "text": "…" }` },
  {
    id: "chart",
    name: "chart",
    when:
      "Any plotted or tabulated figure — everything nests under `spec` (kind inside spec). Lines: `line` (ONE series) / `multiline` (2–4 series) / `area` / `scatter`. Bars: `hbar` (horizontal, rankings) / `vbar` (columns). Parts of a whole: `pie` (share strip) / `donut` (ring + center total). Ledger rows: `table` (columns+rows). Also `candle`, `stat`, `movers`. Categorical kinds take `spec.categories`+`spec.values` (table: `spec.columns`+`spec.rows`); time-series take `spec.data` tokens or `spec.series`. Carry `measure` (axis unit) and REQUIRED `sourceId` (printed under the figure); optional `color` (hex) when the skill's structure prescribes a palette.",
    json: `{ "type": "chart", "title": "…", "measure": "USD", "sourceId": "s1", "spec": { "kind": "candle", "data": "price, sma200" } }`,
  },
  {
    id: "table",
    name: "table",
    when: "A raw grid (financials, comparisons, factor scores) that is not a plot. Numbers as JSON numbers, not strings. REQUIRED `sourceId` (printed under the table).",
    json: `{ "type": "table", "columns": ["Year", "Revenue"], "rows": [[2024, 391.0]], "sourceId": "s1" }`,
  },
  {
    id: "compare",
    name: "compare",
    when: "Before/after pairs (entry vs stop, scenario A vs B). Each side is a chart. REQUIRED `sourceId` (printed under the figure).",
    json: `{ "type": "compare", "title": "Scenario", "before": { "kind": "line", "data": "price" }, "after": { "kind": "line", "data": "price, sma200" }, "sourceId": "s1" }`,
  },
  { id: "citations", name: "citations", when: "Optional footnote anchor — lands exactly where you write it, never a sources list. The harness appends nothing.", json: `{ "type": "citations", "refs": [] }` },
];

/** The envelope every report_write section must have. */
export const SECTION_SHAPE = `Each section you write is a COMPLETE unit — one heading plus its inner blocks. Nothing outside a section:

\`\`\`json
{
  "heading": { "level": 2, "text": "Trend" },
  "blocks": [
    { "type": "text", "level": 1, "text": "…claim with inline sources…" },
    { "type": "text", "level": 2, "text": "…detail…" },
    { "type": "chart", "title": "…", "measure": "USD", "sourceId": "s1", "spec": { "kind": "multiline", "data": "price, sma200" } }
  ]
}
\`\`\`

Rules:
- Exactly ONE heading per section. Any mix and number of blocks inside — a section may hold only text, only figures, or both (e.g. heading + one chart + its source is a complete section).
- Text comes in pairs: a \`level: 1\` text (the claim) must be IMMEDIATELY followed by a \`level: 2\` text (the detail) — no figure or other block between them. A level-2 text may also appear alone.
- Every figure (\`chart\`, \`table\`, \`compare\`) MUST carry \`sourceId\` — the harness prints the source beneath it. Writes without it are rejected.
- \`badges\` and \`quote\` do not exist — never write them.`;

/**
 * Presentation catalog — the single source of truth for the report's typed
 * primitives. The section-primitive list is generated here, so
 * guidance and machine contract cannot drift.
 */

export interface PrimitiveSpec {
  id: string;
  name: string;
  /** One line: when the model should reach for this primitive. */
  when: string;
  /** Minimal, copyable JSON example. */
  json: string;
}

export const PRIMITIVES: PrimitiveSpec[] = [
  { id: "heading", name: "heading", when: "Section boundary. level 1–3.", json: `{ "type": "heading", "level": 2, "text": "Trend" }` },
  { id: "paragraph", name: "paragraph", when: "Prose. Every number gets a highlight.", json: `{ "type": "paragraph", "text": "…", "highlights": [{ "text": "4.2%", "kind": "positive", "sourceId": "s1" }] }` },
  { id: "callout", name: "callout", when: "One judgement the reader must not miss.", json: `{ "type": "callout", "variant": "key", "title": "Thesis", "text": "…" }` },
  { id: "table", name: "table", when: "Comparable figures (3+ rows or columns).", json: `{ "type": "table", "columns": ["Year", "FCF"], "rows": [["2023", 111.5]] }` },
  {
    id: "chart",
    name: "chart",
    when:
      "Plotted data — everything nests under `spec` (kind inside spec): categorical kinds take `spec.categories`+`spec.values`; time-series take `spec.data` tokens or `spec.series`. Carry `measure` (axis unit) and `sourceId`; optional `color` (hex) when the skill's structure prescribes a palette.",
    json: `{ "type": "chart", "title": "…", "measure": "USD", "sourceId": "s1", "spec": { "kind": "candle", "data": "price, sma200" } }`,
  },
  { id: "badges", name: "badges", when: "A row of status chips (BUY, Risk: High).", json: `{ "type": "badges", "items": [{ "label": "Momentum: bullish", "tone": "positive" }] }` },
  {
    id: "compare",
    name: "compare",
    when: "Before/after pairs (entry vs stop, scenario A vs B). Each side is a chart.",
    json: `{ "type": "compare", "title": "Scenario", "before": { "kind": "line", "data": "price" }, "after": { "kind": "line", "data": "price, sma200" } }`,
  },
  { id: "metrics", name: "metrics", when: "KPI grid — 2–6 headline numbers with delta and tone.", json: `{ "type": "metrics", "items": [{ "label": "RSI (14)", "value": "61", "delta": "+4.2", "tone": "positive", "sourceId": "s1" }] }` },
  { id: "code", name: "code", when: "A formula, snippet, or exact expression.", json: `{ "type": "code", "language": "text", "text": "…" }` },
  { id: "quote", name: "quote", when: "A source's own words (management, filing).", json: `{ "type": "quote", "text": "…", "attribution": "Q3 call", "sourceId": "s1" }` },
  {
    id: "citations",
    name: "citations",
    when: "Footnote anchor at the very end — the harness prints the numbered footnotes here; never a sources list.",
    json: `{ "type": "citations", "refs": [] }`,
  },
];

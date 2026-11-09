/**
 * Client mirror of the harness ReportDocument contract
 * (api/src/harness/report/document.ts). Keep in sync — the UI renders this
 * document deterministically; no model runs in the render path.
 *
 * Two shapes: v2 (current — nested full sections) and v1 (stored runs —
 * flat block list). The renderer branches on `schema`.
 */

export const REPORT_SCHEMA = "relativity/report.v2";
export const REPORT_SCHEMA_V1 = "relativity/report.v1";

export interface SeriesPoint {
  t: number;
  v: number;
  o?: number;
  h?: number;
  l?: number;
}

export interface Series {
  label: string;
  points: SeriesPoint[];
}

export interface ChartSpec {
  kind: "line" | "multiline" | "candle" | "bar" | "vbar" | "hbar" | "pie" | "donut" | "area" | "scatter" | "radar" | "stat" | "movers" | "table";
  /** Domain token(s) resolved server-side into `series` (e.g. "price" or "price, sma200"). */
  data?: string;
  series?: Series[];
  categories?: string[];
  values?: number[];
  /** kind:"table" — column headers. */
  columns?: string[];
  /** kind:"table" — one array per row. */
  rows?: (string | number)[][];
}

/** Mermaid diagram — rendered to SVG client-side, never raw HTML. */
export interface DiagramSpec {
  syntax: "mermaid";
  code: string;
}

export interface Highlight {
  text: string;
  kind: "number" | "positive" | "negative" | "citation" | "neutral";
  sourceId?: string;
}

export interface Source {
  id: string;
  label: string;
  tool: string;
  url?: string;
  value: string;
}

export interface ArtifactRef {
  id: string;
  kind: "xlsx" | "pdf" | "csv";
  label: string;
  url: string;
}

/** Inner block of a v2 section. Figures (chart/diagram/table/compare) carry a required sourceId. */
export type ReportBlock =
  | { type: "text"; level: 1 | 2; text: string; highlights?: Highlight[] }
  | { type: "callout"; variant: "info" | "warn" | "key"; title?: string; text: string; highlights?: Highlight[] }
  | { type: "chart"; title?: string; spec: ChartSpec; panels?: ChartSpec[]; caption?: string; measure?: string; sourceId: string; color?: string; svgs?: string[] }
  | { type: "diagram"; title?: string; spec: DiagramSpec; caption?: string; sourceId: string }
  | { type: "table"; title?: string; columns: string[]; rows: (string | number)[][]; caption?: string; sourceId: string }
  | { type: "compare"; title?: string; before: ChartSpec | DiagramSpec; after: ChartSpec | DiagramSpec; sourceId: string }
  | { type: "metrics"; items: { label: string; value: string; delta?: string; tone?: "neutral" | "positive" | "negative"; sourceId?: string }[] }
  | { type: "code"; language?: string; text: string }
  | { type: "citations"; refs: string[] };

/** v2 full section: exactly one heading + its inner blocks. */
export interface ReportSection {
  heading: { level: 1 | 2 | 3; text: string };
  blocks: ReportBlock[];
}

/** v1 flat section (stored runs — read path only). */
export type Section =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string; highlights?: Highlight[]; level?: 1 | 2 }
  | { type: "callout"; variant: "info" | "warn" | "key"; title?: string; text: string; highlights?: Highlight[] }
  | { type: "table"; title?: string; columns: string[]; rows: (string | number)[][]; caption?: string; sourceId?: string }
  | { type: "chart"; title?: string; spec: ChartSpec; panels?: ChartSpec[]; caption?: string; measure?: string; sourceId?: string; svgs?: string[] }
  | { type: "citations"; refs: string[] }
  | { type: "diagram"; title?: string; spec: DiagramSpec; caption?: string; sourceId?: string }
  | { type: "badges"; items: { label: string; tone?: "neutral" | "positive" | "negative" | "accent" }[] }
  | { type: "compare"; title?: string; before: ChartSpec | DiagramSpec; after: ChartSpec | DiagramSpec; sourceId?: string }
  | { type: "metrics"; items: { label: string; value: string; delta?: string; tone?: "neutral" | "positive" | "negative"; sourceId?: string }[] }
  | { type: "code"; language?: string; text: string }
  | { type: "quote"; text: string; attribution?: string; sourceId?: string };

interface ReportDocumentBase {
  title?: string;
  subtitle?: string;
  generatedAt?: string;
  symbol: string;
  sources: Source[];
  /** Footnote order (source ids) — assembly-computed. */
  footnotes?: string[];
  artifacts?: ArtifactRef[];
}

export interface ReportDocumentV2 extends ReportDocumentBase {
  schema: typeof REPORT_SCHEMA;
  sections: ReportSection[];
}

export interface ReportDocumentV1 extends ReportDocumentBase {
  schema: typeof REPORT_SCHEMA_V1;
  sections: Section[];
}

export type ReportDocument = ReportDocumentV2 | ReportDocumentV1;

/** True when the document is the current nested-section shape. */
export const isV2 = (doc: ReportDocument): doc is ReportDocumentV2 => doc.schema === REPORT_SCHEMA;

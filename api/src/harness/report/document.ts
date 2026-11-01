/**
 * ReportDocument — the single typed artifact the agent produces for output.
 *
 * Analysis produces this document; rendering is deterministic code in the UI.
 * The model never emits UI markup: separating "what was concluded" from "how
 * it is drawn" is what prevents the information loss the OpenUI attempt had.
 */

import { z } from "zod";

export const SCHEMA_VERSION = "relativity/report.v1";

const SeriesPointSchema = z.object({
  t: z.number(),
  v: z.number(),
  /** Optional OHLC for candle charts; when present, candles render natively. */
  o: z.number().optional(),
  h: z.number().optional(),
  l: z.number().optional(),
});

const SeriesSchema = z.object({
  label: z.string(),
  points: z.array(SeriesPointSchema),
});

/** A single chart. Time-series kinds use `series`; categorical use `categories`+`values`. */
export const ChartSpecSchema = z.object({
  kind: z.enum(["line", "candle", "bar", "pie", "area", "scatter", "radar", "stat", "movers"]),
  /**
   * Domain token(s) the harness resolves and expands into `series`
   * (e.g. "price" or "price, sma200"). Lets the model request a real chart
   * without transcribing bars. See report/builder.attachChartData.
   */
  data: z.string().optional(),
  series: z.array(SeriesSchema).optional(),
  categories: z.array(z.string()).optional(),
  values: z.array(z.number()).optional(),
  /**
   * Plot ink (hex) — the channel for skill report-structures that prescribe a
   * colour palette. Hex-only: this string is interpolated into SVG styles.
   * Absent → theme story ink (figure-kit's var(--c) fallback).
   */
  color: z.string().regex(/^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/).optional(),
});

/** Mermaid diagram — the harness renders it to SVG (never raw HTML). */
export const DiagramSpecSchema = z.object({
  syntax: z.literal("mermaid"),
  code: z.string().min(1),
});

export type DiagramSpec = z.infer<typeof DiagramSpecSchema>;

const HighlightSchema = z.object({
  text: z.string(),
  kind: z.enum(["number", "positive", "negative", "citation", "neutral"]),
  sourceId: z.string().optional(),
});

export const SourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  tool: z.string(),
  url: z.string().optional(),
  value: z.string(),
});

const ArtifactRefSchema = z.object({
  id: z.string(),
  kind: z.enum(["xlsx", "pdf", "csv"]),
  label: z.string(),
  url: z.string(),
});

export const SectionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), level: z.union([z.literal(1), z.literal(2), z.literal(3)]), text: z.string() }),
  z.object({ type: z.literal("paragraph"), text: z.string(), highlights: z.array(HighlightSchema).optional() }),
  z.object({ type: z.literal("callout"), variant: z.enum(["info", "warn", "key"]), title: z.string().optional(), text: z.string(), highlights: z.array(HighlightSchema).optional() }),
  z.object({
    type: z.literal("table"),
    title: z.string().optional(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.union([z.string(), z.number()]))),
    caption: z.string().optional(),
  }),
  z.object({
    type: z.literal("chart"),
    title: z.string().optional(),
    spec: ChartSpecSchema,
    panels: z.array(ChartSpecSchema).optional(),
    caption: z.string().optional(),
    /** Axis unit (×, %, USD bn…) — figure anatomy; nudge via the format-gap reminder. */
    measure: z.string().optional(),
    /** The source backing the figure — figure anatomy (rule: every figure carries a source). */
    sourceId: z.string().optional(),
    /** Plot ink (hex) — section-level so it sits beside measure/sourceId where models write it. */
    color: z.string().regex(/^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/).optional(),
    /** Assembly-rendered, self-contained SVGs, index-aligned with [spec, ...panels]. */
    svgs: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal("citations"), refs: z.array(z.string()) }),
  z.object({ type: z.literal("diagram"), title: z.string().optional(), spec: DiagramSpecSchema, caption: z.string().optional() }),
  z.object({
    type: z.literal("badges"),
    items: z.array(z.object({ label: z.string(), tone: z.enum(["neutral", "positive", "negative", "accent"]).optional() })),
  }),
  z.object({
    type: z.literal("compare"),
    title: z.string().optional(),
    before: z.union([ChartSpecSchema, DiagramSpecSchema]),
    after: z.union([ChartSpecSchema, DiagramSpecSchema]),
  }),
  z.object({
    type: z.literal("metrics"),
    items: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
        delta: z.string().optional(),
        tone: z.enum(["neutral", "positive", "negative"]).optional(),
        sourceId: z.string().optional(),
      }),
    ),
  }),
  z.object({ type: z.literal("code"), language: z.string().optional(), text: z.string() }),
  z.object({ type: z.literal("quote"), text: z.string(), attribution: z.string().optional(), sourceId: z.string().optional() }),
]);

export const ReportDocumentSchema = z.object({
  schema: z.literal(SCHEMA_VERSION),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  generatedAt: z.string(),
  symbol: z.string().min(1),
  sections: z.array(SectionSchema),
  sources: z.array(SourceSchema),
  /** Footnote order (source ids, first-citation order) — assembly computes it;
   * renderers print numbered footnotes instead of a separate sources list. */
  footnotes: z.array(z.string()).optional(),
  artifacts: z.array(ArtifactRefSchema).optional(),
});

export type SeriesPoint = z.infer<typeof SeriesPointSchema>;
export type Series = z.infer<typeof SeriesSchema>;
export type ChartSpec = z.infer<typeof ChartSpecSchema>;
export type Highlight = z.infer<typeof HighlightSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type ReportDocument = z.infer<typeof ReportDocumentSchema>;

/** Superscript marker for footnote n (¹ ² ³ …), `[n]` past nine. */
const SUP_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
/** Footnote marker. Always non-ASCII — verifyDocumentNumbers must never parse a marker as data. */
export const supGlyph = (n: number): string => String(n).split("").map((d) => SUP_DIGITS[+d] ?? d).join("");

/** Every sourceId referenced by a highlight must resolve to a Source. */
export function validateReportDocument(doc: ReportDocument): string[] {
  const errors: string[] = [];
  const sourceIds = new Set(doc.sources.map((s) => s.id));
  for (const section of doc.sections) {
    if (section.type === "paragraph") {
      for (const h of section.highlights ?? []) {
        if (h.sourceId && !sourceIds.has(h.sourceId)) {
          errors.push(`highlight references unknown source "${h.sourceId}"`);
        }
      }
    }
    if (section.type === "citations") {
      for (const ref of section.refs) {
        if (!sourceIds.has(ref)) errors.push(`citation references unknown source "${ref}"`);
      }
    }
    if (section.type === "metrics") {
      for (const m of section.items) {
        if (m.sourceId && !sourceIds.has(m.sourceId)) errors.push(`metric "${m.label}" references unknown source "${m.sourceId}"`);
      }
    }
    if (section.type === "chart" && section.sourceId && !sourceIds.has(section.sourceId)) {
      errors.push(`chart references unknown source "${section.sourceId}"`);
    }
    if (section.type === "quote" && section.sourceId && !sourceIds.has(section.sourceId)) {
      errors.push(`quote references unknown source "${section.sourceId}"`);
    }
  }
  return errors;
}

/**
 * Count the chart sections a document carries. `min_charts` enforcement in
 * report/builder.enforceTemplate uses this so the number and the rule share
 * one definition.
 */
export function countCharts(doc: ReportDocument): number {
  return doc.sections.filter((s) => s.type === "chart").length;
}

/** Headings present in a document (lowercased), for `required_sections` checks. */
export function sectionHeadings(doc: ReportDocument): string[] {
  return doc.sections.filter((s) => s.type === "heading").map((s) => s.text.toLowerCase());
}

/**
 * ReportDocument — the single typed artifact the agent produces for output.
 *
 * v2: the document is a list of FULL SECTIONS — each owns exactly one heading
 * and an ordered list of inner blocks (text / figures / tables …). Heading and
 * paragraph are no longer independent top-level blocks. Every figure carries a
 * required sourceId; the renderers print the source beneath it.
 *
 * Analysis produces this document; rendering is deterministic code in the UI.
 * The model never emits UI markup: separating "what was concluded" from "how
 * it is drawn" is what prevents the information loss the OpenUI attempt had.
 *
 * v1 (flat block list) survives only as a READ path — stored runs keep
 * rendering via SectionV1Schema / flatten-free legacy converters.
 */

import { z } from "zod";

export const SCHEMA_VERSION = "relativity/report.v2";
/** Stored (pre-section) documents — read-path only. */
export const V1_SCHEMA_VERSION = "relativity/report.v1";

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

/** A single chart. Time-series kinds use `series`; categorical use `categories`+`values`;
 *  `table` uses `columns`+`rows`. */
export const ChartSpecSchema = z.object({
  kind: z.enum([
    "line",
    "multiline",
    "candle",
    "bar",
    "vbar",
    "hbar",
    "pie",
    "donut",
    "area",
    "scatter",
    "radar",
    "stat",
    "movers",
    "table",
  ]),
  /**
   * Domain token(s) the harness resolves and expands into `series`
   * (e.g. "price" or "price, sma200"). Lets the model request a real chart
   * without transcribing bars. See report/builder.attachChartData.
   */
  data: z.string().optional(),
  /**
   * Agent-chosen display names for the `data` tokens, positional
   * ("price, sma20" + ["AAPL", "20-day average"]). Absent → harness token
   * labels (close, SMA20…).
   */
  names: z.array(z.string()).optional(),
  series: z.array(SeriesSchema).optional(),
  categories: z.array(z.string()).optional(),
  values: z.array(z.number()).optional(),
  /**
   * Plot ink (hex) — the channel for skill report-structures that prescribe a
   * colour palette. Hex-only: this string is interpolated into SVG styles.
   * Absent → theme story ink (figure-kit's var(--c) fallback).
   */
  color: z.string().regex(/^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/).optional(),
  /** kind:"table" — column headers (replaces the markdown table block). */
  columns: z.array(z.string()).optional(),
  /** kind:"table" — one array per row, cells are strings or numbers. */
  rows: z.array(z.array(z.union([z.string(), z.number()]))).optional(),
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

/** Every figure requires a backing source — rendered under the figure. */
const FigureSourceSchema = z.string().min(1, "figure requires a sourceId");

// ── v2 blocks (the contents of a section) ──────────────────────────────────

/**
 * Text block. level 1 = the section's claim / lead (carries the inline
 * sources); level 2 = the supporting detail. Contract: a level-1 text must be
 * IMMEDIATELY followed by a level-2 text (enforced in SectionSchema).
 */
export const TextBlockSchema = z.object({
  type: z.literal("text"),
  level: z.union([z.literal(1), z.literal(2)]),
  text: z.string(),
  highlights: z.array(HighlightSchema).optional(),
});

export const BlockSchema = z.discriminatedUnion("type", [
  TextBlockSchema,
  z.object({ type: z.literal("callout"), variant: z.enum(["info", "warn", "key"]), title: z.string().optional(), text: z.string(), highlights: z.array(HighlightSchema).optional() }),
  z.object({
    type: z.literal("chart"),
    title: z.string().optional(),
    spec: ChartSpecSchema,
    panels: z.array(ChartSpecSchema).optional(),
    caption: z.string().optional(),
    /** Axis unit (×, %, USD bn…) — figure anatomy. */
    measure: z.string().optional(),
    /** Required — every figure carries a source, printed beneath it. */
    sourceId: FigureSourceSchema,
    /** Plot ink (hex) — section-level so it sits beside measure/sourceId where models write it. */
    color: z.string().regex(/^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/).optional(),
    /** Assembly-rendered, self-contained SVGs, index-aligned with [spec, ...panels]. */
    svgs: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal("diagram"), title: z.string().optional(), spec: DiagramSpecSchema, caption: z.string().optional(), sourceId: FigureSourceSchema }),
  z.object({
    type: z.literal("table"),
    title: z.string().optional(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.union([z.string(), z.number()]))),
    caption: z.string().optional(),
    sourceId: FigureSourceSchema,
  }),
  z.object({
    type: z.literal("compare"),
    title: z.string().optional(),
    before: z.union([ChartSpecSchema, DiagramSpecSchema]),
    after: z.union([ChartSpecSchema, DiagramSpecSchema]),
    sourceId: FigureSourceSchema,
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
  z.object({ type: z.literal("citations"), refs: z.array(z.string()) }),
]);

/** A full section: exactly one heading + its inner blocks. */
export const SectionSchema = z
  .object({
    heading: z.object({
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      text: z.string().min(1),
    }),
    blocks: z.array(BlockSchema),
  })
  .superRefine((sec, ctx) => {
    // Contract: a level-1 text is a claim; its level-2 detail must follow
    // immediately — no figure, callout or anything else between the pair.
    for (let i = 0; i < sec.blocks.length; i++) {
      const b = sec.blocks[i];
      if (b.type !== "text" || b.level !== 1) continue;
      const next = sec.blocks[i + 1];
      if (!next || next.type !== "text" || next.level !== 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blocks", i],
          message: "level-1 text must be immediately followed by a level-2 text",
        });
      }
    }
  });

export const ReportDocumentSchema = z.object({
  schema: z.literal(SCHEMA_VERSION),
  /** Optional — only when the agent supplies one; never synthesized. */
  title: z.string().min(1).optional(),
  subtitle: z.string().optional(),
  generatedAt: z.string().optional(),
  symbol: z.string().min(1),
  sections: z.array(SectionSchema),
  sources: z.array(SourceSchema),
  /** Footnote order (source ids) — legacy docs only; never computed anymore. */
  footnotes: z.array(z.string()).optional(),
  artifacts: z.array(ArtifactRefSchema).optional(),
});

// ── v1 (flat) — stored-run read path only ──────────────────────────────────

export const SectionV1Schema = z.discriminatedUnion("type", [
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
    measure: z.string().optional(),
    sourceId: z.string().optional(),
    color: z.string().regex(/^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/).optional(),
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

export const ReportDocumentV1Schema = z.object({
  schema: z.literal(V1_SCHEMA_VERSION),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  generatedAt: z.string(),
  symbol: z.string().min(1),
  sections: z.array(SectionV1Schema),
  sources: z.array(SourceSchema),
  footnotes: z.array(z.string()).optional(),
  artifacts: z.array(ArtifactRefSchema).optional(),
});

export type SeriesPoint = z.infer<typeof SeriesPointSchema>;
export type Series = z.infer<typeof SeriesSchema>;
export type ChartSpec = z.infer<typeof ChartSpecSchema>;
export type Highlight = z.infer<typeof HighlightSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type ReportDocument = z.infer<typeof ReportDocumentSchema>;
export type SectionV1 = z.infer<typeof SectionV1Schema>;
export type ReportDocumentV1 = z.infer<typeof ReportDocumentV1Schema>;

/** Superscript marker for footnote n (¹ ² ³ …), `[n]` past nine. */
const SUP_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
/** Footnote marker. Always non-ASCII — verifyDocumentNumbers must never parse a marker as data. */
export const supGlyph = (n: number): string => String(n).split("").map((d) => SUP_DIGITS[+d] ?? d).join("");

/** Every block of every section, in document order. */
export function allBlocks(doc: Pick<ReportDocument, "sections">): Block[] {
  return doc.sections.flatMap((s) => s.blocks);
}

/** Every sourceId referenced by a highlight must resolve to a Source. */
export function validateReportDocument(doc: ReportDocument): string[] {
  const errors: string[] = [];
  const sourceIds = new Set(doc.sources.map((s) => s.id));
  for (const b of allBlocks(doc)) {
    if (b.type === "text" || b.type === "callout") {
      for (const h of b.highlights ?? []) {
        if (h.sourceId && !sourceIds.has(h.sourceId)) {
          errors.push(`highlight references unknown source "${h.sourceId}"`);
        }
      }
    }
    if (b.type === "citations") {
      for (const ref of b.refs) {
        if (!sourceIds.has(ref)) errors.push(`citation references unknown source "${ref}"`);
      }
    }
    if (b.type === "metrics") {
      for (const m of b.items) {
        if (m.sourceId && !sourceIds.has(m.sourceId)) errors.push(`metric "${m.label}" references unknown source "${m.sourceId}"`);
      }
    }
    if ((b.type === "chart" || b.type === "diagram" || b.type === "table" || b.type === "compare") && !sourceIds.has(b.sourceId)) {
      errors.push(`${b.type} references unknown source "${b.sourceId}"`);
    }
  }
  return errors;
}

/**
 * Count the chart blocks a document carries. `min_charts` enforcement in
 * report/builder.enforceSystemPrompt uses this so the number and the rule share
 * one definition.
 */
export function countCharts(doc: Pick<ReportDocument, "sections">): number {
  return allBlocks(doc).filter((b) => b.type === "chart").length;
}

/** Headings present in a document (lowercased), for `required_sections` checks. */
export function sectionHeadings(doc: Pick<ReportDocument, "sections">): string[] {
  return doc.sections.map((s) => s.heading.text.toLowerCase());
}

/**
 * OpenUI manifest contract — the SINGLE source of truth for the wire format of
 * `analysis_runs.artifacts` (producer: `api/src/layout.ts`; consumers: the API
 * layout agent and the React UI report renderer).
 *
 * Contract:
 *   - Persisted under `artifacts.openui_manifest` (this type) alongside
 *     `artifacts.openui_lang` (OpenUI Lang source text) and
 *     `artifacts.verification` (`LayoutVerification`). `artifacts.api: 1`
 *     versions the shape; additive-only changes bump nothing, breaking changes
 *     must bump it.
 *   - `identity`/`score`/`skills`/`price`/`datasets` are always present on
 *     persisted manifests (built by `buildDataManifest`); `metrics` and the
 *     per-item optional fields are additive. The UI must still render
 *     defensively (`?.`) because old rows predate new fields.
 *   - References inside the Lang use ids ONLY from this manifest:
 *     `@ds:<dataset.id>`, `@lit:<price|skill keys>`, `@mt:<metric.id>`.
 *     Layout code may never carry the analyst's score values.
 *   - Prompt view vs persisted: `manifestForPrompt()` strips prose (`markdown`,
 *     field labels); the persisted manifest keeps them. Same type, both views.
 *
 * Consumers MUST import these types (type-only) instead of redeclaring them —
 * a local redeclaration is how the two sides drifted before this file existed.
 * Keep this file pure types (no runtime imports): the UI resolves it through a
 * tsconfig path alias and esbuild erases the import, so anything runtime-valued
 * here would break the UI build.
 */

export interface ManifestDataset {
  id: string;
  label: string;
  kind: "series" | "table";
  cols: string[];
  /** Deterministic rows, keyed by col. Values are number | string | null. */
  rows: Record<string, number | string | null>[];
  /** skill_id that captured this dataset; unset for global data (price). */
  ownerSkill?: string;
  /** section id (one of that skill's sections) this figure sits beside. */
  ownerSection?: string;
  /** Prompt-view only: cols whose non-null values are all numbers. */
  numericCols?: string[];
  /** Prompt-view only: cols that are not numeric (labels/dates/text). */
  labelCols?: string[];
  /** Prompt-view only: has a numeric column and at least 2 rows to plot. */
  chartable?: boolean;
}

/** Display unit for a captured scalar metric. */
export type MetricUnit = "pct" | "x" | "cur" | "num";

export interface ManifestMetricField {
  key: string;
  /** Humanized key; the renderer uppercases it. */
  label: string;
  value: number | string;
  unit: MetricUnit;
}

/** A group of measured scalar numbers pulled from one tool result (e.g.
 *  get_financial_metrics), so prose figures can render as an embedded grid
 *  instead of being retyped. Values live only in the persisted manifest. */
export interface ManifestMetric {
  id: string;
  label: string;
  ownerSkill?: string;
  /** section id (one of that skill's sections) this grid sits beside. */
  ownerSection?: string;
  fields: ManifestMetricField[];
  /** Prompt-view only: field keys (labels/values stripped from the prompt). */
  keys?: string[];
}

/** A contiguous block of one skill's prose, split at markdown headings. */
export interface ManifestSection {
  id: string;
  heading: string;
  /** Section prose. Empty ("") in the prompt view; kept when persisted. */
  markdown: string;
}

/** One scored skill's entry in the manifest. */
export interface ManifestSkill {
  id: string;
  name: string;
  category: string;
  weight: number;
  score: number | null;
  /** Analyst prose per skill. Empty ("") in the prompt view; kept when persisted. */
  markdown?: string;
  /** Prose split at headings so figures interleave. Prompt view: headings only. */
  sections?: ManifestSection[];
}

export interface LayoutManifest {
  api: 1;
  identity: {
    symbol: string;
    shareName: string;
    source: string;
    agentName: string;
    runMode: string;
    asOf: string;
  };
  score: {
    totalScore: number | null;
    coverage: number | null;
    degraded?: string;
  };
  skills: ManifestSkill[];
  price: {
    lastPrice: number | null;
    week52Low: number | null;
    week52High: number | null;
    asOf: string | null;
    rsi14: number | null;
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    returns: Record<string, number | null>;
  } | null;
  datasets: ManifestDataset[];
  /** Scalar metric groups (no chartable table shape) tagged per skill. */
  metrics?: ManifestMetric[];
}

/**
 * Layout provenance persisted as `artifacts.verification` so the UI (and ops)
 * can tell whether the rendered report came from the model, the deterministic
 * floor, or nothing — and which references failed grounding.
 */
export interface LayoutVerification {
  pass: boolean;
  /** Unresolved `ds:`/`lit:`/`mt:` refs, capped in count by the grounding pass. */
  unresolved: string[];
  structure: { ok: boolean; error?: string };
  dataset_count: number;
  price_present: boolean;
  chart_count: number;
  hero_present: boolean;
  layout_source: "model" | "deterministic" | "none";
  note: string;
}

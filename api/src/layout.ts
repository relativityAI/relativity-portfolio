import { generateText } from "ai";
import { buildModel, type LlmKeys } from "./agent.js";
import { LAYOUT_AGENT_SYSTEM_PROMPT } from "./prompts.js";
import type { SkillOutput } from "./skills/types.js";

/**
 * Layout agent + OpenUI Lang integration.
 *
 * Two deterministic halves around one model call:
 *   buildDataManifest  — code-only: serializes captured tool observations into
 *                        stable dataset rows + literal price scalars. The model
 *                        never types values or picks series; it only references
 *                        ids from this manifest.
 *   groundLang         — text-level check that every `@ds:`/`@lit:` reference in
 *                        the emitted Lang exists in the manifest. Non-blocking:
 *                        unresolved refs strip/badge, and a heavily-unresolved
 *                        Lang is discarded entirely.
 */

export interface LayoutManifestInput {
  symbol: string;
  shareName: string;
  source: string;
  agentName: string;
  runMode: string;
  asOf: string;
  outputs: SkillOutput[];
  totalScore: number | null;
  coverage: number | null;
  degraded?: string;
}

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
  skills: {
    id: string;
    name: string;
    category: string;
    weight: number;
    score: number | null;
    /** Analyst prose per skill. Empty ("") in the prompt view; kept when persisted. */
    markdown?: string;
    /** Prose split at headings so figures interleave. Prompt view: headings only. */
    sections?: ManifestSection[];
  }[];
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

const MAX_TABLE_ROWS = 300;
const MAX_CELL_CHARS = 160;

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function cellValue(v: unknown): number | string | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v.length > MAX_CELL_CHARS ? `${v.slice(0, MAX_CELL_CHARS)}…` : v;
  const s = JSON.stringify(v);
  return s && s.length > MAX_CELL_CHARS ? `${s.slice(0, MAX_CELL_CHARS)}…` : s;
}

function parseObservationResult(result: string | undefined): unknown {
  if (!result) return undefined;
  try {
    return JSON.parse(result);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Price profile — pulled from the captured get_price_history/get_current_price
// tool results, expressed as littable scalars + named series datasets.
// ---------------------------------------------------------------------------

export interface PriceProfile {
  price: LayoutManifest["price"];
  datasets: ManifestDataset[];
}

const PRICE_TOOLS = new Set(["get_price_history", "get_current_price"]);

export function buildPriceProfile(observations: SkillOutput["raw_observations"]): PriceProfile {
  const lit: LayoutManifest["price"] = {
    lastPrice: null,
    week52Low: null,
    week52High: null,
    asOf: null,
    rsi14: null,
    sma20: null,
    sma50: null,
    sma200: null,
    returns: {},
  };
  const datasets: ManifestDataset[] = [];

  for (const obs of observations ?? []) {
    if (!PRICE_TOOLS.has(obs.tool) || obs.status === "ERR") continue;
    const data = parseObservationResult(obs.result);
    if (!data || typeof data !== "object") continue;

    if (obs.tool === "get_price_history") {
      const row = data as Record<string, unknown>;
      if (Array.isArray(row.candles_recent) && row.candles_recent.length) {
        datasets.push({
          id: "price_candles",
          label: "Price history",
          kind: "series",
          cols: ["date", "close", "volume"],
          rows: row.candles_recent.slice(-260).map((c: Record<string, unknown>) => ({
            date: String(c.date ?? ""),
            close: toNum(c.c ?? c.close),
            volume: toNum(c.v ?? c.volume),
          })),
        });
        const last = Array.isArray(row.candles_recent)
          ? (row.candles_recent[row.candles_recent.length - 1] as Record<string, unknown>)
          : null;
        lit.lastPrice = toNum(last?.c ?? last?.close) ?? toNum((row.digest as Record<string, unknown>)?.price);
      }
      for (const [key, id] of [
        ["sma20", "price_sma20"],
        ["sma50", "price_sma50"],
        ["sma200", "price_sma200"],
        ["rsi14", "price_rsi14"],
      ] as const) {
        const s = row[key];
        if (Array.isArray(s) && s.length) {
          datasets.push({
            id,
            label: key.toUpperCase(),
            kind: "series",
            cols: ["date", "value"],
            rows: s.slice(-260).map((p: Record<string, unknown>) => ({ date: String(p.date ?? ""), value: toNum(p.value ?? p.v) })),
          });
          lit[key] = toNum(s[s.length - 1]?.value ?? (s[s.length - 1] as Record<string, unknown>)?.v);
        }
      }
      if (row.fifty_two_week && typeof row.fifty_two_week === "object") {
        const f = row.fifty_two_week as Record<string, unknown>;
        lit.week52Low = toNum(f.low);
        lit.week52High = toNum(f.high);
      }
      if (row.fetched_at) lit.asOf = String(row.fetched_at).slice(0, 10);
    } else if (obs.tool === "get_current_price") {
      const row = data as Record<string, unknown>;
      lit.lastPrice = toNum(row.price) ?? lit.lastPrice;
      lit.week52High = toNum(row.week52High) ?? toNum(row.week52_high) ?? lit.week52High;
      lit.week52Low = toNum(row.week52Low) ?? toNum(row.week52_low) ?? lit.week52Low;
      lit.asOf = String(row.asOf ?? row.fetched_at ?? "").slice(0, 10) || lit.asOf;
      const returns = (row.returns ?? row.performance) as Record<string, unknown> | undefined;
      if (returns && typeof returns === "object") {
        for (const [k, v] of Object.entries(returns)) lit.returns[k] = toNum(v);
      }
    }
  }

  return { price: lit.lastPrice == null && !datasets.length ? null : lit, datasets };
}

// ---------------------------------------------------------------------------
// Generic tables — everything else captured by the analyst tools, capped.
// ---------------------------------------------------------------------------

function isArrayOfObjects(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.every((r) => r && typeof r === "object" && !Array.isArray(r));
}

/** Find tabular data inside a tool result whatever wrapper shape it arrives in:
 *  a bare array of rows, or an object whose (possibly nested) values hold named
 *  arrays of rows — e.g. {income_statements:[...]} or {data:{items:[...]}}.
 *  Returns one entry per named array; `name` is the key path so callers can
 *  label it. A source that changes schema, or a new source with its own shape,
 *  is picked up as long as the rows live in a named array somewhere in the tree.
 *  ponytail: walks objects only, depth-capped at 4 — arrays-of-arrays and arrays
 *  of primitives are ignored; raise the cap / recurse arrays if a source nests
 *  tabular data deeper than that. */
function collectTables(data: unknown, name = "", depth = 0): { name: string; rows: Record<string, unknown>[] }[] {
  if (isArrayOfObjects(data)) return data.length ? [{ name, rows: data }] : [];
  if (depth >= 4 || !data || typeof data !== "object" || Array.isArray(data)) return [];
  return Object.entries(data as Record<string, unknown>).flatMap(([k, v]) =>
    collectTables(v, name ? `${name}.${k}` : k, depth + 1)
  );
}

export function normalizeDatasets(
  observations: SkillOutput["raw_observations"],
  ownerSkill?: string,
  out: ManifestDataset[] = [],
): ManifestDataset[] {
  for (const obs of observations ?? []) {
    if (obs.status === "ERR" || PRICE_TOOLS.has(obs.tool)) continue;
    const data = parseObservationResult(obs.result);
    const toolKey = obs.tool.replace(/[^a-z0-9_]/gi, "_").slice(0, 32);
    for (const table of collectTables(data)) {
      const cols: string[] = [];
      for (const row of table.rows) for (const key of Object.keys(row)) if (!cols.includes(key)) cols.push(key);
      out.push({
        id: `obs_${toolKey}_${out.length}`,
        label: table.name ? `${obs.tool}: ${table.name}` : obs.tool,
        ownerSkill,
        kind: "table",
        cols,
        rows: table.rows.slice(0, MAX_TABLE_ROWS).map((row) => {
          const out: Record<string, number | string | null> = {};
          for (const col of cols) out[col] = cellValue(row[col]);
          return out;
        }),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scalar metrics — a tool result that is a flat/mildly-nested object of numbers
// (e.g. get_financial_metrics) has no rows to plot, so its scalars are captured
// as a grouped metric list. The prose and the MetricGrid then read one source.
// ---------------------------------------------------------------------------

const MAX_METRIC_FIELDS = 24;
const METRIC_DEPTH = 3;

/** Keys that are identifiers/metadata, never display metrics. */
const METRIC_SKIP = new Set([
  "id", "symbol", "source", "source_endpoint", "filing_type", "consolidated",
  "fiscal_period", "entity_identifier", "context_ref_type", "pulled_at",
  "broadcast_date", "period_start_date", "period_end_date", "asof", "as_of",
  "page", "limit", "offset", "total", "count", "per_page", "has_more", "next",
  "url", "link", "currency", "unit", "scale",
]);

/** Depth-capped walk of an object, keeping numeric leaves. Arrays are skipped
 *  (rows live in datasets), as are metadata keys. */
function collectScalars(data: unknown, depth = 0, out: Record<string, number> = {}): Record<string, number> {
  if (depth >= METRIC_DEPTH || !data || typeof data !== "object" || Array.isArray(data)) return out;
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (METRIC_SKIP.has(k.toLowerCase())) continue;
    if (Array.isArray(v)) continue;
    if (v && typeof v === "object") {
      collectScalars(v, depth + 1, out);
      continue;
    }
    const num = toNum(v);
    if (num != null) out[k] = num;
  }
  return out;
}

/** Heuristic display unit from a metric key. ponytail: name-based, so an
 *  unconventionally named key falls back to a plain number — tune the regexes if
 *  a new source names metrics differently. */
export function metricUnit(key: string): MetricUnit {
  const k = key.toLowerCase();
  if (/margin|growth|return_on|yield|_rate$|percent|_pct|(^|_)change|volatility/.test(k)) return "pct";
  if (/_ratio|debt_to_|price_to_|coverage|turnover|leverage|_multiple|_to_equity|_to_ebitda/.test(k)) return "x";
  if (/price|value|cap|revenue|sales|income|ebitda|profit|cash|debt|equity|assets|liabil|borrow|expense|earnings|per_share|book|capital|reserve/.test(k)) return "cur";
  return "num";
}

/** "net_margin" / "netMargin" → "net margin". The renderer uppercases it. */
export function metricLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
}

/** "get_financial_metrics" → "financial metrics". */
function metricGroupLabel(tool: string): string {
  return tool.replace(/^get_/, "").replace(/_/g, " ").trim() || tool;
}

/** Capture scalar metric groups from each observation, tagged per skill.
 *  Deduped within this call by key signature (a skill calling the same tool
 *  twice yields one grid). ponytail: identical key sets from two different
 *  tools collapse to the first — split by tool id if a run needs both. */
export function normalizeMetrics(
  observations: SkillOutput["raw_observations"],
  ownerSkill?: string,
  out: ManifestMetric[] = [],
): ManifestMetric[] {
  const seen = new Set<string>();
  for (const obs of observations ?? []) {
    if (obs.status === "ERR" || PRICE_TOOLS.has(obs.tool)) continue;
    const scalars = collectScalars(parseObservationResult(obs.result));
    const keys = Object.keys(scalars);
    if (keys.length < 3) continue; // a couple of scalars is metadata, not a group
    const sig = [...keys].sort().join(",");
    if (seen.has(sig)) continue;
    seen.add(sig);
    const toolKey = obs.tool.replace(/[^a-z0-9_]/gi, "_").slice(0, 32);
    out.push({
      id: `met_${toolKey}_${out.length}`,
      label: metricGroupLabel(obs.tool),
      ownerSkill,
      fields: keys.slice(0, MAX_METRIC_FIELDS).map((k) => ({
        key: k,
        label: metricLabel(k),
        value: scalars[k],
        unit: metricUnit(k),
      })),
    });
  }
  return out;
}

/** True when a column holds more than one distinct non-null value — i.e. it can
 *  label chart categories. A constant column (symbol, currency, source) only
 *  repeats on the axis and must not be used as the category column. */
function columnVaries(d: ManifestDataset, col: string): boolean {
  const seen = new Set<unknown>();
  for (const r of d.rows) {
    const v = r[col];
    if (v == null) continue;
    seen.add(v);
    if (seen.size > 1) return true;
  }
  return false;
}

/** Column roles: numeric value columns vs. text label columns. A column counts
 *  as numeric only when every non-null value is a number. Constant label columns
 *  (symbol, currency) are dropped when a varying one exists, so a chart axis is
 *  never a repeated constant. Shared by the prompt view and the fallback layout. */
export function columnProfile(d: ManifestDataset): { numericCols: string[]; labelCols: string[] } {
  const numericCols: string[] = [];
  const labelCols: string[] = [];
  for (const col of d.cols) {
    let seen = false;
    let allNum = true;
    for (const row of d.rows) {
      const v = row[col];
      if (v == null) continue;
      seen = true;
      if (typeof v !== "number") { allNum = false; break; }
    }
    (seen && allNum ? numericCols : labelCols).push(col);
  }
  const varying = labelCols.filter((c) => columnVaries(d, c));
  return { numericCols, labelCols: varying.length ? varying : labelCols };
}

/** Identifiers/metadata that must never be plotted as a value series. */
const VALUE_SKIP = new Set([
  "id", "symbol", "measure", "source", "source_endpoint", "filing_type",
  "consolidated", "fiscal_period", "entity_identifier", "context_ref_type",
  "pulled_at", "broadcast_date", "period_start_date", "period_end_date",
  "weighted_average_shares_basic", "weighted_average_shares_diluted",
]);
/** Headline metrics worth plotting, preferred in this order. */
const VALUE_PRIORITY = [
  "revenue", "sales", "ebitda", "operating", "profit", "income", "margin",
  "cash", "assets", "liabilities", "equity", "borrowings", "eps", "expense",
];

// ---------------------------------------------------------------------------
// Manifest construction
// ---------------------------------------------------------------------------

/** Split analyst prose at markdown headings so figures can interleave with the
 *  text they support. Prose without headings is broken into paragraph groups. */
export function splitSections(markdown: string, skillId: string): ManifestSection[] {
  const text = (markdown ?? "").trim();
  if (!text) return [];
  let chunks = text.split(/\n(?=#{1,4}\s+\S)/).map((c) => c.trim()).filter(Boolean);
  if (chunks.length < 2) chunks = chunkParagraphs(text, 3);
  return chunks.map((md, i) => ({
    id: `md_${skillId}_${i}`,
    heading: (md.match(/^#{1,4}\s+(.+)/)?.[1] ?? "").replace(/[*_`]/g, "").trim(),
    markdown: md,
  }));
}

/** Break heading-less prose into at most `n` paragraph groups. */
function chunkParagraphs(text: string, n: number): string[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paras.length <= n) return paras.length ? paras : [text];
  const per = Math.ceil(paras.length / n);
  const out: string[] = [];
  for (let i = 0; i < paras.length; i += per) out.push(paras.slice(i, i + per).join("\n\n"));
  return out;
}

/** Map a figure's own columns/keys to the prose section it supports, so a
 *  revenue table lands under the revenue heading. First match wins. */
const SECTION_MATCH: { metric: RegExp; section: RegExp }[] = [
  { metric: /revenue|sales|topline/, section: /revenue|sales|growth|topline/ },
  { metric: /eps|earnings|net income|net profit/, section: /earnings|eps|profit|net income/ },
  { metric: /margin|profitab/, section: /margin|profitab/ },
  { metric: /cash|fcf|flow/, section: /cash|flow|liquid/ },
  { metric: /debt|equity|leverage|borrow|balance/, section: /debt|equity|leverage|balance|capital|durab/ },
  { metric: /price|valuation|ratio|multiple/, section: /valuation|price|multiple|rating/ },
];

function matchedSection(keys: string[], secs: ManifestSection[]): string | undefined {
  const hay = keys.join(" ").toLowerCase();
  for (const { metric, section } of SECTION_MATCH) {
    if (!metric.test(hay)) continue;
    const hit = secs.find((s) => section.test(s.heading.toLowerCase()));
    if (hit) return hit.id;
  }
  return undefined;
}

/** Assign figures to sections: keyword pairing when the figure names a metric
 *  the section discusses, else spread evenly so they don't pile up at the end. */
function assignSections<T extends { ownerSection?: string }>(
  items: T[],
  secs: ManifestSection[],
  keysOf: (item: T) => string[],
): void {
  items.forEach((item, i) => {
    item.ownerSection = matchedSection(keysOf(item), secs) ?? secs[i % secs.length].id;
  });
}

/** Full manifest — persisted and handed to the UI renderer (prose + rows). */
export function buildDataManifest(input: LayoutManifestInput): LayoutManifest {
  const observations = input.outputs.flatMap((o) => o.raw_observations ?? []);
  const { price, datasets: priceDatasets } = buildPriceProfile(observations);
  const skills = input.outputs.map((o) => ({
    id: o.skill_id,
    name: o.skill_name,
    category: o.category,
    weight: o.weight,
    score: o.score_0_100 ?? null,
    markdown: o.analysis ?? "",
    sections: splitSections(o.analysis ?? "", o.skill_id),
  }));
  // Measured datasets only: figures must show stock data, never skill scores.
  // Tagged per-skill so the layout can place a figure beside its own prose.
  const generic: ManifestDataset[] = [];
  for (const o of input.outputs) normalizeDatasets(o.raw_observations, o.skill_id, generic);
  // Scalar metric groups (a tool result with no rows to plot) and tables share one
  // section-assignment pass: keyword pairing first, round-robin as the fallback,
  // so each figure sits beside the prose that discusses it.
  const metrics: ManifestMetric[] = [];
  for (const o of input.outputs) normalizeMetrics(o.raw_observations, o.skill_id, metrics);
  for (const s of skills) {
    const secs = s.sections;
    if (!secs.length) continue;
    assignSections(generic.filter((d) => d.ownerSkill === s.id), secs, (d) => d.cols);
    assignSections(metrics.filter((m) => m.ownerSkill === s.id), secs, (m) => m.fields.map((f) => f.key));
  }
  const datasets: ManifestDataset[] = [...priceDatasets, ...generic];
  return {
    api: 1,
    identity: {
      symbol: input.symbol,
      shareName: input.shareName,
      source: input.source,
      agentName: input.agentName,
      runMode: input.runMode,
      asOf: input.asOf,
    },
    score: {
      totalScore: input.totalScore,
      coverage: input.coverage,
      degraded: input.degraded,
    },
    skills,
    price,
    datasets,
    metrics,
  };
}

/**
 * Prompt-sized view: the model only needs dataset ids/labels/cols and skill ids
 * to compose `@ds:`/`@lit:` references — never the rows or per-skill prose (the
 * UI renders those from the full stored manifest). Rows must be dropped: a
 * single wide table (≤60 rows) plus the catalog easily overruns small models'
 * per-request token budget (e.g. Groq free tier = 8000 TPM), which silently
 * fails the whole layout.
 */
export function manifestForPrompt(manifest: LayoutManifest): LayoutManifest {
  return {
    ...manifest,
    // Scores are not layout material — the model never sees them. Prose stays out
    // too (token budget): the model places figures by section id + heading only.
    score: { ...manifest.score, totalScore: null, coverage: null },
    skills: manifest.skills.map((s) => ({
      ...s,
      score: null,
      markdown: "",
      sections: s.sections?.map((sec) => ({ ...sec, markdown: "" })),
    })),
    // Rows stay out of the prompt, but each dataset carries a column profile so
    // the model can tell a numeric value column from a text label column without
    // ever seeing a value — a chart fed a text column renders empty.
    datasets: manifest.datasets.map((d) => {
      const { numericCols, labelCols } = columnProfile(d);
      return { ...d, rows: [], numericCols, labelCols, chartable: numericCols.length > 0 && d.rows.length >= 2 };
    }),
    // Metric grids: the model sees ids + field keys to place a grid, never values.
    metrics: (manifest.metrics ?? []).map((m) => ({ ...m, fields: [], keys: m.fields.map((f) => f.key) })),
  };
}

// ---------------------------------------------------------------------------
// Model turn + grounding
// ---------------------------------------------------------------------------

export interface LayoutResult {
  lang: string | null;
  /** Non-fatal diagnostics for tracing/UI. */
  unresolved: string[];
  pass: boolean;
}

/** Every component the layout DSL may call (mirrors the ui library spec). */
export const LAYOUT_COMPONENTS = new Set([
  "AnalysisPage",
  "StatHero",
  "PriceChart",
  "MultiLineChart",
  "BarChart",
  "StackedBarChart",
  "Divider",
  "PieChart",
  "BoxPlotChart",
  "HeatmapChart",
  "DataTable",
  "MetricGrid",
  "MarkdownBlock",
]);

/**
 * Strip a code fence and any prose before the root call, and guarantee the
 * entry statement is bound to `root`. The parser only renders a statement
 * bound to `root`; a bare `AnalysisPage(...)` parses but has no entry point
 * and renders nothing, so we bind it here.
 */
export function normalizeLang(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```[a-z0-9]*\n([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const m = /root\s*=\s*AnalysisPage\s*\(/.exec(s) ?? /AnalysisPage\s*\(/.exec(s);
  if (m && m.index > 0) s = s.slice(m.index).trim();
  if (/^AnalysisPage\s*\(/.test(s)) s = `root = ${s}`;
  return s;
}

/**
 * Cheap syntactic gate — the api cannot import the React parser, so this checks
 * the shape an invalid model output always violates: balanced delimiters, exactly
 * one root AnalysisPage first, only known component names, and no score refs
 * (figures show stock data, never the analyst's scores).
 */
export function validateLangStructure(lang: string): { ok: boolean; error?: string } {
  let depthP = 0;
  let depthB = 0;
  let inStr = false;
  for (let i = 0; i < lang.length; i++) {
    const ch = lang[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "(") depthP++;
    else if (ch === ")") depthP--;
    else if (ch === "[") depthB++;
    else if (ch === "]") depthB--;
  }
  if (inStr) return { ok: false, error: "unterminated string" };
  if (depthP !== 0) return { ok: false, error: "unbalanced parentheses" };
  if (depthB !== 0) return { ok: false, error: "unbalanced brackets" };
  if (!/^\s*root\s*=\s*AnalysisPage\s*\(/.test(lang)) return { ok: false, error: "AnalysisPage must be bound to root as the first statement" };

  const bare = lang.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const names = [...bare.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]);
  const roots = names.filter((n) => n === "AnalysisPage").length;
  if (roots !== 1) return { ok: false, error: `expected exactly one AnalysisPage(...) root, found ${roots}` };
  const unknown = [...new Set(names.filter((n) => !LAYOUT_COMPONENTS.has(n)))];
  if (unknown.length) return { ok: false, error: `unknown component(s): ${unknown.join(", ")}` };

  if (/@ds:score_skills\b|@lit:score\./.test(lang)) return { ok: false, error: "scores may not appear in the layout — figures must show stock data" };

  return { ok: true };
}

export async function runLayoutAgent(args: {
  model: string;
  llmKeys: LlmKeys;
  apiKey?: string;
  manifest: LayoutManifest;
}): Promise<string | null> {
  const prompt = `Layout manifest (you reference dataset/literal ids FROM THIS; never invent ids):\n${JSON.stringify(manifestForPrompt(args.manifest))}`;
  const attempt = (repair?: string) =>
    generateText({
      model: buildModel(args.model, args.llmKeys, args.apiKey),
      system: LAYOUT_AGENT_SYSTEM_PROMPT,
      prompt: repair ? `${prompt}\n\nYour previous output was invalid: ${repair}. Return corrected OpenUI Lang only.` : prompt,
      temperature: 0.2,
      // ponytail: free-tier models cap output (command-r7b = 4096); a higher
      // value makes the whole call 400 with TOO_MANY_TOKENS. Layout Lang is
      // small, so 4096 is ample. Raise per-model only if a model needs more.
      maxOutputTokens: 4096,
      abortSignal: AbortSignal.timeout(120_000),
    });

  let lang: string | null = null;
  try {
    lang = normalizeLang((await attempt()).text) || null;
  } catch {
    // a transient provider hiccup shouldn't drop the layout — fall through to repair
  }
  if (lang && validateLangStructure(lang).ok) return lang;

  // One repair pass with the SAME model, telling it exactly what broke.
  const reason = lang ? validateLangStructure(lang).error : "empty output";
  try {
    const fixed = normalizeLang((await attempt(reason)).text);
    if (fixed) lang = fixed;
  } catch (e: unknown) {
    if (!lang) {
      const msg = e instanceof Error ? e.message : String(e);
      return Promise.reject(new Error(`layout agent failed: ${msg}`));
    }
  }
  return lang;
}

function literalKeys(manifest: LayoutManifest): Set<string> {
  const keys = new Set<string>();
  const p = manifest.price;
  if (p) {
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === "number" || typeof v === "string" || v == null) keys.add(`price.${k}`);
      else if (typeof v === "object") for (const kk of Object.keys(v)) keys.add(`price.${k}.${kk}`);
    }
  }
  for (const s of manifest.skills) {
    keys.add(`skill.${s.id}`);
    keys.add(`skill.${s.name}`);
  }
  return keys;
}

export const MAX_UNRESOLVED_REFS = 8;

export function groundLang(lang: string, manifest: LayoutManifest): { pass: boolean; unresolved: string[] } {
  const validDatasets = new Set(manifest.datasets.map((d) => d.id));
  const validMetrics = new Set((manifest.metrics ?? []).map((m) => m.id));
  const validLits = literalKeys(manifest);
  const unresolved = new Set<string>();
  for (const m of lang.matchAll(/@(ds|lit|mt):([\w.-]+)/g)) {
    const [, kind, id] = m;
    const ref = `${kind}:${id}`;
    const valid = kind === "ds" ? validDatasets.has(id) : kind === "mt" ? validMetrics.has(id) : validLits.has(id);
    if (!valid) unresolved.add(ref);
  }
  return { pass: unresolved.size <= MAX_UNRESOLVED_REFS, unresolved: [...unresolved] };
}

// ---------------------------------------------------------------------------
// Deterministic visual floor — a valid, grounded, chart-free layout renders as
// prose only. These helpers detect that and substitute a code-built layout from
// the same manifest ids, so a report with chartable data is never plotless.
// ---------------------------------------------------------------------------

/** Component names that actually render data (not the page/divider/prose). */
export const VISUAL_COMPONENTS = new Set([
  "StatHero",
  "PriceChart",
  "MultiLineChart",
  "BarChart",
  "StackedBarChart",
  "PieChart",
  "BoxPlotChart",
  "HeatmapChart",
  "DataTable",
  "MetricGrid",
]);

/** Component call names in a Lang string, ignoring names inside quoted strings. */
function componentCallNames(lang: string): string[] {
  const bare = lang.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  return [...bare.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]);
}

export function langHasVisual(lang: string): boolean {
  return componentCallNames(lang).some((n) => VISUAL_COMPONENTS.has(n));
}

/** Components that actually plot data (a DataTable is a visual but not a plot). */
export const CHART_COMPONENTS = new Set([
  "PriceChart",
  "MultiLineChart",
  "BarChart",
  "StackedBarChart",
  "PieChart",
  "BoxPlotChart",
  "HeatmapChart",
]);

export function langHasChart(lang: string): boolean {
  return componentCallNames(lang).some((n) => CHART_COMPONENTS.has(n));
}

export function countVisuals(lang: string): number {
  return componentCallNames(lang).filter((n) => VISUAL_COMPONENTS.has(n)).length;
}

/**
 * Build a minimal valid layout straight from manifest ids. Every reference is
 * drawn from the manifest, so it always passes validateLangStructure + groundLang.
 * Returns null when there is no chartable material at all (no price, no tables) —
 * the code cannot fabricate data.
 */
/** The value series for a chart: a varying, non-metadata numeric column,
 *  preferring headline metrics (revenue, profit, …) over raw line items. */
function valueColumn(d: ManifestDataset, numericCols: string[]): string | undefined {
  const usable = numericCols.filter((c) => !VALUE_SKIP.has(c) && !/_url$|_hash$|_id$/.test(c) && columnVaries(d, c));
  const pool = usable.length ? usable : numericCols.filter((c) => !VALUE_SKIP.has(c));
  for (const kw of VALUE_PRIORITY) {
    const hit = pool.find((c) => c.toLowerCase().includes(kw));
    if (hit) return hit;
  }
  return pool[0];
}

/** The axis for a chart: a varying date/period label, else any varying label. */
function labelColumn(d: ManifestDataset): string | undefined {
  const { labelCols } = columnProfile(d);
  return (
    labelCols.find((c) => /date|period|year|quarter|month/.test(c) && columnVaries(d, c)) ??
    labelCols.find((c) => columnVaries(d, c)) ??
    labelCols[0]
  );
}

/** A chart when the table has a plottable value column, else a DataTable with a
 *  small column selection (labels + first values) — never the full 40-column row. */
function chartCallFor(d: ManifestDataset): string {
  const { numericCols } = columnProfile(d);
  const label = labelColumn(d);
  const value = valueColumn(d, numericCols);
  const title = d.label.replace(/"/g, "'");
  if (label && value && d.rows.length >= 2) return `BarChart("@ds:${d.id}", "${label}", "${value}", "${title}")`;
  const cols = [label, ...numericCols].filter(Boolean).slice(0, 5).join(",");
  return cols ? `DataTable("@ds:${d.id}", 12, "${cols}")` : `DataTable("@ds:${d.id}", 12)`;
}

export function buildFallbackLayout(manifest: LayoutManifest): string | null {
  const children: string[] = [];
  let visual = false;
  if (manifest.price) {
    children.push(`StatHero("Last price", "@lit:price.lastPrice")`);
    visual = true;
  }
  const ids = new Set(manifest.datasets.map((d) => d.id));
  if (ids.has("price_candles")) {
    children.push(`PriceChart("@ds:price_candles")`);
    visual = true;
  }
  const tables = manifest.datasets.filter((d) => d.kind === "table" && d.rows.length >= 2);
  // Header first, then each skill's prose split into sections, each followed by
  // the figures and metric grids owned by that section.
  for (const s of manifest.skills) {
    const owned = tables.filter((d) => d.ownerSkill === s.id);
    const groups = (manifest.metrics ?? []).filter((g) => g.ownerSkill === s.id);
    const secs = s.sections ?? [];
    if (!secs.length) {
      children.push(`MarkdownBlock("${s.id}")`);
      for (const d of owned) {
        children.push(chartCallFor(d));
        visual = true;
      }
      for (const g of groups) {
        children.push(`MetricGrid("@mt:${g.id}")`);
        visual = true;
      }
      continue;
    }
    for (const sec of secs) {
      children.push(`MarkdownBlock("@md:${sec.id}")`);
      for (const d of owned.filter((x) => x.ownerSection === sec.id)) {
        children.push(chartCallFor(d));
        visual = true;
      }
      for (const g of groups.filter((x) => x.ownerSection === sec.id)) {
        children.push(`MetricGrid("@mt:${g.id}")`);
        visual = true;
      }
    }
  }
  // Global figures (no skill owner — e.g. price-derived tables) last.
  for (const d of tables.filter((t) => !t.ownerSkill).slice(0, 2)) {
    children.push(chartCallFor(d));
    visual = true;
  }
  if (!visual) return null;
  const symbol = manifest.identity.symbol.replace(/"/g, "'");
  return `root = AnalysisPage("${symbol}", [${children.join(", ")}])`;
}

/** True when a Lang layout renders a chartable dataset as a DataTable — the case
 *  where the model chose a table over a plot it could have drawn. */
export function tablesForChartableData(lang: string, manifest: LayoutManifest): boolean {
  const byId = new Map(
    manifest.datasets.filter((d) => d.rows.length >= 2).map((d) => [d.id, d]),
  );
  for (const m of lang.matchAll(/DataTable\s*\(\s*"@ds:([\w.-]+)"/g)) {
    const d = byId.get(m[1]);
    if (d && chartCallFor(d).startsWith("BarChart")) return true;
  }
  return false;
}

/** Keep the model's layout only when it interleaves prose and figures; else use
 *  the code-built sectioned floor. */
export function applyVisualFloor(
  lang: string | null,
  manifest: LayoutManifest,
): { lang: string | null; source: "model" | "deterministic" | "none" } {
  // Plots are the default. The model layout is kept only when it (a) emits
  // section refs (MarkdownBlock("@md:...")) so figures sit between prose blocks,
  // (b) draws at least one chart, and (c) never shows a table where a chart was
  // possible. Otherwise the sectioned code layout — which charts every chartable
  // dataset — is authoritative.
  if (
    lang &&
    langHasChart(lang) &&
    /MarkdownBlock\s*\(\s*"@md:/.test(lang) &&
    !tablesForChartableData(lang, manifest)
  ) {
    return { lang, source: "model" };
  }
  const fallback = buildFallbackLayout(manifest);
  if (fallback) return { lang: fallback, source: "deterministic" };
  return lang ? { lang, source: "model" } : { lang: null, source: "none" };
}
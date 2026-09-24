import { VoyagerClient, VoyagerError, pullRecordCount, type PullStatus } from "./voyager.js";
import { findMetricId, minSpreadFor } from "./metrics.js";
import { toPercent } from "./units.js";
import { aggregateWeightedScores, type UnscoredReason } from "./scoring.js";
import { runAgentTurn } from "./harness.js";
import type { LlmKeys } from "./agent.js";
import { keyPool } from "./keypool.js";
import { config } from "./config.js";
import { log } from "./logger.js";

export interface Criterion {
  category?: string;
  metric?: string;
  metric_name?: string;
  metric_type?: string;
  operator?: string;
  value?: any;
  value_upper?: any;
  weightage?: number;
}

export interface QuantEntry {
  value: any;
  /** 0..100, or null when the criterion could not be scored (unknown ≠ 0). */
  score: number | null;
  weightage: number;
  unscored_reason?: UnscoredReason;
  category?: string;
  metric_name: string;
  operator: string;
  threshold: any;
  value_upper?: any;
  metric_type: string;
  section: string;
  /** Set when a price-derived criterion is unscored because the live price feed is down. */
  price_unavailable?: boolean;
  /** Set when the numerical score was produced by the LLM judge instead of the deterministic evaluator. */
  scored_by?: "llm" | "deterministic";
}

export interface QuantResult {
  quantitative_analysis: Record<string, QuantEntry>;
  /** Point estimate over scored criteria only; null when nothing could be scored. */
  quantitative_score: number | null;
  fit_low: number;
  fit_high: number;
  coverage: number;
  price_data?: "live" | "unavailable" | "unknown";
}

const EPS = 1e-9;
const MAX_SEARCH_DEPTH = 4;

function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Map agent metric ids (catalog-style, e.g. roe, revenue_growth_yoy) to the
// keys returned by Voyager's snapshot endpoints.
const METRIC_ALIASES: Record<string, string> = {
  revenuegrowthyoy: "revenuegrowth",
  netprofitgrowthyoy: "earningsgrowth",
  epsgrowthyoy: "earningspersharegrowth",
  ebitdagrowthyoy: "ebitdagrowth",
  operatingincomegrowthyoy: "operatingincomegrowth",
  freecashflowgrowthyoy: "freecashflowgrowth",
  roe: "returnonequity",
  roa: "returnonassets",
  roce: "returnoninvestedcapital",
  roic: "returnoninvestedcapital",
  netprofitmargin: "netmargin",
  grossmargin: "grossmargin",
  ocfnettoincome: "operatingcashflowratio",
  ocftonetincome: "operatingcashflowratio",
  eps: "earningspershare",
  bookvalue: "bookvaluepershare",
  bookvaluepershare: "bookvaluepershare",
  freecashflowpershare: "freecashflowpershare",
  marketcap: "marketcapitalization",
  ev: "enterprisevalue",
  evtoebitda: "enterprisevaluetoebitdaratio",
  evtorevenue: "enterprisevaluetorevenueratio",
  pe: "pricetoearningsratio",
  pb: "pricetobookratio",
  ps: "pricetosalesratio",
  dividendyield: "dividendyield",
};

function toNumber(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Recursive search for a normalized key, descending into nested dicts/arrays.
function _findKey(obj: any, target: string, depth = 0): any {
  if (obj == null || typeof obj !== "object" || depth > MAX_SEARCH_DEPTH) return undefined;
  if (Array.isArray(obj)) {
    for (const v of obj) {
      if (v && typeof v === "object") {
        const hit = _findKey(v, target, depth + 1);
        if (hit !== undefined) return hit;
      }
    }
    return undefined;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (normKey(k) === target) return v;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const hit = _findKey(v, target, depth + 1);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

// Permissive recursive metric lookup: exact or case-insensitive key match,
// optionally scoped by the criterion's category sub-object, falling back to
// nested anywhere. Missing value → undefined (scored as unscored, never 0).
function _findMetric(metrics: Record<string, any>, name: string, category?: string): any {
  if (!metrics || typeof metrics !== "object" || !name) return undefined;

  if (name in metrics) return metrics[name];
  const target = normKey(name);

  if (category) {
    const scope = _findKey(metrics, normKey(category));
    if (scope && typeof scope === "object" && !Array.isArray(scope)) {
      const hit = _findKey(scope, target);
      if (hit !== undefined) return hit;
    }
  }

  const hit = _findKey(metrics, target);
  if (hit !== undefined) return hit;

  const alias = METRIC_ALIASES[target];
  if (alias) {
    const aliased = _findKey(metrics, normKey(alias));
    if (aliased !== undefined) return aliased;
  }
  return undefined;
}

// Price-derived categories from the metric catalog (metrics.ts). When Voyager
// reports price_data="unavailable" these fields are omitted, so criteria in
// these categories are surfaced as N/A rather than scored as a hard failure.
const PRICE_DERIVED_CATEGORIES = new Set(["market", "valuation"]);

function isPriceDerived(category?: string): boolean {
  if (!category) return false;
  return PRICE_DERIVED_CATEGORIES.has(category.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

// Statuses that mean the DATA PROVIDER is broken/unreachable — an outage that
// must fail the run (FAILED_DATA), never silently score 0 (plan 0.2 / A3).
const OUTAGE_STATUSES = new Set([401, 403, 408, 429, 500, 502, 503, 504]);

/**
 * Is this error an infrastructure outage (provider down / auth / rate limit /
 * circuit open) rather than a legitimate "no data for this symbol"?
 */
export function isMetricsOutage(e: any): boolean {
  if (!e) return false;
  if (e?.name === "BrokenCircuitError" || /circuit breaker/i.test(String(e?.message || ""))) return true;
  if (e instanceof VoyagerError) return OUTAGE_STATUSES.has(e.status);
  if (e?.name === "VoyagerError") return OUTAGE_STATUSES.has(Number(e?.status));
  // Network-level failures (fetch failed, timeouts) are outages too.
  const name = String(e?.name || "");
  if (name === "TypeError" || name === "TimeoutError" || name === "AbortError") return true;
  return /fetch failed|network|ECONN|ENOTFOUND|ETIMEDOUT|aborted|timeout/i.test(String(e?.message || ""));
}

export interface MetricsSnapshot {
  metrics: Record<string, any>;
  price_data: "live" | "unavailable" | "unknown";
  /** True when the provider itself was unreachable — NOT the same as no data. */
  outage: boolean;
  outage_error?: string;
}

// Fetch the /financial-metrics snapshot. This is the single metrics source —
// the legacy /equity/data/* snapshot endpoints do not exist in the deployed
// Voyager API. A 400/404 (or empty payload) means "no data"; anything that
// looks like an outage is surfaced via `outage` so the caller can fail the run
// honestly instead of scoring zeros (A3).
export async function fetchMetricsSnapshot(
  voyager: VoyagerClient,
  symbol: string,
  _country: string,
  source: string,
): Promise<MetricsSnapshot> {
  let metrics: Record<string, any> = {};
  let price_data: "live" | "unavailable" | "unknown" = "unknown";
  try {
    const data = await voyager.get("/financial-metrics", {
      symbol,
      source,
      consolidated: true,
      filing_type: "ttm",
    });
    if (data && typeof data === "object" && Object.keys(data).length > 0) {
      metrics = data;
      price_data =
        data.price_data === "live"
          ? "live"
          : data.price_data === "unavailable"
            ? "unavailable"
            : "unknown";
    }
    return { metrics, price_data, outage: false };
  } catch (e: any) {
    // 400/404 are legitimate "no data for this symbol" — not an outage.
    if (e instanceof VoyagerError && (e.status === 400 || e.status === 404)) {
      return { metrics, price_data, outage: false };
    }
    const message = String(e?.message || e);
    log.warn("[quant]", `metrics snapshot outage for ${symbol}: ${message}`);
    return { metrics, price_data, outage: true, outage_error: message };
  }
}

export type DataAdequacy = "adequate" | "sparse" | "inadequate";

// Classify how much internal (Voyager) data exists for a symbol, so the run
// can decide whether to auto-enable web search. Heuristic thresholds.
// ponytail: fixed cutoffs, tune once real record counts are known.
export function assessDataAdequacy(
  pullStatus: PullStatus | null,
  metrics: Record<string, any>,
): DataAdequacy {
  const records = pullRecordCount(pullStatus);
  const metricKeys = Object.keys(metrics || {}).filter((k) => k !== "price_data").length;
  if (records === 0 && metricKeys === 0) return "inadequate";
  if (records < 50 || metricKeys < 10) return "sparse";
  return "adequate";
}

// Triangular soft-boundary decay. Spread = max(|threshold|, 1) * 0.5:
// score is 0 at threshold -/+ spread, ramps linearly 0 -> 1 -> 0 with the
// peak (1.0) exactly at the threshold.
function _linearDecay(val: number, threshold: number, spread: number): number {
  if (val <= threshold - spread) return 0;
  if (val >= threshold + spread) return 0;
  if (val < threshold) return (val - (threshold - spread)) / spread;
  if (val > threshold) return (threshold + spread - val) / spread;
  return 1;
}

function _evaluateNumeric(
  operator: string,
  value: number,
  threshold: number,
  upper: number | undefined,
  spread: number,
): number {
  switch (operator) {
    case "gt":
      return value > threshold ? 1 : _linearDecay(value, threshold, spread);
    case "gte":
      return value >= threshold ? 1 : _linearDecay(value, threshold, spread);
    case "lt":
      return value < threshold ? 1 : _linearDecay(value, threshold, spread);
    case "lte":
      return value <= threshold ? 1 : _linearDecay(value, threshold, spread);
    case "eq":
      return Math.abs(value - threshold) <= Math.max(Math.abs(threshold) * 1e-6, EPS) ? 1 : 0;
    case "between": {
      if (upper === undefined || upper === null) return 0;
      if (value >= threshold && value <= upper) return 1;
      if (value < threshold) return _linearDecay(value, threshold, spread);
      return _linearDecay(value, upper, spread);
    }
    default:
      return 0;
  }
}

function _parseDate(v: any): number | null {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.getTime();
  const s = String(v).trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// Dates are binary: before/after/between evaluate to 1 or 0, no decay.
function _evaluateDate(operator: string, value: any, threshold: any, upper: any): number {
  const v = _parseDate(value);
  const t = _parseDate(threshold);
  if (v === null || t === null) return 0;
  switch (operator) {
    case "before":
      return v < t ? 1 : 0;
    case "after":
      return v > t ? 1 : 0;
    case "eq":
      return v === t ? 1 : 0;
    case "between": {
      const u = _parseDate(upper);
      if (u === null) return 0;
      return v >= t && v <= u ? 1 : 0;
    }
    default:
      return 0;
  }
}

// Text matches are binary and case-insensitive.
function _evaluateText(operator: string, value: any, threshold: any): number {
  const v = String(value ?? "").trim().toLowerCase();
  const t = String(threshold ?? "").trim().toLowerCase();
  switch (operator) {
    case "eq":
      return v === t ? 1 : 0;
    case "neq":
      return v !== t ? 1 : 0;
    default:
      return 0;
  }
}

/**
 * Evaluate one criterion against the metrics snapshot.
 * Scale contract (plan 0.1/0.3): the returned score is 0..100 or null.
 * Null means UNSCORED with a reason — missing data and price-unavailable
 * criteria never silently count as 0 (A5: unknown ≠ 0).
 */
export function evaluateMetric(
  metrics: Record<string, any>,
  criterion: Criterion,
  section: string,
  price_data?: "live" | "unavailable" | "unknown",
): QuantEntry {
  // Some stored rules carry only metric_name ("PEG Ratio"); resolve to a catalog
  // id so the snapshot lookup finds the value. Valid ids pass through unchanged.
  const resolvedId = findMetricId(criterion.metric || "") || findMetricId(criterion.metric_name || "");
  const key = resolvedId || criterion.metric || criterion.metric_name || "";
  const metric_name = criterion.metric_name || key;
  const metric_type = criterion.metric_type || "number";
  const weightage = typeof criterion.weightage === "number" && Number.isFinite(criterion.weightage) ? criterion.weightage : 5;
  const operator = criterion.operator || "gt";
  const threshold = criterion.value;
  const value = _findMetric(metrics, key, criterion.category);

  const priceUnavailable =
    price_data === "unavailable" &&
    value === undefined &&
    isPriceDerived(criterion.category);

  const base: QuantEntry = {
    value: value ?? null,
    score: null,
    weightage,
    unscored_reason: undefined,
    category: criterion.category,
    metric_name,
    operator,
    threshold: threshold ?? null,
    metric_type,
    section,
    price_unavailable: priceUnavailable || undefined,
  };

  // Unknown ≠ 0: missing data is unscored with an explicit reason.
  if (value === undefined || value === null || value === "") {
    base.unscored_reason = priceUnavailable ? "price_unavailable" : "missing_data";
    return base;
  }

  try {
    let s01: number;
    if (metric_type === "date") {
      s01 = _evaluateDate(operator, value, threshold, criterion.value_upper);
    } else if (metric_type === "text") {
      s01 = _evaluateText(operator, value, threshold);
    } else {
      // Numeric types: number, currency, percentage, multiple, ratio. pct
      // metrics are canonicalized to percent units (0.15 and 15 both → 15).
      const numValue = metric_type === "percentage" ? toPercent(value) : toNumber(value);
      if (numValue === null) {
        base.unscored_reason = "error";
        return base;
      }
      const numThreshold =
        metric_type === "percentage" ? toPercent(toNumber(threshold)) : toNumber(threshold);
      if (numThreshold === null) {
        base.unscored_reason = "error";
        return base;
      }
      const numUpper = operator === "between" ? toNumber(criterion.value_upper) : undefined;
      // Spread: v1 = |threshold|×0.5 alone; v2 (D3, off until sign-off) also
      // honours the metric's minimum spread so tiny ratios don't decay to a
      // knife edge (e.g. PE = 16 → max(8, 0.1) = 8, unchanged).
      const spread = config.quantSpreadV2
        ? Math.max(Math.abs(numThreshold) * 0.5, minSpreadFor(key, metric_type))
        : Math.max(Math.abs(numThreshold), 1.0) * 0.5;
      s01 = _evaluateNumeric(operator, numValue, numThreshold, numUpper ?? undefined, spread);
      s01 = Math.max(0, Math.min(1, s01));
    }
    // The single 0..1 → 0..100 conversion point for the quant pillar (A1).
    base.score = Math.round(s01 * 10000) / 100;
  } catch {
    base.score = null;
    base.unscored_reason = "error";
  }
  return base;
}

export function runQuantitative(
  agent: any,
  metrics: Record<string, any>,
  price_data: "live" | "unavailable" | "unknown",
): QuantResult {
  const sections = [
    { section: "asset_evaluation", criteria: (agent?.asset_evaluation?.quantitative || []) as any[] },
    { section: "macro_evaluation", criteria: (agent?.macro_evaluation?.quantitative || []) as any[] },
  ];

  const entries: Record<string, QuantEntry> = {};
  const itemsForScoring: { score: number | null; weightage: number; unscored_reason?: UnscoredReason }[] = [];

  for (const { section, criteria } of sections) {
    criteria.forEach((c, idx) => {
      const entry = evaluateMetric(metrics, c, section, price_data);
      const metric = c.metric || c.metric_name || `criterion_${idx}`;
      // Key by rule position + metric so two rules on one metric can never
      // overwrite each other in the display or the score (A9).
      const entryKey = `${section}:${idx}:${metric}`;
      entries[entryKey] = entry;
      itemsForScoring.push({
        score: entry.score,
        weightage: entry.weightage,
        unscored_reason: entry.unscored_reason,
      });
    });
  }

  const agg = aggregateWeightedScores(itemsForScoring);

  return {
    quantitative_analysis: entries,
    quantitative_score: agg.score,
    fit_low: agg.fit_low,
    fit_high: agg.fit_high,
    coverage: agg.coverage,
    price_data,
  };
}

/**
 * Build a QuantResult in which every configured criterion is UNSCORED with the
 * given reason, using the SAME rule-id keys as runQuantitative so the UI renders
 * an identical table shape. Used when the metrics provider is out (revised
 * plan 0.2/A3): the run no longer dies — the quant pillar is marked unscored
 * so the total becomes a qual-only estimate with a widened band, the research
 * that CAN run still runs, and the outage is surfaced instead of discarded.
 */
export function unscoredQuantResult(
  agent: any,
  price_data: "live" | "unavailable" | "unknown",
  reason: UnscoredReason,
): QuantResult {
  const sections: { section: string; criteria: Criterion[] }[] = [
    { section: "asset_evaluation", criteria: agent?.asset_evaluation?.quantitative || [] },
    { section: "macro_evaluation", criteria: agent?.macro_evaluation?.quantitative || [] },
  ];
  const entries: Record<string, QuantEntry> = {};
  for (const { section, criteria } of sections) {
    criteria.forEach((c, idx) => {
      const metric = c.metric || c.metric_name || `criterion_${idx}`;
      entries[`${section}:${idx}:${metric}`] = {
        value: null,
        score: null,
        weightage: typeof c.weightage === "number" && Number.isFinite(c.weightage) ? c.weightage : 5,
        unscored_reason: reason,
        category: c.category,
        metric_name: c.metric_name || metric,
        operator: c.operator || "gt",
        threshold: c.value ?? null,
        metric_type: c.metric_type || "number",
        section,
      };
    });
  }
  const agg = aggregateWeightedScores(
    Object.values(entries).map((e) => ({ score: e.score, weightage: e.weightage, unscored_reason: e.unscored_reason })),
  );
  return {
    quantitative_analysis: entries,
    quantitative_score: agg.score, // null — nothing was scored
    fit_low: agg.fit_low,
    fit_high: agg.fit_high,
    coverage: agg.coverage, // 0
    price_data,
  };
}

// ---------------------------------------------------------------------------
// LLM quantitative judge (OPTIONAL overlay, disabled by default — plan 0.4/A6).
//
// Scoring must be deterministic and auditable: by default the deterministic
// evaluator's numbers ARE the quant score and this overlay never runs. When
// QUANT_LLM_JUDGE=1 is explicitly set, the judge may re-score numeric criteria
// for partial credit — every overlaid entry is flagged `scored_by: "llm"` so
// the audit trail shows exactly which numbers came from the model.
// ---------------------------------------------------------------------------

const QUANT_JUDGE_SYSTEM_PROMPT = `You are a quantitative equity score judge. You are given a company's actual financial figures and a list of investment criteria with their rules. For each criterion, score how well the company's actual figure satisfies the rule:
- 1 = rule clearly satisfied.
- Between 0 and 1 = partial satisfaction (e.g. slightly below a threshold gets ~0.7, not a hard 0).
- Only give 0 when the figure clearly fails the rule or the data is missing.
Base scores strictly on the numbers provided. No hedging with 0.5. Respond with ONLY a JSON object mapping each criterion key to its score (number, 0 to 1, up to 4 decimals). No markdown, no commentary.`;

interface LlmJudgementContext {
  modelId: string;
  llmKeys: LlmKeys;
  entries: Record<string, QuantEntry>;
}

function _judgableEntries(entries: Record<string, QuantEntry>): { key: string; entry: QuantEntry }[] {
  return Object.entries(entries)
    .filter(([, e]) => {
      const binary = e.metric_type === "date" || e.metric_type === "text";
      const missing = e.value === undefined || e.value === null || e.value === "";
      return !binary && !missing;
    })
    .map(([key, e]) => ({ key, entry: e }));
}

export function buildQuantJudgementPrompt(entries: Record<string, QuantEntry>): string {
  const lines = _judgableEntries(entries).map(({ key, entry: e }) => {
    const rule =
      e.operator === "between"
        ? `between ${e.threshold} and ${e.value_upper ?? "?"}`
        : `${e.operator} ${e.threshold}`;
    return `"${key}": metric=${e.metric_name} (${e.category ?? "??"}), rule "${rule}", unit=${e.metric_type}, actual=${JSON.stringify(e.value)}, deterministic_score=${e.score}`;
  });
  return [
    "Company figures and criteria (key → details, including the deterministic baseline):",
    "",
    ...lines,
  ].join("\n");
}

// Extract the first JSON object from a model reply, ignoring code fences/prose.
function _parseScoresJson(text: string): Record<string, number> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    return null;
  }
  return null;
}

/**
 * Run the LLM judge over the numeric criteria and return a score overlay
 * keyed by the entry keys from `entries`. Returns an empty map on any failure —
 * callers keep their deterministic scores untouched.
 */
export async function runQuantitativeLLM(ctx: LlmJudgementContext): Promise<Record<string, number>> {
  const judgable = _judgableEntries(ctx.entries);
  if (judgable.length === 0) return {};
  if (!config.quantLlmJudge) return {}; // deterministic scoring only (plan 0.4)

  const prompt = buildQuantJudgementPrompt(ctx.entries);

  try {
    const { buildModel } = await import("./agent.js");
    // Resolve the key through the pool so server-keyed users work too (A6).
    const { apiKey, keyRef } = keyPool.pickKey(ctx.modelId, ctx.llmKeys as Record<string, string | undefined>);
    const model = buildModel(ctx.modelId, ctx.llmKeys, apiKey);
    const provider = ctx.modelId.split("/")[0];
    const turn = await runAgentTurn({
      model,
      system: QUANT_JUDGE_SYSTEM_PROMPT,
      prompt,
      temperature: 0,
      maxOutputTokens: 2048,
    });
    if (turn.error) {
      log.warn("[quant]", "LLM judge failed (deterministic scores kept):", turn.error);
      return {};
    }
    keyPool.recordUsage({
      provider,
      keyRef,
      modelId: ctx.modelId,
      requests: 1,
      tokensIn: turn.usage?.input,
      tokensOut: turn.usage?.output,
    });
    const overlays = _parseScoresJson(turn.text);
    if (!overlays) {
      log.warn("[quant]", "LLM judge reply not JSON (deterministic scores kept)");
      return {};
    }
    const result: Record<string, number> = {};
    for (const e of judgable) {
      const v = overlays[e.key];
      if (typeof v === "number" && Number.isFinite(v)) result[e.key] = Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000;
    }
    return result;
  } catch (e: any) {
    log.warn("[quant]", "LLM judge error (deterministic scores kept):", String(e?.message || e));
    return {};
  }
}

/**
 * Mutate `quant` in place: replace numeric scores with LLM judgement where the
 * overlay provides one (0..1 overlay → 0..100 entry scale), mark scored_by,
 * and recompute the weighted total. Overlay scores bypass unscored handling:
 * the judge only sees entries with real values.
 */
export function applyQuantOverlay(quant: QuantResult, overlay: Record<string, number>): QuantResult {
  if (!overlay || Object.keys(overlay).length === 0) return quant;
  const itemsForScoring: { score: number | null; weightage: number; unscored_reason?: UnscoredReason }[] = [];
  for (const [key, entry] of Object.entries(quant.quantitative_analysis)) {
    const llmScore = overlay[key];
    if (typeof llmScore === "number" && entry.score !== null) {
      entry.score = Math.round(llmScore * 10000) / 100;
      entry.scored_by = "llm";
    }
    itemsForScoring.push({ score: entry.score, weightage: entry.weightage, unscored_reason: entry.unscored_reason });
  }
  const agg = aggregateWeightedScores(itemsForScoring);
  quant.quantitative_score = agg.score;
  quant.fit_low = agg.fit_low;
  quant.fit_high = agg.fit_high;
  quant.coverage = agg.coverage;
  return quant;
}

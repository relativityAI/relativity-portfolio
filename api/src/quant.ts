import { VoyagerClient, type PullStatus } from "./voyager.js";

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
  score: number;
  weightage: number;
  category?: string;
  metric_name: string;
  operator: string;
  threshold: any;
  metric_type: string;
  section: string;
  price_unavailable?: boolean;
}

export interface QuantResult {
  quantitative_analysis: Record<string, QuantEntry>;
  quantitative_score: number;
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
// nested anywhere. Missing value → undefined (scored 0).
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

// Fetch the /financial-metrics snapshot. This is the single metrics source —
// the legacy /equity/data/* snapshot endpoints do not exist in the deployed
// Voyager API. Returns the raw payload plus the price_data marker.
export async function fetchMetricsSnapshot(
  voyager: VoyagerClient,
  symbol: string,
  country: string,
  source: string,
): Promise<{ metrics: Record<string, any>; price_data: "live" | "unavailable" | "unknown" }> {
  let metrics: Record<string, any> = {};
  let price_data: "live" | "unavailable" | "unknown" = "unknown";
  try {
    const data = await voyager.get("/financial-metrics", {
      symbol,
      country,
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
  } catch {
    // no metrics available; callers score missing data as 0
  }
  return { metrics, price_data };
}

export type DataAdequacy = "adequate" | "sparse" | "inadequate";

// Classify how much internal (Voyager) data exists for a symbol, so the run
// can decide whether to auto-enable web search. Heuristic thresholds.
// ponytail: fixed cutoffs, tune once real record counts are known.
export function assessDataAdequacy(
  pullStatus: PullStatus | null,
  metrics: Record<string, any>,
): DataAdequacy {
  const records = Object.values(pullStatus?.collections ?? {}).reduce(
    (n, c) => n + (c?.records || 0),
    0,
  );
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

export function evaluateMetric(
  metrics: Record<string, any>,
  criterion: Criterion,
  section: string,
  price_data?: "live" | "unavailable" | "unknown",
): QuantEntry {
  const key = criterion.metric || criterion.metric_name || "";
  const metric_name = criterion.metric_name || key;
  const metric_type = criterion.metric_type || "number";
  const weightage = typeof criterion.weightage === "number" ? criterion.weightage : 5;
  const operator = criterion.operator || "gt";
  const threshold = criterion.value;
  const value = _findMetric(metrics, key, criterion.category);

  const priceUnavailable =
    price_data === "unavailable" &&
    value === undefined &&
    isPriceDerived(criterion.category);

  const base: QuantEntry = {
    value: value ?? null,
    score: 0,
    weightage,
    category: criterion.category,
    metric_name,
    operator,
    threshold: threshold ?? null,
    metric_type,
    section,
    price_unavailable: priceUnavailable || undefined,
  };

  // Missing data → score 0 (the criterion still contributes its weight).
  if (value === undefined || value === null || value === "") return base;

  try {
    if (metric_type === "date") {
      base.score = _evaluateDate(operator, value, threshold, criterion.value_upper);
      return base;
    }
    if (metric_type === "text") {
      base.score = _evaluateText(operator, value, threshold);
      return base;
    }

    // Numeric types: number, currency, percentage, multiple, ratio.
    const numValue = toNumber(value);
    if (numValue === null) return base;

    const numThreshold = toNumber(threshold);
    if (numThreshold === null) return base;

    const numUpper = operator === "between" ? toNumber(criterion.value_upper) : undefined;
    const spread = Math.max(Math.abs(numThreshold), 1.0) * 0.5;
    let score = _evaluateNumeric(operator, numValue, numThreshold, numUpper ?? undefined, spread);
    score = Math.max(0, Math.min(1, score));
    base.score = Math.round(score * 10000) / 10000;
  } catch {
    // any type/parse error → score 0, never a crash
    base.score = 0;
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
  let weighted = 0;
  let weightSum = 0;

  for (const { section, criteria } of sections) {
    criteria.forEach((c, idx) => {
      const entry = evaluateMetric(metrics, c, section, price_data);
      const metric = c.metric || c.metric_name || `criterion_${idx}`;
      entries[`${section}:${metric}`] = entry;
      weighted += entry.score * entry.weightage;
      weightSum += entry.weightage;
    });
  }

  const quantitative_score =
    weightSum > 0 ? Math.round((weighted / weightSum) * 10000) / 100 : 0;

  return { quantitative_analysis: entries, quantitative_score, price_data };
}

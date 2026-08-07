import { VoyagerClient } from "./voyager.js";

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
  key: string;
  metric_name: string;
  operator: string;
  threshold: any;
  value: any;
  metric_type: string;
  weightage: number;
  score: number;
  passed: boolean;
  skipped: boolean;
}

const EPS = 1e-9;

function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Map profile metric ids (catalog-style, e.g. roe, revenue_growth_yoy) to the
// keys returned by Voyager's /financial-metrics snapshot.
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

function findMetricValue(metrics: Record<string, any>, key: string): any {
  if (!metrics || typeof metrics !== "object") return undefined;
  if (key in metrics) return metrics[key];
  const target = normKey(key);
  for (const [k, v] of Object.entries(metrics)) {
    if (normKey(k) === target) return v;
  }
  // scan one level of nesting (some shapes wrap metrics under a key)
  for (const v of Object.values(metrics)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (key in v) return (v as any)[key];
    }
  }
  const alias = METRIC_ALIASES[target];
  if (alias) {
    for (const [k, v] of Object.entries(metrics)) {
      if (normKey(k) === alias) return v;
    }
  }
  return undefined;
}

async function fetchMetrics(
  voyager: VoyagerClient,
  symbol: string,
  country: string,
  source: string,
): Promise<Record<string, any>> {
  try {
    const data = await voyager.get("/financial-metrics", {
      symbol,
      country,
      source,
      consolidated: true,
      filing_type: "ttm",
    });
    if (data && typeof data === "object" && Object.keys(data).length > 3) return data;
  } catch {
    // fall through to the alternate metrics endpoint
  }
  try {
    const data = await voyager.get("/equity/data/metrics", { symbol, country, source });
    const out: Record<string, any> = {};
    const nested = (data?.data && typeof data.data === "object") ? data.data : data;
    for (const rows of Object.values(nested ?? {})) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (row && typeof row === "object") Object.assign(out, row);
      }
    }
    if (Object.keys(out).length > 0) return out;
  } catch {
    // neither endpoint available
  }
  return {};
}

function evalCompare(
  operator: string,
  value: number,
  threshold: number,
  upper?: number,
): boolean {
  switch (operator) {
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "eq":
      return Math.abs(value - threshold) <= Math.max(Math.abs(threshold) * 1e-6, EPS);
    case "neq":
      return Math.abs(value - threshold) > Math.max(Math.abs(threshold) * 1e-6, EPS);
    case "between":
      return value >= threshold && value <= (upper ?? threshold);
    default:
      return false;
  }
}

function decayScore(operator: string, value: number, threshold: number, upper?: number): number {
  const BAND = 0.1;
  if (operator === "gt" || operator === "gte") {
    if (value >= threshold) return 1;
    if (threshold > 0 && value >= threshold * (1 - BAND)) {
      return value / threshold;
    }
    return 0;
  }
  if (operator === "lt" || operator === "lte") {
    if (value <= threshold) return 1;
    if (threshold !== 0 && value <= threshold * (1 + BAND)) {
      return 2 - value / threshold;
    }
    return 0;
  }
  if (operator === "between") {
    const lo = threshold;
    const hi = upper ?? threshold;
    if (value >= lo && value <= hi) return 1;
    const near =
      (lo !== 0 && value >= lo * (1 - BAND) && value < lo) ||
      (hi !== 0 && value <= hi * (1 + BAND) && value > hi);
    return near ? 0.5 : 0;
  }
  return evalCompare(operator, value, threshold, upper) ? 1 : 0;
}

function evaluateCriterion(metrics: Record<string, any>, criterion: Criterion): QuantEntry {
  const key = criterion.metric || criterion.metric_name || "";
  const metric_name = criterion.metric_name || key;
  const metric_type = criterion.metric_type || "number";
  const weightage = typeof criterion.weightage === "number" ? criterion.weightage : 5;
  const operator = criterion.operator || "gt";
  const threshold = criterion.value;
  const value = findMetricValue(metrics, key);

  const base: QuantEntry = {
    key,
    metric_name,
    operator,
    threshold: threshold ?? null,
    value: value ?? null,
    metric_type,
    weightage,
    score: 0,
    passed: false,
    skipped: false,
  };

  if (value === undefined || value === null || value === "") return { ...base, skipped: true };

  if (metric_type === "date" || metric_type === "text") {
    const eq = String(value).trim().toLowerCase() === String(threshold ?? "").trim().toLowerCase();
    base.passed = operator === "neq" ? !eq : eq;
    base.score = base.passed ? 1 : 0;
    return base;
  }

  const numValue = toNumber(value);
  if (numValue === null) return base;

  const numThreshold = toNumber(threshold);
  if (numThreshold === null) return base;

  const numUpper = operator === "between" ? toNumber(criterion.value_upper) : undefined;
  base.passed = evalCompare(operator, numValue, numThreshold, numUpper ?? undefined);
  base.score = decayScore(operator, numValue, numThreshold, numUpper ?? undefined);
  base.score = Math.max(0, Math.min(1, base.score));
  return base;
}

export interface QuantResult {
  quantitative_analysis: Record<string, QuantEntry>;
  quantitative_score: number | null;
}

export async function runQuantitative(
  voyager: VoyagerClient,
  profile: any,
  symbol: string,
  country: string,
  source: string,
): Promise<QuantResult> {
  const metrics = await fetchMetrics(voyager, symbol, country, source);

  const criteria: Criterion[] = [
    ...(profile?.asset_evaluation?.quantitative || []),
    ...(profile?.macro_evaluation?.quantitative || []),
  ];

  const entries: Record<string, QuantEntry> = {};
  for (const c of criteria) {
    const entry = evaluateCriterion(metrics, c);
    const key = entry.key || `criterion_${Object.keys(entries).length}`;
    entries[key] = entry;
  }

  const scorable = Object.values(entries).filter((e) => !e.skipped);
  if (scorable.length === 0) {
    return { quantitative_analysis: entries, quantitative_score: null };
  }

  const totalWeight = scorable.reduce((s, e) => s + e.weightage, 0);
  const score =
    totalWeight > 0
      ? (scorable.reduce((s, e) => s + e.score * e.weightage, 0) / totalWeight) * 100
      : 0;

  return { quantitative_analysis: entries, quantitative_score: score };
}

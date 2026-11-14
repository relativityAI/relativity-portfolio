/**
 * Canonical units for deterministic quant scoring (plan §6.2).
 *
 * Percentages are ALWAYS stored in percent units: 15 means 15%, never 0.15.
 * Snapshots and rules may arrive in either form, so values are canonicalized
 * before comparison. Scale contract: `null` = not meaningful / not computable
 * (unknown ≠ 0) — never invent a 0.
 */

export type Unit = "pct" | "ratio" | "currency" | "count" | "days";

export interface UnitSpec {
  unit: Unit;
  /** Multiplier from the raw provider value to the canonical unit. */
  scale: number;
}

export function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/,/g, "").replace(/%/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Canonicalize a percentage-ish value to percent units (15 = 15%).
 * A magnitude below 1 is treated as a fraction (0.15 → 15); anything at or
 * above 1 is already in percent units. Zero stays zero.
 */
export function toPercent(v: unknown): number | null {
  const n = toNumber(v);
  if (n === null) return n;
  if (n !== 0 && Math.abs(n) < 1) return n * 100;
  return n;
}

export type RuleOperator = "gt" | "gte" | "lt" | "lte" | "eq" | "between";

export interface ParsedRule {
  operator: RuleOperator;
  value: number | null;
  value_upper?: number | null;
}

const OPS: Array<[RegExp, RuleOperator]> = [
  [/^\s*>=/, "gte"],
  [/^\s*<=/, "lte"],
  [/^\s*>/, "gt"],
  [/^\s*</, "lt"],
  [/^\s*=\s*=/, "eq"],
  [/^\s*=/, "eq"],
];

/**
 * Parse a rule string like "> 15%", "between 10 and 20", "< 5" into
 * operator + threshold. For `unit === "pct"`, an explicit "%" keeps the value
 * as-is (already percent); a bare fraction is canonicalized via toPercent.
 */
export function parseRule(expr: string, unit: Unit = "ratio"): ParsedRule | null {
  if (!expr || typeof expr !== "string") return null;
  const s = expr.trim();
  const between = s.match(/^between\s+([^a]+)\s+and\s+(.+)$/i);
  if (between) {
    return {
      operator: "between",
      value: parseThreshold(between[1], unit),
      value_upper: parseThreshold(between[2], unit),
    };
  }
  for (const [re, op] of OPS) {
    if (re.test(s)) {
      return { operator: op, value: parseThreshold(s.replace(re, ""), unit) };
    }
  }
  const bare = parseThreshold(s, unit);
  return bare === null ? null : { operator: "eq", value: bare };
}

function parseThreshold(raw: string, unit: Unit): number | null {
  if (!/[0-9]/.test(raw)) return null;
  const hasPct = /%/.test(raw);
  const n = toNumber(raw);
  if (n === null) return null;
  if (unit !== "pct" || hasPct) return n;
  return toPercent(n);
}

/** Default minimum spread per unit for QUANT_SPREAD_V2 (D3). */
export const MIN_SPREAD: Record<Unit, number> = {
  pct: 2,
  ratio: 0.1,
  currency: 0.5,
  count: 1,
  days: 2,
};

/** Map a stored metric_type to a canonical unit (number → ratio by default). */
export function unitForMetricType(metricType: string | undefined): Unit {
  switch (metricType) {
    case "percentage":
      return "pct";
    case "currency":
      return "currency";
    case "date":
      return "days";
    default:
      return "ratio";
  }
}

/**
 * History-feature keys (plan §6.2 feature table) that quantitative rules may
 * reference directly (e.g. "roe_min_10y > 12"). findMetricId resolves these to
 * themselves so the snapshot lookup can pick the computed feature up; a missing
 * feature is null → unscored, never 0.
 */
export const FEATURE_KEYS: string[] = [
  "roe_annual",
  "roce_annual",
  "roic_ttm",
  "roe_min_10y",
  "roe_years_above_15",
  "gross_margin",
  "op_margin",
  "net_margin",
  "op_margin_slope_5y",
  "margin_stdev_10y",
  "revenue_cagr_3y",
  "revenue_cagr_5y",
  "revenue_cagr_10y",
  "eps_cagr_3y",
  "eps_cagr_5y",
  "eps_cagr_10y",
  "fcf_cagr_5y",
  "growth_consistency_10y",
  "fcf_conversion_5y",
  "accruals_ratio",
  "capex_to_depreciation",
  "cfo_positive_years_10y",
  "debt_to_equity_trend_5y",
  "net_debt_ebitda",
  "interest_coverage",
  "current_ratio",
  "share_count_change_5y",
  "dividend_years_paid_10y",
  "payout_ratio_5y_avg",
  "piotroski_f",
  "altman_z",
  "promoter_holding_change_4q",
  "promoter_pledge_pct",
  "fii_dii_holding_trend",
];

/**
 * Description + canonical unit per feature, used by the rubric compiler prompt
 * (§6.3 requires the model to see the catalog with descriptions) and the
 * validation fixture. Scalars are numbers; *_annual / series keys are number[].
 */
export const FEATURE_CATALOG: Record<string, { unit: Unit; series?: boolean; desc: string }> = {
  roe_annual: { unit: "pct", series: true, desc: "Return on equity by fiscal year, in %, one entry per year (oldest → newest)." },
  roce_annual: { unit: "pct", series: true, desc: "Return on capital employed by fiscal year, one entry per year." },
  roic_ttm: { unit: "pct", desc: "Return on invested capital, trailing twelve months." },
  roe_min_10y: { unit: "pct", desc: "Lowest annual ROE over the last 10 years." },
  roe_years_above_15: { unit: "count", desc: "Number of the last 10 years with annual ROE above 15%." },
  gross_margin: { unit: "pct", series: true, desc: "Gross margin by fiscal year, in %." },
  op_margin: { unit: "pct", series: true, desc: "Operating margin by fiscal year, in %." },
  net_margin: { unit: "pct", series: true, desc: "Net margin by fiscal year, in %." },
  op_margin_slope_5y: { unit: "pct", desc: "Annualised change in operating margin over the last 5 years (per-x points/year)." },
  margin_stdev_10y: { unit: "pct", desc: "Standard deviation of annual operating margin over 10 years." },
  revenue_cagr_3y: { unit: "pct", desc: "Revenue compound annual growth rate over 3 years, in %." },
  revenue_cagr_5y: { unit: "pct", desc: "Revenue compound annual growth rate over 5 years, in %." },
  revenue_cagr_10y: { unit: "pct", desc: "Revenue compound annual growth rate over 10 years, in %." },
  eps_cagr_3y: { unit: "pct", desc: "EPS compound annual growth rate over 3 years, in %." },
  eps_cagr_5y: { unit: "pct", desc: "EPS compound annual growth rate over 5 years, in %." },
  eps_cagr_10y: { unit: "pct", desc: "EPS compound annual growth rate over 10 years, in %." },
  fcf_cagr_5y: { unit: "pct", desc: "Free cash flow compound annual growth rate over 5 years, in %." },
  growth_consistency_10y: { unit: "ratio", desc: "Share of the last 10 years with positive revenue growth (0..1)." },
  fcf_conversion_5y: { unit: "ratio", desc: "Average free cash flow ÷ net income over 5 years." },
  accruals_ratio: { unit: "ratio", desc: "Sloan accruals ratio (lower = higher earnings quality)." },
  capex_to_depreciation: { unit: "ratio", desc: "Capex ÷ depreciation over the trailing period." },
  cfo_positive_years_10y: { unit: "count", desc: "Number of the last 10 years with positive operating cash flow." },
  debt_to_equity_trend_5y: { unit: "ratio", desc: "Change in debt/equity over 5 years (negative = deleveraging)." },
  net_debt_ebitda: { unit: "ratio", desc: "Net debt ÷ EBITDA." },
  interest_coverage: { unit: "ratio", desc: "EBIT ÷ interest expense." },
  current_ratio: { unit: "ratio", desc: "Current assets ÷ current liabilities." },
  share_count_change_5y: { unit: "pct", desc: "Change in diluted share count over 5 years, in %." },
  dividend_years_paid_10y: { unit: "count", desc: "Number of the last 10 years in which a dividend was paid." },
  payout_ratio_5y_avg: { unit: "pct", desc: "Average payout ratio over 5 years, in %." },
  piotroski_f: { unit: "count", desc: "Piotroski F-score (0..9)." },
  altman_z: { unit: "ratio", desc: "Altman Z-score (non-financials only)." },
  promoter_holding_change_4q: { unit: "pct", desc: "Change in promoter holding over the last 4 quarters, in percentage points." },
  promoter_pledge_pct: { unit: "pct", desc: "Share of promoter holding pledged, in %." },
  fii_dii_holding_trend: { unit: "ratio", desc: "Trend in FII/DII institutional holding (positive = accumulation)." },
};

// Self-check: npx tsx src/units.ts
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const eq = (a: unknown, b: unknown) => {
    if (a !== b) throw new Error(`units: got ${String(a)} want ${String(b)}`);
  };
  eq(toPercent(0.15), 15);
  eq(toPercent(15), 15);
  eq(toPercent("0.15"), 15);
  eq(toPercent("46.6%"), 46.6);
  eq(toPercent(0), 0);
  const pct = parseRule("> 15%", "pct");
  eq(pct?.operator, "gt");
  eq(pct?.value, 15);
  const frac = parseRule("> 0.15", "pct");
  eq(frac?.value, 15);
  const between = parseRule("between 5 and 10");
  eq(between?.operator, "between");
  eq(between?.value, 5);
  eq(between?.value_upper, 10);
  eq(parseRule(""), null);
  eq(parseRule("x"), null);
  eq(parseRule("between 5 and 10", "pct")?.value, 5);
  eq(parseRule("between 5 and 10", "pct")?.value_upper, 10);
  eq(parseRule("< 0.5", "pct")?.value, 50);
  console.log("units OK");
}
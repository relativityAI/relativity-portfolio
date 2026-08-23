export interface MetricDef {
  id: string;
  name: string;
  type: "number" | "percentage" | "currency" | "date" | "text";
}

export interface MetricCategory {
  id: string;
  name: string;
  metrics: MetricDef[];
}

const CATALOG: MetricCategory[] = [
  {
    id: "valuation",
    name: "Valuation",
    metrics: [
      { id: "price_to_earnings_ratio", name: "P/E Ratio", type: "number" },
      { id: "price_to_book_ratio", name: "P/B Ratio", type: "number" },
      { id: "price_to_sales_ratio", name: "P/S Ratio", type: "number" },
      { id: "peg_ratio", name: "PEG Ratio", type: "number" },
      { id: "enterprise_value", name: "Enterprise Value", type: "currency" },
      { id: "market_capitalization", name: "Market Capitalization", type: "currency" },
      { id: "enterprise_value_to_ebitda_ratio", name: "EV / EBITDA", type: "number" },
      { id: "enterprise_value_to_revenue_ratio", name: "EV / Revenue", type: "number" },
      { id: "free_cash_flow_yield", name: "FCF Yield", type: "percentage" },
    ],
  },
  {
    id: "profitability",
    name: "Profitability",
    metrics: [
      { id: "gross_margin", name: "Gross Margin", type: "percentage" },
      { id: "operating_margin", name: "Operating Margin", type: "percentage" },
      { id: "net_margin", name: "Net Margin", type: "percentage" },
      { id: "return_on_equity", name: "Return on Equity", type: "percentage" },
      { id: "return_on_assets", name: "Return on Assets", type: "percentage" },
      { id: "return_on_invested_capital", name: "Return on Invested Capital", type: "percentage" },
    ],
  },
  {
    id: "growth",
    name: "Growth",
    metrics: [
      { id: "revenue_growth", name: "Revenue Growth", type: "percentage" },
      { id: "earnings_growth", name: "Earnings Growth", type: "percentage" },
      { id: "book_value_growth", name: "Book Value Growth", type: "percentage" },
      { id: "earnings_per_share_growth", name: "EPS Growth", type: "percentage" },
      { id: "free_cash_flow_growth", name: "FCF Growth", type: "percentage" },
      { id: "operating_income_growth", name: "Operating Income Growth", type: "percentage" },
      { id: "ebitda_growth", name: "EBITDA Growth", type: "percentage" },
    ],
  },
  {
    id: "efficiency",
    name: "Efficiency",
    metrics: [
      { id: "asset_turnover", name: "Asset Turnover", type: "number" },
      { id: "inventory_turnover", name: "Inventory Turnover", type: "number" },
      { id: "receivables_turnover", name: "Receivables Turnover", type: "number" },
      { id: "days_sales_outstanding", name: "Days Sales Outstanding", type: "number" },
      { id: "operating_cycle", name: "Operating Cycle", type: "number" },
      { id: "working_capital_turnover", name: "Working Capital Turnover", type: "number" },
    ],
  },
  {
    id: "liquidity",
    name: "Liquidity",
    metrics: [
      { id: "current_ratio", name: "Current Ratio", type: "number" },
      { id: "quick_ratio", name: "Quick Ratio", type: "number" },
      { id: "cash_ratio", name: "Cash Ratio", type: "number" },
      { id: "operating_cash_flow_ratio", name: "Operating Cash Flow Ratio", type: "number" },
    ],
  },
  {
    id: "solvency",
    name: "Solvency",
    metrics: [
      { id: "debt_to_equity", name: "Debt / Equity", type: "number" },
      { id: "debt_to_assets", name: "Debt / Assets", type: "number" },
      { id: "interest_coverage", name: "Interest Coverage", type: "number" },
      { id: "total_debt", name: "Total Debt", type: "currency" },
      { id: "total_equity", name: "Total Equity", type: "currency" },
    ],
  },
  {
    id: "per_share",
    name: "Per Share",
    metrics: [
      { id: "earnings_per_share", name: "Earnings per Share", type: "currency" },
      { id: "book_value_per_share", name: "Book Value per Share", type: "currency" },
      { id: "free_cash_flow_per_share", name: "FCF per Share", type: "currency" },
      { id: "payout_ratio", name: "Payout Ratio", type: "percentage" },
    ],
  },
  {
    id: "market",
    name: "Market & Price",
    metrics: [
      { id: "current_price", name: "Current Price", type: "currency" },
      { id: "rsi_14", name: "RSI (14)", type: "number" },
      { id: "sma_20", name: "SMA 20", type: "number" },
      { id: "sma_50", name: "SMA 50", type: "number" },
      { id: "sma_200", name: "SMA 200", type: "number" },
      { id: "atr_14", name: "ATR (14)", type: "number" },
    ],
  },
];

export function getMetricsCatalog(_source?: string): { categories: MetricCategory[] } {
  return { categories: CATALOG };
}

export function findMetricId(metric: string): string | null {
  const target = metric.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const cat of CATALOG) {
    for (const m of cat.metrics) {
      if (m.id.replace(/[^a-z0-9]/g, "") === target) return m.id;
    }
  }
  return null;
}

// ── live metric fields (from Voyager's /financial-metrics snapshot) ────

// Keys that describe the query rather than the company — never offered as criteria.
const METADATA_KEYS = new Set(["symbol", "price_data", "consolidated", "filing_type"]);

const ACRONYMS = new Set(["rsi", "sma", "bb", "atr"]);

function prettifyField(id: string): string {
  return id
    .split("_")
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// Map a /financial-metrics response body to selectable criteria definitions.
// Field names come straight from Voyager so future fields appear automatically.
export function buildFieldList(sample: Record<string, any>): MetricDef[] {
  const fields: MetricDef[] = [];
  for (const key of Object.keys(sample || {})) {
    if (METADATA_KEYS.has(key)) continue;
    fields.push({
      id: key,
      name: prettifyField(key),
      type: /date/i.test(key) ? "date" : "number",
    });
  }
  return fields.sort((a, b) => a.name.localeCompare(b.name));
}

// Fallback when Voyager is unreachable: the hardcoded catalog, flattened.
export function getFlatCatalog(): MetricDef[] {
  return CATALOG.flatMap((c) => c.metrics);
}

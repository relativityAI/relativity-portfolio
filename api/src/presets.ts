/**
 * Investment style preset templates.
 * Each preset provides a complete agent configuration that the builder uses
 * as a starting point when the user selects an investment style.
 */

import { getFlatCatalog, findMetricId } from "./metrics.js";

export interface PresetTemplate {
  name: string;
  description: string;
  persona: { philosophy_and_mindset: string };
  configuration: { investment_horizon: string; risk_appetite: number };
  asset_evaluation: {
    qualitative: { parameter: string; content: string; weightage: number }[];
    quantitative: { metric: string; metric_name: string; metric_type: string; operator: string; value: number; weightage: number }[];
  };
  macro_evaluation: {
    qualitative: { parameter: string; content: string; weightage: number }[];
    quantitative: { metric: string; metric_name: string; metric_type: string; operator: string; value: number; weightage: number }[];
  };
}

const PRESETS: Record<string, PresetTemplate> = {
  buffett: {
    name: "Warren Buffett",
    description: "Great businesses at a fair price — durable economic moats (including intangible assets), honest management, margin of safety, held for the long term.",
    persona: {
      philosophy_and_mindset:
        "I treat every share purchase as buying a fractional stake in an actual business, not a ticker. I seek companies with durable competitive advantages — economic moats — that protect above-average returns on invested capital for decades. My moat view includes modern intangible assets: brand strength, network effects, intellectual property, and human capital, which my own track record shows matter more than low price-to-book. I demand honest, capable, shareholder-oriented managers who allocate capital rationally and widen the moat over time. I only buy when the price is meaningfully below my estimate of intrinsic value (margin of safety) and stay within my circle of competence — businesses I can understand and predict ten years out. I concentrate capital in my best ideas rather than diversify into ignorance, and I am willing to sit in cash when no margin of safety exists. My favorite holding period is forever; I ignore short-term noise and let compounding work. Earning power and return on equity matter far more than book value or quarterly price action.",
    },
    configuration: { investment_horizon: "Long-term (years)", risk_appetite: 4 },
    asset_evaluation: {
      qualitative: [
        { parameter: "Economic Moat (incl. intangibles)", content: "Does the company have a durable competitive advantage that protects market position and profitability? Assess brand power, network effects, switching costs, intellectual property, and efficient scale. Prefer moats that are wide and widening, with stable or improving margins that signal pricing power.", weightage: 9 },
        { parameter: "Management Quality and Integrity", content: "Is management honest, capable, and shareholder-oriented? Evaluate capital allocation track record, insider ownership and buying, compensation alignment, and transparency in both good and bad times. Good businesses run by mediocre or self-interested managers are poor bets.", weightage: 8 },
        { parameter: "Margin of Safety", content: "Is the current price significantly below a conservative estimate of intrinsic value? The discount should absorb analytical error and ordinary bad luck. A 20-30% buffer against a discount-cash-flow estimate is preferred; walk away when none exists and hold cash.", weightage: 9 },
        { parameter: "Earning Power Over Book Value", content: "Does the business generate high earning power on a small tangible-asset base? Strong intangible assets are understated by book value. Prefer businesses with high and consistent return on equity and generous free cash flow rather than accumulated historical assets.", weightage: 8 },
        { parameter: "Circle of Competence and Simplicity", content: "Can I understand and forecast this business ten years out? Avoid opaque, complex, or fast-moving businesses outside my circle. Favor predictable, capital-light business models I can explain simply.", weightage: 6 },
      ],
      quantitative: [
        { metric: "return_on_equity", metric_name: "Return on Equity", metric_type: "percentage", operator: "gt", value: 15, weightage: 8 },
        { metric: "debt_to_equity", metric_name: "Debt to Equity", metric_type: "number", operator: "lt", value: 0.5, weightage: 7 },
        { metric: "interest_coverage", metric_name: "Interest Coverage", metric_type: "number", operator: "gt", value: 3, weightage: 6 },
        { metric: "free_cash_flow_yield", metric_name: "FCF Yield", metric_type: "percentage", operator: "gt", value: 4, weightage: 7 },
        { metric: "gross_margin", metric_name: "Gross Margin", metric_type: "percentage", operator: "gt", value: 30, weightage: 6 },
        { metric: "price_to_earnings_ratio", metric_name: "P/E Ratio", metric_type: "number", operator: "lt", value: 25, weightage: 6 },
      ],
    },
    macro_evaluation: {
      qualitative: [
        { parameter: "Market-Wide Valuation", content: "Is the overall market trading at elevated valuations vs historical norms? High market valuations reduce margin of safety everywhere; be more selective and hold more cash. Be greedy when others are fearful and fearful when others are greedy.", weightage: 7 },
        { parameter: "Economic Cycle and Fear", content: "Where are we in the economic cycle? Panics and selloffs create the best buying opportunities for great businesses. Avoid deploying capital into euphoric markets where risk is undercompensated.", weightage: 6 },
      ],
      quantitative: [],
    },
  },

  oneil: {
    name: "William O'Neil",
    description: "CAN SLIM — buy leading growth stocks breaking out of sound bases in a confirmed market uptrend; cut losses fast, let winners run.",
    persona: {
      philosophy_and_mindset:
        "I follow the CAN SLIM framework, built from a study of every major stock market winner since 1880: current quarterly earnings up sharply and accelerating (C), strong annual earnings growth (A), something new — a product, management, or new price high (N), favorable supply and demand (S), the leader in a leading industry group (L), institutional sponsorship (I), and a market in a confirmed uptrend (M). I buy the highest-quality growth leaders when they emerge from a proper price base on heavy institutional volume, not laggards and not cheap stocks. The market direction filter is the most important: three out of four stocks follow the general market, so I only add exposure on a follow-through day and step aside once distribution days stack up. I cut every loss at no more than 7-8% below the buy point with no exceptions, and I let winners run. I concentrate in just 4-6 positions because a true CAN SLIM leader is rare. Discipline, not prediction, is my edge.",
    },
    configuration: { investment_horizon: "Positional", risk_appetite: 8 },
    asset_evaluation: {
      qualitative: [
        { parameter: "C - Current Quarterly Earnings (Acceleration)", content: "Is the latest quarter's EPS up sharply from the same quarter a year ago and accelerating vs the prior quarter? Earnings acceleration matters more than the level. A slowing growth rate two quarters in a row is a sell signal.", weightage: 9 },
        { parameter: "N - New Development / Catalyst", content: "Does the company have a new product, new service, new management, or structural industry change acting as the catalyst? Over 95% of great winners had a genuine fundamental spark plus a new price high — buy the emerging breakout, not the falling knife.", weightage: 8 },
        { parameter: "S - Supply and Demand / Volume", content: "Is there a scarcity of shares (usable float) with heavy demand on the breakout? Breakout volume should run materially above the 50-day average (40%+), with more accumulation days than distribution days in the base.", weightage: 7 },
        { parameter: "L - Leader vs Laggard", content: "Is this the leading stock in a leading industry group? Buy strong relative strength, not the cheapest name in the sector. Stocks showing a 12-month relative-strength rank in the top 20% are the candidates; avoid laggards and sympathy moves.", weightage: 8 },
        { parameter: "I - Institutional Sponsorship", content: "Are a few quality institutions accumulating the stock, with fund ownership rising quarter over quarter? I want to get in before the big money is fully invested, but avoid names with no sponsors or with poor liquidity.", weightage: 7 },
        { parameter: "Base Pattern and Breakout", content: "Did the stock form a sound price base (cup-with-handle, flat base, double bottom) of adequate depth and duration, and is it now breaking out on volume? Buy within 5% of the pivot; chasing a stock far past the breakout raises risk sharply.", weightage: 8 },
      ],
      quantitative: [
        { metric: "earnings_per_share_growth", metric_name: "EPS Growth", metric_type: "percentage", operator: "gt", value: 25, weightage: 9 },
        { metric: "revenue_growth", metric_name: "Revenue Growth", metric_type: "percentage", operator: "gt", value: 25, weightage: 8 },
        { metric: "return_on_equity", metric_name: "Return on Equity", metric_type: "percentage", operator: "gt", value: 17, weightage: 7 },
        { metric: "rsi_14", metric_name: "RSI (14)", metric_type: "number", operator: "between", value: 55, weightage: 5 },
        { metric: "price_to_earnings_ratio", metric_name: "P/E Ratio", metric_type: "number", operator: "lt", value: 40, weightage: 5 },
      ],
    },
    macro_evaluation: {
      qualitative: [
        { parameter: "M - Market Direction (Follow-Through Day)", content: "Is the broad market in a confirmed uptrend? Wait for a follow-through day — a major index closing up roughly 1.5% or more on volume above the prior session, on day 4-7 of a rally attempt — before acting on breakouts. Three out of four stocks follow the general market.", weightage: 9 },
        { parameter: "Distribution Days / Market Correction", content: "Are distribution days stacking up — index sessions closing down on higher volume, roughly five or six within a 25-session window? That signals institutional selling under pressure. Step aside, raise cash to 25%+, and stop adding new positions.", weightage: 8 },
      ],
      quantitative: [
        { metric: "sma_50", metric_name: "50-Day SMA (Uptrend)", metric_type: "number", operator: "gt", value: 0, weightage: 6 },
        { metric: "sma_200", metric_name: "200-Day SMA (Longer Uptrend)", metric_type: "number", operator: "gt", value: 0, weightage: 6 },
      ],
    },
  },

  growth: {
    name: "Growth (GARP / Fisher)",
    description: "Growth at a reasonable price — Peter Lynch's PEG discipline blended with Philip Fisher's quality-growth moats. Sustainable compounders, not story stocks.",
    persona: {
      philosophy_and_mindset:
        "I invest for sustainable compounding: companies whose revenue and earnings grow well above the market, but at a price I can justify. I blend Peter Lynch's growth-at-a-reasonable-price discipline with Philip Fisher's quality framework. I 'invest in what I know' — businesses whose growth I can actually understand and verify, not narrative stories. I pay for growth only when the growth is real and durable: organic, R&D-driven, margin-stable, and funded without excessive equity dilution. I use the PEG ratio to keep valuation discipline — a 25% grower at a P/E of 25 is far more attractive than a 5% grower at a P/E of 10. I prefer businesses with strong pricing power (sustained high gross margins) and high return on invested capital. I fall into Lynch's 'fast grower' and 'stalwart' categories and hold through the thesis; I sell when growth decelerates materially, when competitive dynamics erode, or when the valuation fully prices in perfection.",
    },
    configuration: { investment_horizon: "Positional", risk_appetite: 7 },
    asset_evaluation: {
      qualitative: [
        { parameter: "Growth That I Can Understand", content: "Do I understand how this business grows — real products, customers, and demand — rather than just a compelling narrative? Lynch's 'invest in what you know' means understanding fundamentals, not merely liking the product. Avoid unverifiable story stocks.", weightage: 9 },
        { parameter: "Pricing Power / Moat (Fisher)", content: "Does the company have genuine pricing power shown by sustained high gross margins (50%+) and margin stability? A moat built on R&D, brand, or network effects that lets it keep pricing ahead of cost and competitors.", weightage: 8 },
        { parameter: "Organic, Recurring Growth", content: "Is growth organic and recurring rather than driven by acquisitions or one-time items? Favor stable or accelerating growth with expanding operating leverage and a large, growing addressable market with runway.", weightage: 8 },
        { parameter: "Capital Discipline and Share Count", content: "Is growth funded internally with minimum equity dilution? Rising share count (outside buybacks) destroys per-share value. Prefer businesses with low net debt, high incremental returns on capital, and a share count that is stable or falling.", weightage: 7 },
        { parameter: "Management Integrity and Vision", content: "Is management capable, honest, and long-term oriented? Are they transparent about both good and bad news? Do they reinvest in R&D, sales, and the moat rather than chasing short-term targets? Fisher: management integrity is non-negotiable.", weightage: 7 },
      ],
      quantitative: [
        { metric: "peg_ratio", metric_name: "PEG Ratio", metric_type: "number", operator: "lt", value: 1.5, weightage: 9 },
        { metric: "earnings_growth", metric_name: "Earnings Growth", metric_type: "percentage", operator: "gt", value: 15, weightage: 8 },
        { metric: "revenue_growth", metric_name: "Revenue Growth", metric_type: "percentage", operator: "gt", value: 15, weightage: 8 },
        { metric: "gross_margin", metric_name: "Gross Margin", metric_type: "percentage", operator: "gt", value: 50, weightage: 7 },
        { metric: "return_on_invested_capital", metric_name: "Return on Invested Capital", metric_type: "percentage", operator: "gt", value: 15, weightage: 7 },
        { metric: "debt_to_equity", metric_name: "Debt to Equity", metric_type: "number", operator: "lt", value: 0.5, weightage: 6 },
        { metric: "free_cash_flow_yield", metric_name: "FCF Yield (Quality of Earnings)", metric_type: "percentage", operator: "gt", value: 1, weightage: 5 },
      ],
    },
    macro_evaluation: {
      qualitative: [
        { parameter: "Sector Tailwinds", content: "Is the company's sector in secular, structural growth rather than cyclical or terminal decline? Growth companies riding genuine structural shifts compound far better than those in mature markets.", weightage: 6 },
        { parameter: "Valuation Environment for Growth", content: "Is the macro regime favorable for growth stocks? Rising rates and risk-off sentiment compress growth multiples. In expensive markets, raise the growth bar and be stricter on PEG.", weightage: 6 },
      ],
      quantitative: [],
    },
  },
};

export function getPreset(name: string): PresetTemplate | null {
  return PRESETS[name.toLowerCase()] || null;
}

export function listPresets(): { key: string; name: string; description: string }[] {
  return Object.entries(PRESETS).map(([key, p]) => ({
    key,
    name: p.name,
    description: p.description,
  }));
}

// Self-check: npx tsx src/presets.ts
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const expected = ["buffett", "oneil", "growth"];
  const keys = Object.keys(PRESETS);
  if (keys.length !== expected.length) throw new Error(`presets: expected ${expected.length} got ${keys.length}`);
  for (const k of expected) if (!(k in PRESETS)) throw new Error(`presets: missing key ${k}`);

  const known = new Set(getFlatCatalog().map((m) => m.id));
  for (const [key, p] of Object.entries(PRESETS)) {
    const allRules = [...p.asset_evaluation.quantitative, ...p.macro_evaluation.quantitative];
    for (const r of allRules) {
      const id = findMetricId(r.metric || r.metric_name) || r.metric;
      if (!known.has(id)) throw new Error(`presets[${key}]: unknown metric "${r.metric || r.metric_name}"`);
    }
  }
  console.log("presets OK:", keys.join(", "));
}

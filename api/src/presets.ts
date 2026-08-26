/**
 * Investment style preset templates.
 * Each preset provides a complete agent configuration that the builder uses
 * as a starting point when the user selects an investment style.
 */

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
  value: {
    name: "Value Investor",
    description: "Warren Buffett / Benjamin Graham style — buy undervalued companies with durable competitive advantages at a margin of safety.",
    persona: {
      philosophy_and_mindset:
        "I evaluate companies through the lens of intrinsic value, seeking businesses with durable competitive advantages — economic moats — that protect profitability over time. I prioritize companies with strong, honest management teams who allocate capital rationally and communicate transparently with shareholders. I buy at a meaningful discount to estimated intrinsic value (margin of safety) and hold for the long term, allowing compound growth to work in my favor. I avoid companies I don't understand, highly leveraged businesses, and situations where the valuation leaves no room for error. My edge comes from patience, discipline, and willingness to be contrarian when the market offers opportunity. I focus on return on equity, free cash flow generation, and consistency of earnings rather than short-term price movements.",
    },
    configuration: { investment_horizon: "Long-term (years)", risk_appetite: 4 },
    asset_evaluation: {
      qualitative: [
        { parameter: "Economic Moat", content: "Does the company have a durable competitive advantage that protects its market position and profitability? Consider brand power, network effects, switching costs, cost advantages, and efficient scale. Moats should be assessable and widening, not narrowing.", weightage: 9 },
        { parameter: "Management Quality", content: "Is the management team honest, competent, and shareholder-oriented? Evaluate capital allocation track record, insider ownership, compensation alignment, and transparency in communication. Look for insider buying and rational capital deployment.", weightage: 8 },
        { parameter: "Margin of Safety", content: "Is the current price significantly below estimated intrinsic value? The discount should be large enough to account for errors in estimation and adverse developments. A minimum 20-30% discount to conservative intrinsic value estimates is preferred.", weightage: 9 },
        { parameter: "Business Simplicity", content: "Can the business model be understood and explained simply? Avoid complex, opaque businesses where it's difficult to assess competitive position or predict future cash flows. Stay within your circle of competence.", weightage: 6 },
        { parameter: "Financial Health", content: "Is the balance sheet strong with manageable debt levels? Evaluate debt-to-equity, interest coverage, and ability to weather economic downturns without financial distress. Prefer companies that can self-fund growth.", weightage: 7 },
      ],
      quantitative: [
        { metric: "roe", metric_name: "Return on Equity", metric_type: "percentage", operator: "gt", value: 15, weightage: 8 },
        { metric: "debt_to_equity", metric_name: "Debt to Equity", metric_type: "number", operator: "lt", value: 0.5, weightage: 7 },
        { metric: "price_to_earnings_ratio", metric_name: "P/E Ratio", metric_type: "number", operator: "lt", value: 20, weightage: 8 },
        { metric: "price_to_book_ratio", metric_name: "P/B Ratio", metric_type: "number", operator: "lt", value: 3, weightage: 6 },
        { metric: "fcf_yield", metric_name: "FCF Yield", metric_type: "percentage", operator: "gt", value: 5, weightage: 7 },
      ],
    },
    macro_evaluation: {
      qualitative: [
        { parameter: "Market Valuation", content: "Is the overall market trading at elevated valuations relative to historical norms? High market-level valuations reduce the margin of safety available across the board. Be more selective in expensive markets.", weightage: 6 },
        { parameter: "Economic Cycle", content: "Where are we in the economic cycle? Recessionary environments may create value opportunities but also increase risk of permanent capital loss for weaker businesses.", weightage: 5 },
      ],
      quantitative: [
        { metric: "current_price", metric_name: "Market Index Level", metric_type: "number", operator: "gt", value: 0, weightage: 4 },
      ],
    },
  },

  growth: {
    name: "Growth Investor",
    description: "Peter Lynch / Philip Fisher style — invest in high-growth companies with expanding markets and strong execution.",
    persona: {
      philosophy_and_mindset:
        "I invest in companies experiencing rapid revenue and earnings growth, ideally driven by expanding market opportunity, product innovation, and strong execution. I look for companies growing faster than their industry average with a clear path to sustained growth. Revenue growth trajectory matters more than current profitability — I'm willing to pay a premium for growth if the addressable market is large enough. I focus on the quality of growth: organic vs acquired, recurring vs one-time, and margin expansion potential. I monitor key growth metrics closely and am willing to sell when growth decelerates materially. I prefer companies with product-driven moats and sticky customer relationships that create compounding revenue streams.",
    },
    configuration: { investment_horizon: "Positional", risk_appetite: 7 },
    asset_evaluation: {
      qualitative: [
        { parameter: "Revenue Growth Trajectory", content: "Is the company growing revenue consistently at an above-average rate? Look for accelerating or stable high growth rates (20%+), driven by organic expansion rather than acquisitions. Growth should be driven by increasing demand, not just price increases.", weightage: 9 },
        { parameter: "Market Opportunity", content: "How large is the total addressable market (TAM) and what is the company's penetration rate? A large, growing TAM with low current penetration suggests significant runway for continued growth.", weightage: 8 },
        { parameter: "Competitive Differentiation", content: "What makes this company's products or services uniquely valuable? Look for proprietary technology, network effects, or brand loyalty that creates defensible growth. The company should be gaining market share, not just riding a growing market.", weightage: 8 },
        { parameter: "Scalability", content: "Can the company grow revenue significantly without proportional cost increases? Look for operating leverage, software-like economics, or business models where incremental revenue drops to the bottom line at higher margins.", weightage: 7 },
        { parameter: "Management Vision", content: "Does the leadership team have a clear vision for sustaining growth? Evaluate their track record of execution, ability to pivot when needed, and track record of investing in R&D and innovation.", weightage: 7 },
      ],
      quantitative: [
        { metric: "revenue_growth", metric_name: "Revenue Growth", metric_type: "percentage", operator: "gt", value: 20, weightage: 9 },
        { metric: "earnings_growth", metric_name: "Earnings Growth", metric_type: "percentage", operator: "gt", value: 15, weightage: 7 },
        { metric: "gross_margin", metric_name: "Gross Margin", metric_type: "percentage", operator: "gt", value: 50, weightage: 6 },
        { metric: "roe", metric_name: "Return on Equity", metric_type: "percentage", operator: "gt", value: 15, weightage: 6 },
      ],
    },
    macro_evaluation: {
      qualitative: [
        { parameter: "Sector Tailwinds", content: "Is the company's sector experiencing structural growth trends? Favor companies in secular growth industries rather than cyclical or declining sectors.", weightage: 6 },
        { parameter: "Risk Appetite Environment", content: "Is the market environment favorable for growth stocks? Rising rates and risk-off sentiment tend to compress growth stock valuations.", weightage: 5 },
      ],
      quantitative: [],
    },
  },

  momentum: {
    name: "Momentum Trader",
    description: "Trend-following style — ride price momentum, relative strength, and volume confirmation for shorter-term positions.",
    persona: {
      philosophy_and_mindset:
        "I follow price trends and momentum signals, believing that stocks in motion tend to stay in motion. I focus on relative strength — stocks outperforming their sector and the broader market — combined with volume confirmation to validate trend conviction. I enter positions when trends are established and exit when momentum weakens. Technical indicators guide my timing: moving averages for trend direction, RSI for overbought/oversold conditions, and volume patterns for confirmation. I'm not concerned with intrinsic value — I trade what I see, not what I think a stock is worth. Cut losses quickly, let winners run. Position sizing and risk management are paramount since I'm trading with shorter timeframes.",
    },
    configuration: { investment_horizon: "Swing", risk_appetite: 8 },
    asset_evaluation: {
      qualitative: [
        { parameter: "Trend Strength", content: "Is the stock in a clear uptrend with higher highs and higher lows? The trend should be visible on multiple timeframes (daily and weekly). Avoid stocks in consolidation or downtrend patterns.", weightage: 9 },
        { parameter: "Volume Profile", content: "Is volume confirming the price move? Look for above-average volume on up days and decreasing volume on pullbacks. Volume spikes on breakouts indicate strong institutional participation.", weightage: 8 },
        { parameter: "Sector Momentum", content: "Is the stock's sector also showing momentum? Strong stocks in strong sectors have the highest probability of continued outperformance. Avoid being the only strong stock in a weak sector.", weightage: 7 },
        { parameter: "Catalyst Presence", content: "Is there a fundamental or technical catalyst driving the move? Earnings beats, product launches, sector news, or technical breakouts from consolidation patterns can fuel sustained momentum.", weightage: 6 },
      ],
      quantitative: [
        { metric: "sma_200", metric_name: "Price vs 200-Day SMA", metric_type: "number", operator: "gt", value: 0, weightage: 8 },
        { metric: "rsi_14", metric_name: "RSI (14)", metric_type: "number", operator: "between", value: 40, weightage: 7 },
        { metric: "sma_50", metric_name: "50-Day SMA", metric_type: "number", operator: "gt", value: 0, weightage: 7 },
      ],
    },
    macro_evaluation: {
      qualitative: [
        { parameter: "Market Trend", content: "Is the broader market in an uptrend? Trade with the market direction, not against it. Reduce position sizes in choppy or declining markets.", weightage: 7 },
      ],
      quantitative: [],
    },
  },

  quantitative: {
    name: "Quantitative / Systematic",
    description: "Rules-based approach — purely numbers-driven, systematic evaluation with no discretion.",
    persona: {
      philosophy_and_mindset:
        "I follow a purely rules-based, systematic approach to investment analysis. Every decision is driven by quantitative metrics and predefined criteria — no gut feelings, no narrative-driven decisions. I believe markets are inefficient enough that systematic factor-based strategies can generate excess returns over time. My process involves screening for stocks that meet strict numerical thresholds across valuation, profitability, growth, and quality factors. I apply consistent position sizing and rebalancing rules. Diversification across many positions reduces idiosyncratic risk. I backtest strategies before deploying capital and track performance rigorously. The key is discipline — following the system even when it feels uncomfortable.",
    },
    configuration: { investment_horizon: "Positional", risk_appetite: 6 },
    asset_evaluation: {
      qualitative: [
        { parameter: "Factor Exposure", content: "Does the stock exhibit strong exposure to proven investment factors (value, quality, momentum, low volatility)? Factor tilts should be deliberate and aligned with the systematic strategy.", weightage: 7 },
        { parameter: "Data Quality", content: "Is the financial data reliable and sufficient for quantitative analysis? Avoid companies with restatements, unusual accounting, or sparse historical data that could produce misleading signals.", weightage: 8 },
        { parameter: "Rebalance Discipline", content: "Does the position follow predefined entry/exit rules? No discretionary overrides — if the system says sell, sell. Track adherence to rebalancing schedule.", weightage: 9 },
      ],
      quantitative: [
        { metric: "price_to_earnings_ratio", metric_name: "P/E Ratio", metric_type: "number", operator: "lt", value: 15, weightage: 7 },
        { metric: "roe", metric_name: "Return on Equity", metric_type: "percentage", operator: "gt", value: 12, weightage: 8 },
        { metric: "dividend_yield", metric_name: "Dividend Yield", metric_type: "percentage", operator: "gt", value: 2, weightage: 5 },
        { metric: "debt_to_equity", metric_name: "Debt to Equity", metric_type: "number", operator: "lt", value: 1, weightage: 6 },
      ],
    },
    macro_evaluation: {
      qualitative: [
        { parameter: "Market Regime", content: "What is the current market regime (trending, mean-reverting, volatile)? Different factor strategies perform differently in various regimes. Adjust factor weights accordingly.", weightage: 6 },
      ],
      quantitative: [],
    },
  },

  contrarian: {
    name: "Contrarian Investor",
    description: "Anti-consensus approach — find deep value in distressed, ignored, or hated areas of the market.",
    persona: {
      philosophy_and_mindset:
        "I deliberately seek out investments that the market hates, ignores, or misunderstands. When consensus is overwhelmingly negative, I look for asymmetric opportunities where the downside is limited but the upside is substantial. I buy when there's 'blood in the streets' — during sector downturns, after scandals, or when temporary problems are priced as permanent. My edge comes from independent analysis and the psychological fortitude to buy when everyone else is selling. I focus on catalysts that could reverse sentiment and require patience for the market to recognize value. I always demand a significant margin of safety since contrarian positions can take years to play out. I'm comfortable being wrong for a while before being right.",
    },
    configuration: { investment_horizon: "Long-term (years)", risk_appetite: 7 },
    asset_evaluation: {
      qualitative: [
        { parameter: "Contrarian Thesis", content: "Is there a clear, well-reasoned thesis for why the market is wrong about this company? The thesis should identify a specific catalyst or mispricing that the market is overlooking. Without a catalyst, cheap can stay cheap.", weightage: 9 },
        { parameter: "Sentiment Extreme", content: "How negative is the current sentiment? Look for extreme pessimism: heavy insider selling already occurred, analyst downgrades, negative news coverage. The more extreme the negativity, the larger the potential opportunity.", weightage: 8 },
        { parameter: "Valuation Disconnect", content: "Is there a measurable gap between current price and intrinsic value? The discount should be larger than for typical value investments since contrarian positions carry higher uncertainty.", weightage: 9 },
        { parameter: "Risk Asymmetry", content: "Is the risk/reward heavily skewed to the upside? Downside should be limited (strong assets, debt maturity schedule, breakup value) while upside is substantial if the thesis plays out.", weightage: 8 },
      ],
      quantitative: [
        { metric: "price_to_book_ratio", metric_name: "P/B Ratio", metric_type: "number", operator: "lt", value: 1, weightage: 8 },
        { metric: "price_to_earnings_ratio", metric_name: "P/E Ratio", metric_type: "number", operator: "lt", value: 10, weightage: 7 },
        { metric: "dividend_yield", metric_name: "Dividend Yield", metric_type: "percentage", operator: "gt", value: 3, weightage: 5 },
      ],
    },
    macro_evaluation: {
      qualitative: [
        { parameter: "Contrarian Macro Signal", content: "Is the macro environment creating fear that is opportunity? Recessions, rate hikes, and geopolitical crises often create the best contrarian buying opportunities.", weightage: 7 },
      ],
      quantitative: [],
    },
  },

  income: {
    name: "Income / Dividend Investor",
    description: "Yield-focused — prioritize dividend income, payout sustainability, and capital preservation.",
    persona: {
      philosophy_and_mindset:
        "I invest primarily for income generation through dividends and interest payments. Capital preservation is equally important — I cannot afford large drawdowns since I rely on steady income streams. I focus on companies with long track records of consistent and growing dividends, supported by strong free cash flow and conservative payout ratios. Dividend growth matters as much as current yield since it protects purchasing power against inflation. I avoid high-yield traps — stocks with unsustainably high yields that signal impending dividend cuts. Sector diversification is important since income sectors (utilities, REITs, financials) can be cycle-sensitive. I reinvest dividends in accumulation phase and use them for income in distribution phase.",
    },
    configuration: { investment_horizon: "Long-term (years)", risk_appetite: 3 },
    asset_evaluation: {
      qualitative: [
        { parameter: "Dividend Sustainability", content: "Is the dividend supported by sustainable free cash flow? The payout ratio should be comfortable (below 60% for most sectors), and earnings/cash flow should be stable or growing. Avoid dividends funded by debt or one-time items.", weightage: 9 },
        { parameter: "Dividend Growth History", content: "Has the company consistently grown its dividend over multiple years? Look for 5+ years of consecutive dividend increases (dividend aristocrat status). Growth rate should at least match inflation.", weightage: 8 },
        { parameter: "Balance Sheet Strength", content: "Is the balance sheet conservative enough to maintain dividends during downturns? Low debt, strong interest coverage, and ample free cash flow provide a dividend safety buffer.", weightage: 8 },
        { parameter: "Sector Stability", content: "Is the company in a stable, non-cyclical sector? Utilities, consumer staples, healthcare, and established financials tend to have more predictable dividend policies than cyclicals or growth sectors.", weightage: 6 },
      ],
      quantitative: [
        { metric: "dividend_yield", metric_name: "Dividend Yield", metric_type: "percentage", operator: "gt", value: 3, weightage: 9 },
        { metric: "payout_ratio", metric_name: "Payout Ratio", metric_type: "percentage", operator: "lt", value: 60, weightage: 8 },
        { metric: "roe", metric_name: "Return on Equity", metric_type: "percentage", operator: "gt", value: 10, weightage: 5 },
        { metric: "interest_coverage", metric_name: "Interest Coverage", metric_type: "number", operator: "gt", value: 3, weightage: 6 },
      ],
    },
    macro_evaluation: {
      qualitative: [
        { parameter: "Interest Rate Environment", content: "How do current interest rates affect dividend stock attractiveness? Rising rates make bonds more competitive with dividends. Falling rates make dividend stocks relatively more attractive.", weightage: 6 },
      ],
      quantitative: [],
    },
  },

  macro: {
    name: "Macro / Thematic Investor",
    description: "Top-down approach — invest based on economic indicators, sector rotation, and macroeconomic themes.",
    persona: {
      philosophy_and_mindset:
        "I take a top-down approach, starting with macroeconomic analysis and sector rotation before selecting individual stocks. I believe that asset allocation and sector exposure drive most of portfolio returns, and individual stock selection is secondary to getting the macro picture right. I monitor leading economic indicators, central bank policy, yield curves, credit spreads, and commodity prices to identify the current economic regime. I rotate into sectors that historically outperform in the current environment and avoid sectors facing headwinds. Thematic investing — identifying structural shifts like AI adoption, energy transition, or demographic changes — provides longer-term alpha opportunities. I'm comfortable being heavily cash-weighted when macro conditions are unfavorable.",
    },
    configuration: { investment_horizon: "Positional", risk_appetite: 6 },
    asset_evaluation: {
      qualitative: [
        { parameter: "Sector Alignment", content: "Is this company in a sector that benefits from the current macro environment? Favor sectors with tailwinds from interest rates, economic growth, policy changes, or structural trends.", weightage: 8 },
        { parameter: "Macro Sensitivity", content: "How sensitive is this company to the macro factors I'm currently monitoring? Companies with low macro sensitivity may underperform in a macro-driven market. Understand the beta to rates, growth, and inflation.", weightage: 7 },
        { parameter: "Thematic Relevance", content: "Does this company benefit from major structural themes (AI, energy transition, demographics, deglobalization)? Thematic alignment can drive multi-year outperformance beyond normal business cycles.", weightage: 7 },
      ],
      quantitative: [
        { metric: "price_to_earnings_ratio", metric_name: "P/E vs Sector Avg", metric_type: "number", operator: "lt", value: 1, weightage: 6 },
        { metric: "revenue_growth", metric_name: "Revenue Growth", metric_type: "percentage", operator: "gt", value: 10, weightage: 7 },
      ],
    },
    macro_evaluation: {
      qualitative: [
        { parameter: "Economic Growth", content: "Is the economy expanding or contracting? GDP growth, PMI, employment data, and consumer confidence indicate the current phase. Favor cyclical sectors in expansion, defensives in contraction.", weightage: 8 },
        { parameter: "Central Bank Policy", content: "Is the central bank easing or tightening? Rate cuts favor growth and real assets; rate hikes favor value and financials. Watch for pivot signals and policy changes.", weightage: 8 },
        { parameter: "Geopolitical Risk", content: "Are there significant geopolitical risks that could disrupt markets? Trade wars, conflicts, and policy uncertainty can create both risks and opportunities depending on sector exposure.", weightage: 6 },
      ],
      quantitative: [
        { metric: "current_price", metric_name: "Market Trend", metric_type: "number", operator: "gt", value: 0, weightage: 5 },
      ],
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

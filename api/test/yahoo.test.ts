import { describe, expect, it, vi, beforeEach } from "vitest";
import { yahooTools } from "../src/harness/tools/builtins/yahoo.js";
import { buildToolRegistry } from "../src/harness/tools/sources.js";

const m = vi.hoisted(() => ({
  quote: vi.fn(),
  quoteSummary: vi.fn(),
  search: vi.fn(),
  insights: vi.fn(),
  getPriceHistory: vi.fn(),
}));

vi.mock("yahoo-finance2", () => ({
  default: class {
    quote = m.quote;
    quoteSummary = m.quoteSummary;
    search = m.search;
    insights = m.insights;
  },
}));

// Real toYahooSymbol/priceHistoryDigest stay; only the network fetch is mocked.
vi.mock("../src/marketdata.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/marketdata.js")>();
  return { ...actual, getPriceHistory: m.getPriceHistory };
});

const CTX = { symbol: "AAPL", source: "SEC" };
const tools = yahooTools();
const get = (name: string) => tools.find((t) => t.name === name)!;

beforeEach(() => vi.clearAllMocks());

describe("yahoo tools", () => {
  it("registers by default and disables with yahoo: false", async () => {
    const on = await buildToolRegistry({ mcp: [] }, {}, {});
    expect(on.registry.list().map((t) => t.name)).toContain("get_quote");
    const off = await buildToolRegistry({ yahoo: false, mcp: [] }, {}, {});
    expect(off.registry.list().map((t) => t.name)).not.toContain("get_quote");
  });

  it("get_quote defaults to ctx.symbol and maps fields", async () => {
    m.quote.mockResolvedValue({
      symbol: "AAPL",
      longName: "Apple Inc.",
      regularMarketPrice: 344.63,
      regularMarketChangePercent: -1.2,
      currency: "USD",
      regularMarketVolume: 67_842_804,
      marketCap: 5_029_592_301_568,
      fiftyTwoWeekHigh: 351.73,
      fiftyTwoWeekLow: 243.42,
      trailingPE: 40.1,
      dividendYield: 0.004,
      fullExchangeName: "NasdaqGS",
    });
    const out = (await get("get_quote").execute({}, CTX)) as any;
    expect(m.quote).toHaveBeenCalledWith("AAPL");
    expect(out.price).toBe(344.63);
    expect(out.market_cap).toBe(5_029_592_301_568);
    expect(out.source).toBe("yahoo");
  });

  it("get_quote with explicit symbol uppercases it", async () => {
    m.quote.mockResolvedValue({ symbol: "reliance.ns", regularMarketPrice: 1400 });
    const out = (await get("get_quote").execute({ symbol: "reliance.ns" }, CTX)) as any;
    expect(m.quote).toHaveBeenCalledWith("RELIANCE.NS");
    expect(out.price).toBe(1400);
  });

  it("applies the source exchange suffix and never doubles it", async () => {
    m.quote.mockResolvedValue({ symbol: "RELIANCE.NS", regularMarketPrice: 1400 });
    await get("get_quote").execute({}, { symbol: "RELIANCE", source: "NSE" });
    expect(m.quote).toHaveBeenLastCalledWith("RELIANCE.NS");
    await get("get_quote").execute({ symbol: "RELIANCE.NS" }, { symbol: "x", source: "NSE" });
    expect(m.quote).toHaveBeenLastCalledWith("RELIANCE.NS");
    await get("get_quote").execute({}, { symbol: "GLAND", source: "BSE" });
    expect(m.quote).toHaveBeenLastCalledWith("GLAND.BO");
    await get("get_quote").execute({}, CTX); // SEC source stays bare
    expect(m.quote).toHaveBeenLastCalledWith("AAPL");
  });

  it("failure returns {error}, never null or a throw", async () => {
    m.quote.mockRejectedValue(new Error("Yahoo returned no data for ticker ZZZZ."));
    const out = (await get("get_quote").execute({ symbol: "ZZZZ" }, CTX)) as any;
    expect(out).toMatchObject({ error: expect.stringContaining("ZZZZ"), source: "yahoo" });
    expect(out).not.toBeNull();
  });

  it("get_fundamentals digests the quoteSummary modules", async () => {
    m.quoteSummary.mockResolvedValue({
      assetProfile: { sector: "Technology", industry: "Consumer Electronics" },
      summaryDetail: { marketCap: 5e12, trailingPE: 40 },
      financialData: { profitMargins: 0.25, targetMeanPrice: 370 },
      defaultKeyStatistics: { beta: 1.2 },
    });
    const out = (await get("get_fundamentals").execute({ symbol: "aapl" }, CTX)) as any;
    expect(m.quoteSummary).toHaveBeenCalledWith("AAPL", { modules: ["assetProfile", "financialData", "defaultKeyStatistics", "summaryDetail"] });
    expect(out.profile.sector).toBe("Technology");
    expect(out.valuation.marketCap).toBe(5e12);
    expect(out.profitability.profitMargins).toBe(0.25);
    expect(out.analyst.targetMeanPrice).toBe(370);
    expect(out.metrics.beta).toBe(1.2);
  });

  it("search_symbol filters to tradeable quote types and caps results", async () => {
    m.search.mockResolvedValue({
      quotes: [
        { symbol: "RELIANCE.NS", shortname: "RELIANCE INDUSTRIES LTD", quoteType: "EQUITY", exchange: "NSI" },
        { symbol: "APPLE", quoteType: "MUTUALFUND", exchange: "" },
        { symbol: "AAPL", longname: "Apple Inc.", quoteType: "EQUITY", exchange: "NMS" },
      ],
    });
    const out = (await get("search_symbol").execute({ query: "apple" }, CTX)) as any;
    expect(out.count).toBe(2);
    expect(out.results.map((r: any) => r.symbol)).toEqual(["RELIANCE.NS", "AAPL"]);
    expect(out.results[1].name).toBe("Apple Inc.");
  });

  it("get_insights maps technicals + recommendation", async () => {
    m.insights.mockResolvedValue({
      recommendation: { rating: "BUY", targetPrice: 375, provider: "Argus Research" },
      instrumentInfo: {
        technicalEvents: { shortTermOutlook: { direction: "Bearish", score: 2, scoreDescription: "Bearish Evidence" } },
        keyTechnicals: { support: 255.65, resistance: 348.15, stopLoss: 328.55 },
        valuation: { description: "Overvalued" },
      },
    });
    const out = (await get("get_insights").execute({}, CTX)) as any;
    expect(out.support).toBe(255.65);
    expect(out.resistance).toBe(348.15);
    expect(out.recommendation).toMatchObject({ rating: "BUY", targetPrice: 375 });
    expect(out.short_term.direction).toBe("Bearish");
    expect(out.valuation_view).toBe("Overvalued");
  });

  it("get_insights reports honestly when Yahoo has no insight data (e.g. NSE listings)", async () => {
    m.insights.mockResolvedValue({ symbol: "RELIANCE.NS" });
    const out = (await get("get_insights").execute({}, { symbol: "RELIANCE", source: "NSE" })) as any;
    expect(out).toMatchObject({ error: expect.stringContaining("RELIANCE.NS"), source: "yahoo" });
  });

  it("get_price_history returns digest + OHLCV series the chart pipeline can read", async () => {
    const candles = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, "0")}`,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100.5 + i,
      volume: 1000 + i,
    }));
    m.getPriceHistory.mockResolvedValue({
      symbol: "RELIANCE.NS",
      range: "1y",
      candles,
      sma20: [{ date: "2026-09-30", value: 120 }],
      sma50: [{ date: "2026-09-30", value: null }],
      sma200: [{ date: "2026-09-30", value: null }],
      rsi14: [{ date: "2026-09-30", value: 55.5 }],
      fifty_two_week: { high: 1611.8, low: 1152.2 },
      source: "yahoo",
    });
    const out = (await get("get_price_history").execute({}, { symbol: "RELIANCE", source: "NSE" })) as any;
    expect(m.getPriceHistory).toHaveBeenCalledWith("RELIANCE.NS", "1y", "NSE");
    expect(out.candles_recent).toHaveLength(30);
    expect(out.candles_recent[0]).toEqual({ date: "2026-09-01", o: 100, h: 101, l: 99, c: 100.5, v: 1000 });
    expect(out.sma20).toEqual([{ date: "2026-09-30", v: 120 }]);
    expect(out.sma50).toEqual([]); // nulls dropped — series must stay numeric
    expect(out.rsi14).toEqual([{ date: "2026-09-30", v: 55.5 }]);
    expect(out.digest).toContain("last_close=129.5");
    expect(out.fifty_two_week).toEqual({ high: 1611.8, low: 1152.2 });
  });

  it("get_price_history passes the period through and defaults to 1y", async () => {
    m.getPriceHistory.mockResolvedValue(null);
    await get("get_price_history").execute({ period: "2y" }, CTX);
    expect(m.getPriceHistory).toHaveBeenLastCalledWith("AAPL", "2y", "SEC");
    await get("get_price_history").execute({}, CTX);
    expect(m.getPriceHistory).toHaveBeenLastCalledWith("AAPL", "1y", "SEC");
  });

  it("get_price_history returns {error} when history is unavailable", async () => {
    m.getPriceHistory.mockResolvedValue(null);
    const out = (await get("get_price_history").execute({ period: "max" }, CTX)) as any;
    expect(out).toMatchObject({ error: expect.stringContaining("AAPL"), source: "yahoo" });
    expect(out).not.toBeNull();
  });

  it("series invariant: get_price_history unlocks plots, digest tools do not", async () => {
    const { TEXT_TOOLS } = await import("../src/harness/canvas/run.js");
    expect(TEXT_TOOLS.has("get_price_history")).toBe(false);
    for (const n of ["get_quote", "get_fundamentals", "search_symbol", "get_insights"]) {
      expect(TEXT_TOOLS.has(n)).toBe(true);
    }
  });
});

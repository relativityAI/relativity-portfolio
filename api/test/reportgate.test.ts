import { describe, it, expect } from "vitest";
import { gateReport } from "../src/reportGate.js";
import { deriveStance, type PriceHistory } from "../src/marketdata.js";
import type { AnalysisReport } from "../src/agent.js";

function reportWith(prose: string): AnalysisReport {
  return {
    heroPct: 50,
    heroLabel: "Neutral",
    partial: false,
    source: "llm",
    blocks: [{ type: "paragraph", text: prose }],
  };
}

// rsi=28 → genuinely oversold (< 30); level map available; no mtf rows needed.
// 33 used to be treated as oversold here, which is exactly why v2 called
// KEI's 36.45 / 52.52 / 41.37 "a mix of oversold and overbought".
const BEARISH_FACTS = "price=100.5 as_of=2026-09-30\nrsi14=28\nlevel map: support 98 (2 touches); resistance 105";

describe("gateReport", () => {
  it("flags bullish sentiment while RSI is oversold", () => {
    const g = gateReport(reportWith("Momentum is constructive and the setup looks healthy."), BEARISH_FACTS);
    expect(g.pass).toBe(false);
    expect(g.issues.join(" ")).toContain("RSI 28");
  });

  it("does NOT flag bullish prose when RSI is inside the neutral band", () => {
    const neutral = "price=100.5 as_of=2026-09-30\nrsi14=36.45\nlevel map: support 98";
    const g = gateReport(reportWith("The MACD histogram is positive and momentum is constructive."), neutral);
    expect(g.issues.join(" ")).not.toMatch(/RSI/);
  });

  // A vague trend claim is a WARNING, not a block: it killed a real 80-score
  // AAPL run. The check must still fire, but never gate publication.
  it("flags trend claims without a timeframe as a warning, not a block", () => {
    const g = gateReport(reportWith("The stock is in a clear uptrend."), BEARISH_FACTS);
    expect(g.warnings.join(" ")).toContain("without a timeframe");
    expect(g.pass).toBe(true);
  });

  it("flags specific levels when the level map is INSUFFICIENT", () => {
    const facts = "price=100.5 as_of=2026-09-30\nlevel map: INSUFFICIENT";
    const g = gateReport(reportWith("Support sits near 98 and stop loss at 94."), facts);
    expect(g.pass).toBe(false);
    expect(g.issues.join(" ")).toContain("level map is INSUFFICIENT");
  });

  it("flags volume claims when max 50d volume ratio is below 1.5", () => {
    const facts = "price=100.5 as_of=2026-09-30\nvolume_ratio_max=1.10";
    const g = gateReport(reportWith("The breakout came on strong volume."), facts);
    expect(g.pass).toBe(false);
    expect(g.issues.join(" ")).toContain("volume");
  });

  it("flags agreement claims when daily and weekly conflict", () => {
    const facts =
      "price=100.5 as_of=2026-09-30\nmtf_matrix: daily: 4 bull / 1 bear; weekly: 0 bull / 5 bear";
    const g = gateReport(reportWith("The daily and weekly timeframes agree — the matrix confirms the view."), facts);
    expect(g.pass).toBe(false);
    expect(g.issues.join(" ")).toContain("MTF");
  });

  it("passes a clean grounded report", () => {
    const facts =
      "price=100.5 as_of=2026-09-30\nrsi14=55\nlevel map: support 98\nvolume_ratio_max=2.10\nmtf_matrix: daily: 3 bull / 2 bear; weekly: 3 bull / 1 bear";
    const g = gateReport(
      reportWith("On the daily timeframe momentum is steady with support near 98. Weekly timeframes agree."),
      facts,
    );
    expect(g.pass).toBe(true);
    expect(g.issues).toEqual([]);
  });
});

function makeHistory(overrides: Partial<PriceHistory> = {}): PriceHistory {
  const n = 60;
  const candles = Array.from({ length: n }, (_, i) => ({
    date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`,
    open: 100,
    high: 101,
    low: 99,
    close: 100 + i, // rising series → price above every SMA
    volume: 1_000_000,
  }));
  const series = (value: number) => Array.from({ length: n }, (_, i) => ({ date: candles[i].date, value }));
  return {
    symbol: "TEST",
    range: "2y",
    interval: "1d",
    candles,
    sma20: series(90),
    sma50: series(95),
    sma200: series(98),
    rsi14: series(65),
    macd: [],
    atr14: series(2),
    bollinger: [],
    vwap: 120,
    fifty_two_week: { high: 160, low: 80 },
    fetched_at: new Date().toISOString(),
    source: "yahoo",
    ...overrides,
  };
}

describe("deriveStance", () => {
  it("returns Neutral/0 without enough history", () => {
    const s = deriveStance(null);
    expect(s).toEqual({ short: "Neutral", medium: "Neutral", long: "Neutral", overall: "Neutral", confidence: 0 });
  });

  it("reads bullish when price is above all SMAs, RSI > 55, and MTF confirms", () => {
    const s = deriveStance(makeHistory(), [
      { timeframe: "daily", bull: 4, bear: 1 },
      { timeframe: "weekly", bull: 3, bear: 1 },
      { timeframe: "monthly", bull: 3, bear: 2 },
    ]);
    expect(s.overall).toBe("Bullish");
    expect(s.confidence).toBe(100);
    expect(s.short).toBe("Bullish");
  });

  it("reads bearish when price is below all SMAs, RSI < 45", () => {
    const history = makeHistory({
      candles: makeHistory().candles.map((c, i) => ({ ...c, close: 200 - i })),
      sma20: Array.from({ length: 60 }, (_, i) => ({ date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, value: 300 })),
      sma50: Array.from({ length: 60 }, (_, i) => ({ date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, value: 300 })),
      sma200: Array.from({ length: 60 }, (_, i) => ({ date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, value: 300 })),
      rsi14: Array.from({ length: 60 }, (_, i) => ({ date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, value: 30 })),
    });
    const s = deriveStance(history, [
      { timeframe: "daily", bull: 0, bear: 5 },
      { timeframe: "weekly", bull: 1, bear: 4 },
    ]);
    expect(s.overall).toBe("Bearish");
    expect(s.confidence).toBe(100);
  });

  it("penalises confidence when timeframes disagree", () => {
    const s = deriveStance(makeHistory(), [
      { timeframe: "daily", bull: 5, bear: 0 },
      { timeframe: "weekly", bull: 0, bear: 5 },
    ]);
    // short bullish (daily), medium splits sma50-bull vs weekly-bear → tie → Neutral,
    // long bullish (sma200) — agreement 2/3 caps confidence at 67.
    expect(s.short).toBe("Bullish");
    expect(s.medium).toBe("Neutral");
    expect(s.long).toBe("Bullish");
    expect(s.overall).toBe("Bullish");
    expect(s.confidence).toBe(67);
  });
});

import { describe, it, expect } from "vitest";
import { gateReport } from "../src/reportGate.js";
import { interpret, interpretationLines, deriveStance, type PriceHistory } from "../src/marketdata.js";
import type { AnalysisReport } from "../src/agent.js";

/**
 * The KEI Industries v2 eval fixture (2 Oct 2026). Every number here is the
 * report's OWN published data — the eight contradictions in the eval were all
 * the prose disagreeing with figures already on the page. These tests fail if
 * any of them can come back.
 */
const KEI = {
  price: 4502,
  sma20: 4603.525,
  sma50: 5100.192,
  sma200: 4841.8052,
  vwap: 4619.2985,
  rsi: { daily: 36.45, weekly: 52.52, monthly: 41.37 },
  macd: { line: -180.15, signal: -190.01, histogram: 9.86 },
  support: 3717.45,
  resistance: 4765.03,
  stop: 4447.68,
  tp1: 4765.03,
  rr: 4.84,
};

function keiHistory(over: Partial<PriceHistory> = {}): PriceHistory {
  const n = 300;
  const candles = Array.from({ length: n }, (_, i) => {
    // A prior uptrend that has pulled back: price under every average while
    // SMA50 is still above SMA200. The last day trades thin (0.4x the 20d
    // average) so the volume tag reads "weak".
    const t = i / (n - 1);
    // Flat over the last 26 candles so the resampled weekly/monthly RSI sit in
    // the neutral band, matching KEI's published weekly 52.52 / monthly 41.37.
    // The published daily RSI (36.45) is injected below.
    const close = i >= n - 26 ? 4502 : 3800 + 1400 * Math.sin(t * Math.PI) - 500 * t;
    return {
      date: new Date(Date.UTC(2024, 0, 1 + i * 2)).toISOString().slice(0, 10),
      open: close,
      high: close * 1.01,
      low: close * 0.99,
      close: Math.round(close * 100) / 100,
      volume: i === n - 1 ? 400_000 : 1_000_000,
    };
  });
  const d = candles[n - 1].date;
  const one = (v: number) => [{ date: d, value: v }];
  return {
    symbol: "KEI",
    range: "2y",
    interval: "1d",
    candles,
    sma20: one(KEI.sma20),
    sma50: one(KEI.sma50),
    sma200: one(KEI.sma200),
    rsi14: one(KEI.rsi.daily),
    macd: [{ date: d, macd: KEI.macd.line, signal: KEI.macd.signal, histogram: KEI.macd.histogram }],
    atr14: one(30),
    bollinger: [],
    vwap: KEI.vwap,
    fifty_two_week: { high: 5500, low: 3700 },
    fetched_at: "2026-10-02T18:12:27Z",
    source: "yahoo",
    ...over,
  } as PriceHistory;
}

/** The READING block a real KEI run would put in the facts pack. */
function keiFactsPack(volumeRatio = 2.1): string {
  const lines = [
    `price=${KEI.price} as_of=2026-10-02`,
    `sma20=${KEI.sma20} sma50=${KEI.sma50} sma200=${KEI.sma200}`,
    `rsi14=${KEI.rsi.daily}`,
    `macd=${KEI.macd.line} signal=${KEI.macd.signal} histogram=${KEI.macd.histogram}`,
    `vwap=${KEI.vwap}`,
    `level map: nearest support ${KEI.support}; nearest resistance ${KEI.resistance}; stop ${KEI.stop}; tp1 ${KEI.tp1}; risk_reward ${KEI.rr}`,
    `avg_volume_50d=900000 max_volume_50d=1900000 volume_ratio_max=${volumeRatio}`,
    ...interpretationLines(interpret(keiHistory())),
  ];
  return lines.join("\n");
}

function report(paras: string[]): AnalysisReport {
  return {
    heroPct: 50,
    heroLabel: "Neutral",
    partial: false,
    source: "llm",
    blocks: paras.map((text) => ({ type: "paragraph" as const, text })),
  };
}

describe("KEI eval fixture — the eight v2 contradictions", () => {
  const facts = keiFactsPack();

  it("1. the computed reading is the eval's own reading of KEI", () => {
    const r = interpret(keiHistory())!;
    // SMA50 (5100) above SMA200 (4842) => golden, and price is below both =>
    // a pullback inside a prior uptrend, NOT an aligned downtrend.
    expect(r.maStack).toBe("golden");
    expect(r.regime).toBe("pullback");
    // Price 2.5% below VWAP is weakness, not support.
    expect(r.vwap.state).toBe("below");
    expect(r.vwap.pct).toBeLessThan(0);
    // MACD: negative level, positive histogram.
    expect(r.macd!.level).toBe("bearish");
    expect(r.macd!.momentum).toBe("improving");
    // No RSI reading is oversold or overbought.
    expect(r.rsi.find((x) => x.timeframe === "daily")!.zone).toBe("neutral");
  });

  it("2. flags RSI 36/52/41 called 'a mix of oversold and overbought'", () => {
    const g = gateReport(report(["RSI values vary, indicating a mix of oversold and overbought conditions."]), facts);
    expect(g.pass).toBe(false);
    expect(g.issues.concat(g.warnings).join(" ")).toMatch(/oversold|overbought/);
  });

  it("3. flags 'bearish momentum' while the MACD histogram is positive", () => {
    const g = gateReport(report(["The MACD is -180.15 and suggests a bearish momentum."]), facts);
    expect(g.pass).toBe(false);
    expect(g.issues.concat(g.warnings).join(" ")).toMatch(/momentum/i);
  });

  it("4. flags 'regime is trending down' against a golden MA stack", () => {
    const g = gateReport(report(["The regime is trending down and structure is a downtrend."]), facts);
    expect(g.pass).toBe(false);
    expect(g.issues.concat(g.warnings).join(" ")).toMatch(/regime|downtrend/i);
  });

  it("5. flags VWAP called supportive while price is below it", () => {
    const g = gateReport(report(["VWAP is 4619.30, which supports the current price zone."]), facts);
    expect(g.pass).toBe(false);
    expect(g.issues.concat(g.warnings).join(" ")).toMatch(/VWAP/);
  });

  it("6. flags 'level map is unavailable' while levels are on the page", () => {
    const g = gateReport(report(["Level map is unavailable, but the scenario framing is honest."]), facts);
    expect(g.pass).toBe(false);
    expect(g.issues.concat(g.warnings).join(" ")).toMatch(/level map/i);
  });

  it("7. flags a volume claim with no supporting volume reading", () => {
    const weak = keiFactsPack(0.6);
    const g = gateReport(report(["Volume analysis and OBV/A-D trend are supportive of the current price zone."]), weak);
    // The volume tag describes the LATEST session; a claim about historical
    // breakouts is not contradicted by it. Warning, never a block — this
    // heuristic killed a 100-score GLAND run.
    expect(g.warnings.join(" ")).toMatch(/volume/i);
  });

  it("8. flags self-grading and leaked prompt copy", () => {
    const g = gateReport(
      report([
        "The level map is actionable with clear triggers.",
        "Do not invent a headline number when coverage is low.",
      ]),
      facts,
    );
    expect(g.pass).toBe(false);
    expect(g.issues.concat(g.warnings).join(" ")).toMatch(/Self-grading|instruction leaked/);
  });
});

describe("KEI eval fixture — the corrected reading passes", () => {
  const facts = keiFactsPack();

  it("accepts the report the agent should have written", () => {
    const g = gateReport(
      report([
        "Price is 4502, below the SMA20 (4603.53), SMA50 (5100.19) and SMA200 (4841.81) on the daily timeframe.",
        "SMA50 remains above SMA200, so the daily structure is a pullback inside a prior uptrend rather than an aligned downtrend.",
        "MACD is below zero at -180.15 while the histogram is positive at 9.86: selling pressure is easing.",
        "RSI on the daily timeframe is 36.45, inside the neutral 30-70 band, with no timeframe oversold or overbought.",
        "Price sits 2.5% below VWAP at 4619.30, which reads as weakness against the session average.",
        "Nearest support is 3717.45 and nearest resistance is 4765.03.",
      ]),
      facts,
    );
    expect(g.issues).toEqual([]);
    expect(g.pass).toBe(true);
  });

  it("keeps the MTF conflict check working alongside the new checks", () => {
    const conflictFacts =
      facts + "\nmtf_matrix: daily: 3 bull / 1 bear; weekly: 0 bull / 4 bear; monthly: 3 bull / 1 bear";
    const g = gateReport(report(["The daily and weekly timeframes agree — the matrix confirms the view."]), conflictFacts);
    expect(g.pass).toBe(false);
    expect(g.issues.concat(g.warnings).join(" ")).toMatch(/MTF/);
  });

  it("derives a stance that matches the pullback reading", () => {
    const s = deriveStance(keiHistory(), [
      { timeframe: "daily", bull: 3, bear: 1 },
      { timeframe: "weekly", bull: 0, bear: 4 },
      { timeframe: "monthly", bull: 3, bear: 1 },
    ]);
    // Daily mixed, weekly bearish, monthly bullish => no clean overall stance.
    expect(["Neutral", "Bearish"]).toContain(s.overall);
    expect(s.confidence).toBeLessThanOrEqual(67);
  });
});

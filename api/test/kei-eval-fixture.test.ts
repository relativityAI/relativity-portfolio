import { describe, it, expect } from "vitest";
import { interpret, deriveStance, type PriceHistory } from "../src/marketdata.js";

/**
 * KEI Industries v2 eval fixture (2 Oct 2026). Every number here is the
 * report's OWN published data. The reading isn't gated any more (reportGate
 * was deleted with the v3 verification stack) — these tests pin the marketdata
 * reading functions that the analyst prompt runs BEFORE anything is written,
 * so the eval's eight contradictions cannot sneak back in through the source.
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

describe("KEI eval fixture — marketdata reading", () => {
  it("the computed reading is the eval's own reading of KEI", () => {
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